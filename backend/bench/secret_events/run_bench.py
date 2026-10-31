#!/usr/bin/env python3
"""Benchmark orchestrator for sync vs Redis-buffered secret event logging.

Host-side, stdlib only. Expects (see README.md):
  * Postgres on 127.0.0.1:5433 (container ``bench-pg``)
  * Redis    on 127.0.0.1:6380 (container ``bench-redis``)
  * images ``phasehq/backend:baseline`` (main) and ``phasehq/backend:buffered``
  * the Go load generator and the seeded targets.json in --workdir
  * optional toxiproxy server binary for the latency scenario

Per run: (re)start the backend with the variant's image/env, snapshot
Postgres/Redis/cgroup counters, run the load, wait for the flusher to drain,
verify the exact number of rows landed, record deltas, then delete the run's
rows so every run starts from the same table state.
"""

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

PG_PORT = 5433
REDIS_PORT = 6380
PG_PROXY_PORT = 25433
REDIS_PROXY_PORT = 26380
TOXI_API = "http://127.0.0.1:8474"

SET_SIZES = {"s10": 10, "s50": 50, "s200": 200}

VARIANTS = {
    # name: (image, buffer enabled)
    "orig": ("phasehq/backend:baseline", False),
    "sync": ("phasehq/backend:buffered", False),
    "buffered": ("phasehq/backend:buffered", True),
}


