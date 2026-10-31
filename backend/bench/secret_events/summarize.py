#!/usr/bin/env python3
"""Render run_bench.py JSONL results as markdown tables.

    python3 summarize.py main.jsonl [more.jsonl ...]
"""

import json
import sys
from collections import OrderedDict


def load(paths):
    rows = []
    for p in paths:
        with open(p) as f:
            rows.extend(json.loads(line) for line in f if line.strip())
    return rows


def key(r):
    return (r["mode"], r["set"], r["concurrency"], r["latency_ms"], r.get("persistent_conns", False), r.get("tag", ""))


def fmt_delta(v, base, higher_is_better=True):
    if not base:
        return ""
    d = (v - base) / base * 100
    sign = "+" if d >= 0 else ""
    return f" ({sign}{d:.0f}%)"


def main(paths):
    rows = load(paths)
    groups = OrderedDict()
    for r in rows:
        groups.setdefault(key(r), {})[r["variant"]] = r

    print("| workload | variant | req/s | p50 ms | p99 ms | PG CPU ms/req | backend CPU ms/req | flusher CPU ms/req | PG commits/req | WAL KB/event | events ok | drain s | Redis peak KB |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for k, variants in groups.items():
        mode, set_name, c, lat, pconn, tag = k
        wl = f"{mode.upper()} {set_name if mode == 'get' else 'x10'} c={c}" + (f" +{lat}ms RTT" if lat else "") + (" pconn" if pconn else "") + (f" {tag}" if tag else "")
        base = variants.get("orig") or variants.get("sync")
        for name in ("orig", "sync", "buffered"):
            r = variants.get(name)
            if not r:
                continue
            L = r["load"]
            cpu = r["cpu_ms_per_request_total"]
            commits = r["pg_total"]["commits"] / max(L["all_ok"], 1)
            b = base["load"] if base else None
            print(
                f"| {wl} | {name} | {L['rps']:.1f}{fmt_delta(L['rps'], b['rps']) if b and r is not base else ''} "
                f"| {L['p50_ms']:.0f}{fmt_delta(L['p50_ms'], b['p50_ms']) if b and r is not base else ''} "
                f"| {L['p99_ms']:.0f}{fmt_delta(L['p99_ms'], b['p99_ms']) if b and r is not base else ''} "
                f"| {cpu.get('bench-pg', 0):.1f} | {cpu.get('bench-backend', 0):.1f} | {cpu.get('bench-flusher', 0):.1f} "
                f"| {commits:.1f} | {r['wal_bytes_per_event'] / 1024:.1f} "
                f"| {'yes' if r['events_match'] else 'NO'} ({r['events_landed']}) "
                f"| {r['drain_after_load_s']} | {r['redis_peak']['bytes'] / 1024:.0f} |"
            )


if __name__ == "__main__":
    main(sys.argv[1:])
