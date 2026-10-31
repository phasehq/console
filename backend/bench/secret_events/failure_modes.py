#!/usr/bin/env python3
"""Failure-mode checks for the buffered secret event pipeline.

Host-side, stdlib only; same environment as run_bench.py. Each scenario
prints PASS/FAIL with the evidence. Scenarios:

  redis_hang       Redis paused mid-load: requests fall back to synchronous
                   inserts after the 250ms timeout (breaker limits the cost),
                   zero errors, zero lost events.
  budget           Flusher stopped with a small byte budget: Redis usage
                   plateaus at the budget, the overflow is inserted
                   synchronously, everything lands once the flusher returns.
  fk_orphans       An app is hard-deleted while its events are buffered: the
                   flusher drops them (CASCADE semantics) without blocking
                   the other tenants' rows in the same batch.
  pg_outage        Postgres paused while the flusher has a backlog: the
                   flusher backs off, keeps entries pending, drains on
                   recovery.
  crash_redelivery Flusher SIGKILLed mid-drain: a new consumer reclaims the
                   pending entries; no duplicates, no losses.
"""

import json
import os
import subprocess
import sys
import time

W = sys.argv[1]  # workdir with bench.env, targets.json, loadgen
ENVF = f"{W}/bench.env"
IMAGE = "phasehq/backend:buffered"
BASE_ENV = f"--env-file {ENVF} -e DATABASE_PORT=5433 -e REDIS_PORT=6380 -e EXTERNAL_MIGRATION=true -e SECRET_EVENT_BUFFER_ENABLED=true"
STREAM = "'{secret-events}:stream'"
BYTES = "'{secret-events}:bytes'"
results = []


def sh(cmd, check=True):
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{cmd}\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip()


def psql(sql):
    return sh(f"docker exec bench-pg psql -U phase -p 5433 -d phase -tAc \"{sql}\"")


def rcli(cmd):
    return sh(f"docker exec bench-redis redis-cli -p 6380 {cmd}")


def start_backend(extra=""):
    sh("docker rm -f bench-backend", check=False)
    sh(f"docker run -d --name bench-backend --network host {BASE_ENV} {extra} {IMAGE} "
       "gunicorn -b 0.0.0.0:8000 --workers 8 --timeout 120 backend.wsgi:application")
    time.sleep(6)


def start_flusher(name="bench-flusher", extra_args=""):
    sh(f"docker rm -f {name}", check=False)
    sh(f"docker run -d --name {name} --network host {BASE_ENV} {IMAGE} python manage.py flush_secret_events {extra_args}")


def stop_flusher(name="bench-flusher", signal="TERM"):
    sh(f"docker kill -s {signal} {name}", check=False)
    time.sleep(1)
    sh(f"docker rm -f {name}", check=False)


def load(label, seconds, c=8, set_name="s50"):
    out = sh(f"{W}/loadgen -targets {W}/targets.json -set {set_name} -c {c} -d {seconds}s -warmup 0s -label {label}")
    return json.loads(out.splitlines()[-1])


def landed(label):
    return int(psql(f"select count(*) from api_secretevent where user_agent = 'phase-bench/1.0 ({label})'"))


def distinct_landed(label):
    return int(psql(f"select count(distinct id) from api_secretevent where user_agent = 'phase-bench/1.0 ({label})'"))