def sh(cmd, check=True, capture=True):
    r = subprocess.run(cmd, shell=True, text=True, capture_output=capture)
    if check and r.returncode != 0:
        raise RuntimeError(f"{cmd}\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip() if capture else ""


def psql(sql):
    return sh(f"docker exec bench-pg psql -U phase -p {PG_PORT} -d phase -tAc \"{sql}\"")


def redis(cmd):
    return sh(f"docker exec bench-redis redis-cli -p {REDIS_PORT} {cmd}")


def cpu_ns(container):
    try:
        cid = sh(f"docker inspect -f '{{{{.Id}}}}' {container}")
        with open(f"/sys/fs/cgroup/cpuacct/docker/{cid}/cpuacct.usage") as f:
            return int(f.read())
    except Exception:
        return None


def pg_counters():
    row = psql(
        "select (select xact_commit from pg_stat_database where datname='phase'),"
        " (select wal_bytes from pg_stat_wal), (select wal_records from pg_stat_wal),"
        " (select wal_fpi from pg_stat_wal),"
        " (select n_tup_ins from pg_stat_user_tables where relname='api_secretevent')"
    )
    commits, wal_bytes, wal_records, fpi, ins = row.split("|")
    return {
        "commits": int(commits),
        "wal_bytes": int(float(wal_bytes)),
        "wal_records": int(wal_records),
        "wal_fpi": int(fpi),
        "secretevent_inserts": int(ins),
    }


class RedisSampler(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.stop = threading.Event()
        self.peak = {"entries": 0, "bytes": 0, "used_memory": 0}

    def run(self):
        while not self.stop.is_set():
            try:
                out = sh(
                    f"docker exec bench-redis sh -c \"redis-cli -p {REDIS_PORT} XLEN '{{secret-events}}:stream';"
                    f" redis-cli -p {REDIS_PORT} GET '{{secret-events}}:bytes';"
                    f" redis-cli -p {REDIS_PORT} INFO memory | grep '^used_memory:'\""
                )
                lines = out.splitlines()
                entries = int(lines[0] or 0)
                used_bytes = int(lines[1] or 0) if lines[1] else 0
                used_memory = int(lines[2].split(":")[1])
                self.peak["entries"] = max(self.peak["entries"], entries)
                self.peak["bytes"] = max(self.peak["bytes"], used_bytes)
                self.peak["used_memory"] = max(self.peak["used_memory"], used_memory)
            except Exception:
                pass
            self.stop.wait(0.5)


def toxiproxy_setup(latency_ms):
    def call(method, path, body=None):
        req = urllib.request.Request(
            TOXI_API + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (404, 409):
                raise

    for name, listen, upstream in (
        ("pg", PG_PROXY_PORT, PG_PORT),
        ("redis", REDIS_PROXY_PORT, REDIS_PORT),
    ):
        call("DELETE", f"/proxies/{name}")
        call("POST", "/proxies", {"name": name, "listen": f"127.0.0.1:{listen}", "upstream": f"127.0.0.1:{upstream}"})
        for stream in ("downstream", "upstream"):
            # Half the RTT each way.
            call(
                "POST",
                f"/proxies/{name}/toxics",
                {"name": f"lat_{stream}", "type": "latency", "stream": stream, "attributes": {"latency": latency_ms // 2, "jitter": 0}},
            )


BENCH_SETTINGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bench_settings.py")


def backend_env(variant, latency_ms, envfile, persistent_conns=False):
    image, buffered = VARIANTS[variant]
    pg = PG_PROXY_PORT if latency_ms else PG_PORT
    rd = REDIS_PROXY_PORT if latency_ms else REDIS_PORT
    env = f"--env-file {envfile} -e DATABASE_PORT={pg} -e REDIS_PORT={rd} -e EXTERNAL_MIGRATION=true"
    if buffered:
        # Buffer every event type, as in the main matrix (code default is R only).
        env += " -e SECRET_EVENT_BUFFER_ENABLED=true -e SECRET_EVENT_BUFFER_EVENT_TYPES=C,R,U,D"
    if persistent_conns:
        env += f" -v {BENCH_SETTINGS}:/app/bench_settings.py:ro -e DJANGO_SETTINGS_MODULE=bench_settings"
    return image, buffered, env


_current = {"key": None}


def ensure_backend(variant, latency_ms, envfile, workers, persistent_conns=False):
    key = (variant, latency_ms, workers, persistent_conns)
    if _current["key"] == key:
        return
    image, buffered, env = backend_env(variant, latency_ms, envfile, persistent_conns)
    sh("docker rm -f bench-backend bench-flusher", check=False)
    sh(
        f"docker run -d --name bench-backend --network host {env} {image} "
        f"gunicorn -b 0.0.0.0:8000 --workers {workers} --timeout 120 --graceful-timeout 90 backend.wsgi:application"
    )
    if buffered:
        sh(f"docker run -d --name bench-flusher --network host {env} {image} python manage.py flush_secret_events")
    for _ in range(60):
        try:
            urllib.request.urlopen("http://127.0.0.1:8000/493", timeout=1)
        except urllib.error.HTTPError:
            break
        except Exception:
            time.sleep(0.5)
    time.sleep(2)
    _current["key"] = key


def wait_drained(timeout=300):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if int(redis("XLEN '{secret-events}:stream'") or 0) == 0:
            return round(time.time() - t0, 2)
        time.sleep(0.25)
    return None


def run_one(args, variant, mode, set_name, c, latency_ms, put_n=10, tag=""):
    label = f"{variant}-{mode}-{set_name}-c{c}-lat{latency_ms}{tag}"
    ensure_backend(variant, latency_ms, args.envfile, args.workers, args.persistent_conns)
    _, buffered = VARIANTS[variant]

    containers = ["bench-backend", "bench-pg", "bench-redis"] + (["bench-flusher"] if buffered else [])
    psql("CHECKPOINT")
    pg0 = pg_counters()
    cpu0 = {c_: cpu_ns(c_) for c_ in containers}
    sampler = RedisSampler()
    sampler.start()

    lg = sh(
        f"{args.workdir}/loadgen -targets {args.workdir}/targets.json -set {set_name} -mode {mode} "
        f"-put-n {put_n} -c {c} -d {args.duration}s -warmup {args.warmup}s -label {label}"
    )
    load = json.loads(lg.splitlines()[-1])
    cpu_load_end = {c_: cpu_ns(c_) for c_ in containers}
    pg_load_end = pg_counters()

    drain_s = wait_drained() if buffered else 0.0
    time.sleep(0.5)
    sampler.stop.set()
    sampler.join()
    pg1 = pg_counters()
    cpu1 = {c_: cpu_ns(c_) for c_ in containers}

    ua = f"phase-bench/1.0 ({label})"
    landed = int(psql(f"select count(*) from api_secretevent where user_agent = '{ua}'"))
    per_req = SET_SIZES[set_name] if mode == "get" else put_n
    expected = load["all_ok"] * per_req

    wall = args.duration + args.warmup
    reqs = load["requests"]
    result = {
        "label": label,
        "variant": variant,
        "mode": mode,
        "set": set_name,
        "concurrency": c,
        "latency_ms": latency_ms,
        "persistent_conns": args.persistent_conns,
        "tag": tag,
        "load": load,
        "events_expected": expected,
        "events_landed": landed,
        "events_match": landed == expected,
        "drain_after_load_s": drain_s,
        "redis_peak": sampler.peak,
        "pg_during_load": {k: pg_load_end[k] - pg0[k] for k in pg0},
        "pg_total": {k: pg1[k] - pg0[k] for k in pg0},
        "cpu_cores_during_load": {
            k: round((cpu_load_end[k] - cpu0[k]) / 1e9 / wall, 3)
            for k in containers
            if cpu0[k] is not None
        },
        "cpu_ms_per_request_total": {
            k: round((cpu1[k] - cpu0[k]) / 1e6 / max(load["all_ok"], 1), 2)
            for k in containers
            if cpu0[k] is not None
        },
    }
    result["wal_bytes_per_event"] = round(result["pg_total"]["wal_bytes"] / max(landed, 1))
    result["commits_per_s_during_load"] = round(result["pg_during_load"]["commits"] / wall, 1)

    # Reset table state for the next run.
    psql(
        f"DELETE FROM api_secretevent_tags WHERE secretevent_id IN "
        f"(SELECT id FROM api_secretevent WHERE user_agent = '{ua}')"
    )
    psql(f"DELETE FROM api_secretevent WHERE user_agent = '{ua}'")
    psql("VACUUM api_secretevent")
    psql("VACUUM api_secretevent_tags")

    with open(args.out, "a") as f:
        f.write(json.dumps(result) + "\n")
    print(
        f"{label:40s} rps={load['rps']:7.1f} p50={load['p50_ms']:7.1f} p99={load['p99_ms']:7.1f} "
        f"err={load['errors']} events={landed}/{expected} drain={drain_s}s "
        f"pg_cpu_ms/req={result['cpu_ms_per_request_total'].get('bench-pg')} "
        f"wal/ev={result['wal_bytes_per_event']} redis_peak={sampler.peak['bytes']}",
        flush=True,
    )
    return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--workdir", required=True)
    p.add_argument("--envfile", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--duration", type=int, default=30)
    p.add_argument("--warmup", type=int, default=5)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--plan", default="main", help="main | latency | quick")
    p.add_argument("--variants", default="orig,sync,buffered")
    p.add_argument("--latency-ms", type=int, default=2)
    p.add_argument("--tag", default="")
    p.add_argument("--persistent-conns", action="store_true", help="CONN_MAX_AGE=60 via bench_settings.py")
    args = p.parse_args()
    variants = args.variants.split(",")

    plan = []
    if args.plan == "main":
        for set_name in ("s10", "s50", "s200"):
            for c in (8, 32):
                for v in variants:  # interleaved to cancel drift
                    plan.append((v, "get", set_name, c, 0))
        for v in variants:
            plan.append((v, "put", "s50", 8, 0))
    elif args.plan == "latency":
        toxiproxy_setup(args.latency_ms)
        for v in variants:
            plan.append((v, "get", "s50", 8, args.latency_ms))
        for v in variants:
            plan.append((v, "put", "s50", 8, args.latency_ms))
    elif args.plan == "idx":
        # After trimming api_secretevent's indexes (see RESULTS.md).
        for v in variants:
            plan.append((v, "get", "s50", 8, 0))
        for v in [v for v in variants if v != "orig"]:
            plan.append((v, "get", "s200", 8, 0))
    elif args.plan == "c1":
        # Unsaturated latency: one request at a time.
        for set_name in ("s10", "s50", "s200"):
            for v in variants:
                plan.append((v, "get", set_name, 1, 0))
    elif args.plan == "pconn":
        for set_name in ("s50", "s200"):
            for v in variants:
                plan.append((v, "get", set_name, 8, 0))
    elif args.plan == "quick":
        for v in variants:
            plan.append((v, "get", "s50", 8, 0))
    elif args.plan == "focus":
        # The headline comparison only: GET s10/s50/s200 + PUT at c=8.
        for set_name in ("s10", "s50", "s200"):
            for v in variants:
                plan.append((v, "get", set_name, 8, 0))
        for v in variants:
            plan.append((v, "put", "s50", 8, 0))
    else:
        raise SystemExit("unknown plan")

    for v, mode, set_name, c, lat in plan:
        run_one(args, v, mode, set_name, c, lat, tag=args.tag)
    sh("docker rm -f bench-backend bench-flusher", check=False)
    _current["key"] = None


if __name__ == "__main__":
    sys.exit(main())
