#!/usr/bin/env python3
"""Sustained-load run: does the flusher keep up, and what happens when it
doesn't?

    python3 sustained.py WORKDIR VARIANT SECONDS [BUDGET_BYTES] [SET] [TAG]

Runs the load for SECONDS while sampling, every 2s: buffered entries/bytes,
Redis memory, rows inserted into api_secretevent (pg_stat n_tup_ins), and how
many requests fell back to synchronous inserts because the buffer was over
budget (backend log lines). Writes a time series to WORKDIR/sustained.jsonl.
"""

import json
import os
import subprocess
import sys
import threading
import time

W, VARIANT, SECONDS = sys.argv[1], sys.argv[2], int(sys.argv[3])
BUDGET = int(sys.argv[4]) if len(sys.argv) > 4 else 64 * 1024 * 1024
SET = sys.argv[5] if len(sys.argv) > 5 else "s50"
TAG = sys.argv[6] if len(sys.argv) > 6 else ""
FLUSHERS = int(sys.argv[7]) if len(sys.argv) > 7 else 1
IMAGE = {"orig": "phasehq/backend:baseline"}.get(VARIANT, "phasehq/backend:buffered")
BUFFERED = VARIANT == "buffered"
PCONN = os.getenv("BENCH_PCONN") == "1"
BENCH_SETTINGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bench_settings.py")
ENV = (
    f"--env-file {W}/bench.env -e DATABASE_PORT=5433 -e REDIS_PORT=6380 -e EXTERNAL_MIGRATION=true"
    + (f" -e SECRET_EVENT_BUFFER_ENABLED=true -e SECRET_EVENT_BUFFER_MAX_BYTES={BUDGET}" if BUFFERED else "")
    + (f" -v {BENCH_SETTINGS}:/app/bench_settings.py:ro -e DJANGO_SETTINGS_MODULE=bench_settings" if PCONN else "")
)


def sh(cmd, check=True):
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{cmd}\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip()


def psql(sql):
    return sh(f"docker exec bench-pg psql -U phase -p 5433 -d phase -tAc \"{sql}\"")


def inserts():
    return int(psql("select n_tup_ins from pg_stat_user_tables where relname='api_secretevent'"))


FLUSHER_NAMES = ["bench-flusher"] + [f"bench-flusher-{i}" for i in range(2, FLUSHERS + 1)]
sh("docker rm -f bench-backend " + " ".join(FLUSHER_NAMES), check=False)
sh("docker exec bench-redis redis-cli -p 6380 DEL '{secret-events}:stream' '{secret-events}:bytes'")
sh(f"docker run -d --name bench-backend --network host {ENV} {IMAGE} "
   "gunicorn -b 0.0.0.0:8000 --workers 8 --timeout 120 backend.wsgi:application")
if BUFFERED:
    for name in FLUSHER_NAMES:
        sh(f"docker run -d --name {name} --network host {ENV} {IMAGE} python manage.py flush_secret_events")
time.sleep(7)
psql("CHECKPOINT")

label = f"sustained-{VARIANT}-{SET}{TAG}"
result = {}


def run_load():
    out = sh(f"{W}/loadgen -targets {W}/targets.json -set {SET} -c 8 -d {SECONDS}s -warmup 0s -label {label}")
    result["load"] = json.loads(out.splitlines()[-1])


t = threading.Thread(target=run_load)
t0 = time.time()
ins0 = inserts()
t.start()
series = []
while t.is_alive() or (BUFFERED and int(sh("docker exec bench-redis redis-cli -p 6380 XLEN '{secret-events}:stream'") or 0) > 0):
    time.sleep(2)
    out = sh("docker exec bench-redis sh -c \"redis-cli -p 6380 XLEN '{secret-events}:stream'; "
             "redis-cli -p 6380 GET '{secret-events}:bytes'; redis-cli -p 6380 INFO memory | grep '^used_memory:'\"")
    lines = out.splitlines()
    fallbacks = sh(
        "docker logs bench-backend 2>&1 | grep -o \"'over_budget': [0-9]*\" | awk '{s+=$2} END {print s+0}'",
        check=False,
    ) if BUFFERED else "0"
    series.append({
        "t": round(time.time() - t0, 1),
        "load_running": t.is_alive(),
        "entries": int(lines[0] or 0),
        "bytes": int(lines[1] or 0) if len(lines) > 1 and lines[1] else 0,
        "used_memory": int(lines[2].split(":")[1]) if len(lines) > 2 else 0,
        "rows_inserted": inserts() - ins0,
        "budget_fallbacks": int(fallbacks or 0),
    })
    if time.time() - t0 > SECONDS + 600:
        break
t.join()

ua = f"phase-bench/1.0 ({label})"
landed = int(psql(f"select count(*) from api_secretevent where user_agent = '{ua}'"))
size = {"s10": 10, "s50": 50, "s200": 200}[SET]
summary = {
    "variant": VARIANT, "set": SET, "seconds": SECONDS, "budget": BUDGET if BUFFERED else None, "tag": TAG,
    "flushers": FLUSHERS if BUFFERED else 0,
    "persistent_conns": PCONN,
    "load": result["load"], "events_landed": landed, "events_expected": result["load"]["all_ok"] * size,
    "drain_after_load_s": round(series[-1]["t"] - SECONDS, 1) if BUFFERED else 0,
    "max_bytes": max(s["bytes"] for s in series), "series": series,
}
with open(f"{W}/sustained.jsonl", "a") as f:
    f.write(json.dumps(summary) + "\n")
print(json.dumps({k: v for k, v in summary.items() if k != "series"}))
psql(f"DELETE FROM api_secretevent_tags WHERE secretevent_id IN (SELECT id FROM api_secretevent WHERE user_agent = '{ua}')")
psql(f"DELETE FROM api_secretevent WHERE user_agent = '{ua}'")
psql("VACUUM api_secretevent")
psql("VACUUM api_secretevent_tags")
sh("docker rm -f bench-backend " + " ".join(FLUSHER_NAMES), check=False)