def wait_drained(timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if int(rcli(f"XLEN {STREAM}") or 0) == 0:
            return True
        time.sleep(0.5)
    return False


def cleanup(label):
    ua = f"phase-bench/1.0 ({label})"
    psql(f"DELETE FROM api_secretevent_tags WHERE secretevent_id IN (SELECT id FROM api_secretevent WHERE user_agent = '{ua}')")
    psql(f"DELETE FROM api_secretevent WHERE user_agent = '{ua}'")


def record(name, ok, **evidence):
    results.append({"scenario": name, "pass": ok, **evidence})
    print(f"{'PASS' if ok else 'FAIL'} {name}: {json.dumps(evidence)}", flush=True)


def redis_hang():
    start_backend()
    start_flusher()
    label = "fm-redis-hang"
    import threading

    def pause_later():
        time.sleep(4)
        sh("docker pause bench-redis")
        time.sleep(8)
        sh("docker unpause bench-redis")

    t = threading.Thread(target=pause_later)
    t.start()
    r = load(label, 20)
    t.join()
    wait_drained()
    time.sleep(1)
    got = landed(label)
    exp = r["all_ok"] * 50
    record("redis_hang", r["errors"] == 0 and got == exp, errors=r["errors"], events=got, expected=exp,
           p50_ms=r["p50_ms"], p99_ms=r["p99_ms"], max_ms=r["max_ms"], rps=r["rps"])
    cleanup(label)
    stop_flusher()


def budget():
    stop_flusher()
    budget_bytes = 2 * 1024 * 1024
    start_backend(f"-e SECRET_EVENT_BUFFER_MAX_BYTES={budget_bytes}")
    rcli(f"DEL {STREAM} {BYTES}")
    label = "fm-budget"
    r = load(label, 15)
    used = int(rcli(f"GET {BYTES}") or 0)
    in_db_before_flush = landed(label)
    start_flusher()
    wait_drained()
    time.sleep(1)
    got = landed(label)
    exp = r["all_ok"] * 50
    record("budget", got == exp and used <= budget_bytes and in_db_before_flush > 0,
           budget=budget_bytes, buffered_bytes_at_end=used, synced_while_flusher_down=in_db_before_flush,
           events=got, expected=exp, errors=r["errors"])
    cleanup(label)
    stop_flusher()


TEMP_APP_SCRIPT = r'''
import os, sys, json, secrets as pr
sys.path.insert(0, "/app"); os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
import django; django.setup()
from api.models import *
mode = sys.argv[1]
org = Organisation.objects.get(name="bench-org-000")
if mode == "create":
    sa = ServiceAccount.objects.get(organisation=org)
    app = App.objects.create(organisation=org, name="fm-temp", identity_key=pr.token_hex(32), app_token=pr.token_hex(32), app_seed="x", wrapped_key_share="x")
    sa.apps.add(app)
    env = Environment.objects.create(app=app, name="Development", env_type="dev", identity_key=pr.token_hex(32), wrapped_seed="x", wrapped_salt="x")
    EnvironmentKey.objects.create(environment=env, service_account=sa, identity_key=pr.token_hex(32), wrapped_seed="x", wrapped_salt="x")
    for i in range(20):
        Secret.objects.create(environment=env, key=f"ph:v1:{pr.token_hex(32)}:aw==", key_digest=pr.token_hex(32), value=f"ph:v1:{pr.token_hex(32)}:dg==", comment="")
    print(json.dumps({"env_id": str(env.id), "token": ServiceAccountToken.objects.get(service_account=sa).token}))
else:
    print(App.objects.filter(organisation=org, name="fm-temp").delete())
'''


def fk_orphans():
    stop_flusher()
    start_backend()
    rcli(f"DEL {STREAM} {BYTES}")
    with open(f"{W}/fm_temp_app.py", "w") as f:
        f.write(TEMP_APP_SCRIPT)
    run = f"docker run --rm --network host {BASE_ENV} -v {W}:/out {IMAGE} python /out/fm_temp_app.py"
    info = json.loads(sh(f"{run} create").splitlines()[-1])
    import urllib.request

    def get(env_id, token, ua):
        req = urllib.request.Request("http://127.0.0.1:8000/secrets/", headers={
            "Authorization": f"Bearer ServiceAccount {token}", "Environment": env_id, "User-Agent": ua})
        urllib.request.urlopen(req).read()

    targets = json.load(open(f"{W}/targets.json"))
    survivor = next(t for t in targets if t["set"] == "s10")
    for _ in range(5):
        get(info["env_id"], info["token"], "fm-orphan")
        get(survivor["env_id"], survivor["token"], "fm-survivor")
    buffered = int(rcli(f"XLEN {STREAM}"))
    sh(f"{run} delete")
    start_flusher()
    wait_drained()
    time.sleep(1)
    logs = sh("docker logs bench-flusher 2>&1")
    orphans = int(psql("select count(*) from api_secretevent where user_agent = 'fm-orphan'"))
    survivors = int(psql("select count(*) from api_secretevent where user_agent = 'fm-survivor'"))
    dead = int(rcli("XLEN '{secret-events}:dead'") or 0)
    record("fk_orphans", orphans == 0 and survivors == 50 and dead == 0, buffered_entries=buffered,
           orphan_rows=orphans, survivor_rows=survivors, dead_letters=dead,
           salvage_logged="Dropped 100 buffered secret events" in logs)
    psql("DELETE FROM api_secretevent_tags WHERE secretevent_id IN (SELECT id FROM api_secretevent WHERE user_agent = 'fm-survivor')")
    psql("DELETE FROM api_secretevent WHERE user_agent = 'fm-survivor'")
    stop_flusher()


def pg_outage():
    stop_flusher()
    start_backend()
    rcli(f"DEL {STREAM} {BYTES}")
    label = "fm-pg-outage"
    r = load(label, 8)
    backlog = int(rcli(f"XLEN {STREAM}"))
    sh("docker pause bench-pg")
    start_flusher()
    time.sleep(12)
    during = int(rcli(f"XLEN {STREAM}"))
    sh("docker unpause bench-pg")
    ok_drain = wait_drained()
    time.sleep(1)
    got = landed(label)
    exp = r["all_ok"] * 50
    logs = sh("docker logs bench-flusher 2>&1")
    record("pg_outage", ok_drain and got == exp and during == backlog, backlog_entries=backlog,
           entries_while_pg_down=during, events=got, expected=exp,
           flusher_db_errors_logged="Flusher database error" in logs)
    cleanup(label)
    stop_flusher()


def crash_redelivery():
    stop_flusher()
    start_backend()
    rcli(f"DEL {STREAM} {BYTES}")
    label = "fm-crash"
    r = load(label, 15, c=8, set_name="s200")
    backlog = int(rcli(f"XLEN {STREAM}"))
    # Small batches so the kill lands mid-drain with entries read-but-unacked.
    start_flusher("bench-flusher", "--batch-entries 5")
    t_wait = time.time()
    while landed(label) == 0 and time.time() - t_wait < 60:
        time.sleep(0.2)
    time.sleep(1.0)
    sh("docker kill -s KILL bench-flusher", check=False)
    pending_after_kill = rcli(f"XPENDING {STREAM} secret-event-flushers").splitlines()
    partial = landed(label)
    sh("docker rm -f bench-flusher", check=False)
    start_flusher("bench-flusher2", "--claim-idle-ms 3000")
    wait_drained(180)
    time.sleep(1)
    got = landed(label)
    distinct = distinct_landed(label)
    exp = r["all_ok"] * 200
    logs = sh("docker logs bench-flusher2 2>&1")
    record("crash_redelivery", got == exp and distinct == got and partial > 0, backlog_entries=backlog,
           landed_before_kill=partial, pending_after_kill=pending_after_kill[0] if pending_after_kill else None,
           events=got, distinct_ids=distinct, expected=exp, reclaimed="Reclaimed" in logs)
    cleanup(label)
    stop_flusher("bench-flusher2")


if __name__ == "__main__":
    which = sys.argv[2:] or ["redis_hang", "budget", "fk_orphans", "pg_outage", "crash_redelivery"]
    for name in which:
        try:
            globals()[name]()
        except Exception as e:
            sh("docker unpause bench-redis", check=False)
            sh("docker unpause bench-pg", check=False)
            record(name, False, error=repr(e)[:500])
    with open(f"{W}/failure_modes.jsonl", "a") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    sh("docker rm -f bench-backend bench-flusher bench-flusher2", check=False)
