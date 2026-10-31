// Closed-loop HTTP load generator for the secret event logging benchmark.
//
// Each of -c workers is pinned to one environment from the chosen target set
// (workers are spread across tenants), and issues requests back to back for
// -d after a -warmup. Prints a JSON summary with throughput and latency
// percentiles.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

type secretRef struct {
	ID   string   `json:"id"`
	Tags []string `json:"tags"`
}

type target struct {
	Org     string      `json:"org"`
	Set     string      `json:"set"`
	Token   string      `json:"token"`
	AppID   string      `json:"app_id"`
	EnvID   string      `json:"env_id"`
	Secrets []secretRef `json:"secrets"`
}

type result struct {
	Label     string         `json:"label"`
	Mode      string         `json:"mode"`
	Set       string         `json:"set"`
	PutN      int            `json:"put_n,omitempty"`
	C         int            `json:"concurrency"`
	Duration  float64        `json:"duration_s"`
	Requests  int            `json:"requests"`
	AllOK     int            `json:"all_ok"`
	RPS       float64        `json:"rps"`
	Errors    int            `json:"errors"`
	Status    map[string]int `json:"status"`
	MeanMs    float64        `json:"mean_ms"`
	P50Ms     float64        `json:"p50_ms"`
	P90Ms     float64        `json:"p90_ms"`
	P99Ms     float64        `json:"p99_ms"`
	P999Ms    float64        `json:"p999_ms"`
	MaxMs     float64        `json:"max_ms"`
	StartedAt string         `json:"started_at"`
	EndedAt   string         `json:"ended_at"`
}

func ciphertext(n int) string {
	pub := make([]byte, 32)
	raw := make([]byte, n+40)
	rand.Read(pub)
	rand.Read(raw)
	return "ph:v1:" + hex.EncodeToString(pub) + ":" + base64.StdEncoding.EncodeToString(raw)
}

func pct(sorted []time.Duration, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(p * float64(len(sorted)))
	if i >= len(sorted) {
		i = len(sorted) - 1
	}
	return float64(sorted[i].Microseconds()) / 1000.0
}

func main() {
	base := flag.String("base", "http://127.0.0.1:8000", "backend base URL")
	targetsPath := flag.String("targets", "targets.json", "seeded targets file")
	set := flag.String("set", "s50", "target set (s10, s50, s200)")
	mode := flag.String("mode", "get", "get | put")
	putN := flag.Int("put-n", 10, "secrets updated per PUT")
	c := flag.Int("c", 16, "concurrent workers")
	d := flag.Duration("d", 30*time.Second, "measured duration")
	warmup := flag.Duration("warmup", 5*time.Second, "warmup (not measured)")
	label := flag.String("label", "", "label for the result")
	flag.Parse()

	raw, err := os.ReadFile(*targetsPath)
	if err != nil {
		panic(err)
	}
	var all []target
	if err := json.Unmarshal(raw, &all); err != nil {
		panic(err)
	}
	var targets []target
	for _, t := range all {
		if t.Set == *set {
			targets = append(targets, t)
		}
	}
	if len(targets) == 0 {
		panic("no targets in set " + *set)
	}
	// Interleave tenants so consecutive workers hit different organisations.
	byOrg := map[string][]target{}
	var orgs []string
	for _, t := range targets {
		if _, ok := byOrg[t.Org]; !ok {
			orgs = append(orgs, t.Org)
		}
		byOrg[t.Org] = append(byOrg[t.Org], t)
	}
	sort.Strings(orgs)
	var interleaved []target
	for i := 0; len(interleaved) < len(targets); i++ {
		for _, o := range orgs {
			if i < len(byOrg[o]) {
				interleaved = append(interleaved, byOrg[o][i])
			}
		}
	}
	targets = interleaved

	client := &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        *c * 2,
			MaxIdleConnsPerHost: *c * 2,
			IdleConnTimeout:     30 * time.Second,
		},
	}

	start := time.Now()
	measureFrom := start.Add(*warmup)
	stopAt := measureFrom.Add(*d)

	var mu sync.Mutex
	var lat []time.Duration
	status := map[string]int{}
	errors := 0
	allOK := 0
	var wg sync.WaitGroup

	for w := 0; w < *c; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			t := targets[w%len(targets)]
			offset := 0
			local := make([]time.Duration, 0, 4096)
			localStatus := map[string]int{}
			localErr := 0
			localOK := 0
			for {
				now := time.Now()
				if now.After(stopAt) {
					break
				}
				var req *http.Request
				if *mode == "put" {
					type upd struct {
						ID    string   `json:"id"`
						Value string   `json:"value"`
						Tags  []string `json:"tags"`
					}
					body := struct {
						Secrets []upd `json:"secrets"`
					}{}
					for i := 0; i < *putN; i++ {
						s := t.Secrets[(offset+i)%len(t.Secrets)]
						tags := s.Tags
						if tags == nil {
							tags = []string{}
						}
						body.Secrets = append(body.Secrets, upd{ID: s.ID, Value: ciphertext(32), Tags: tags})
					}
					offset = (offset + *putN) % len(t.Secrets)
					buf, _ := json.Marshal(body)
					req, _ = http.NewRequest("PUT", *base+"/secrets/", bytes.NewReader(buf))
					req.Header.Set("Content-Type", "application/json")
				} else {
					req, _ = http.NewRequest("GET", *base+"/secrets/", nil)
				}
				req.Header.Set("Authorization", "Bearer ServiceAccount "+t.Token)
				req.Header.Set("Environment", t.EnvID)
				req.Header.Set("User-Agent", "phase-bench/1.0 ("+*label+")")

				t0 := time.Now()
				resp, err := client.Do(req)
				el := time.Since(t0)
				code := "err"
				if err == nil {
					io.Copy(io.Discard, resp.Body)
					resp.Body.Close()
					code = fmt.Sprint(resp.StatusCode)
					if resp.StatusCode < 300 {
						localOK++
					}
				}
				if t0.Before(measureFrom) {
					continue
				}
				if t0.Add(el).After(stopAt) {
					break
				}
				if err != nil || resp.StatusCode >= 400 {
					localErr++
				}
				localStatus[code]++
				local = append(local, el)
			}
			mu.Lock()
			lat = append(lat, local...)
			for k, v := range localStatus {
				status[k] += v
			}
			errors += localErr
			allOK += localOK
			mu.Unlock()
		}(w)
	}
	wg.Wait()

	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	var sum time.Duration
	for _, l := range lat {
		sum += l
	}
	res := result{
		Label: *label, Mode: *mode, Set: *set, C: *c,
		Duration: d.Seconds(), Requests: len(lat), AllOK: allOK, Errors: errors, Status: status,
		StartedAt: measureFrom.UTC().Format(time.RFC3339Nano),
		EndedAt:   stopAt.UTC().Format(time.RFC3339Nano),
	}
	if *mode == "put" {
		res.PutN = *putN
	}
	if len(lat) > 0 {
		res.RPS = float64(len(lat)) / d.Seconds()
		res.MeanMs = float64(sum.Microseconds()) / 1000.0 / float64(len(lat))
		res.P50Ms = pct(lat, 0.50)
		res.P90Ms = pct(lat, 0.90)
		res.P99Ms = pct(lat, 0.99)
		res.P999Ms = pct(lat, 0.999)
		res.MaxMs = float64(lat[len(lat)-1].Microseconds()) / 1000.0
	}
	out, _ := json.Marshal(res)
	fmt.Println(string(out))
}
