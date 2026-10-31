"""In-process micro-benchmarks for secret event logging.

    python bench/secret_events/microbench.py request /bench/targets.json
    python bench/secret_events/microbench.py flush   /bench/targets.json

``request``: per-request cost of logging N read events, three ways:
  * ``orig``     the pre-change log_secret_events_bulk (lazy-loads
                 secret.environment once per secret)
  * ``sync``     the fixed synchronous multi-row INSERT
  * ``buffered`` serialise + one Redis round trip (XADD via Lua)

``flush``: drain throughput of the flusher for different read batch sizes,
and raw bulk-insert throughput of ORM bulk_create vs psycopg2
execute_values vs COPY.
"""

import io
import json
import os
import statistics
import sys
import time
from uuid import uuid4

import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
django.setup()

from django.conf import settings  # noqa: E402
from django.db import connection, transaction  # noqa: E402
from django.db.models import prefetch_related_objects  # noqa: E402
from django.utils import timezone  # noqa: E402

from api.models import Secret, SecretEvent, ServiceAccountToken  # noqa: E402
from api.utils import audit_logging  # noqa: E402
from api.utils import secret_event_buffer as buf  # noqa: E402
from api.utils.secret_event_flusher import SecretEventFlusher  # noqa: E402


def orig_log_secret_events_bulk(secrets, event_type, user=None, service_account_token=None, ip_address=None, user_agent=None):
    """Verbatim copy of the implementation before this change."""
    if not secrets:
        return []
    service_account = None
    if service_account_token is not None:
        service_account = service_account_token.service_account
    prefetch_related_objects(list(secrets), "tags")
    events = [
        SecretEvent(
            secret=secret,
            environment=secret.environment,
            folder=secret.folder,
            path=secret.path,
            user=user,
            service_account=service_account,
            service_account_token=service_account_token,
            key=secret.key,
            key_digest=secret.key_digest,
            value=secret.value,
            version=secret.version,
            comment=secret.comment,
            type=secret.type,
            event_type=event_type,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        for secret in secrets
    ]
    with transaction.atomic():
        created = SecretEvent.objects.bulk_create(events, batch_size=1000)
        through_model = SecretEvent.tags.through
        m2m_rows = [
            through_model(secretevent_id=event.pk, secrettag_id=tag.pk)
            for event, secret in zip(created, secrets)
            for tag in secret.tags.all()
        ]
        if m2m_rows:
            through_model.objects.bulk_create(m2m_rows, batch_size=1000)
    return created


def load_secrets(env_id):
    # Fresh instances every call, as each request gets.
    return list(
        Secret.objects.filter(environment_id=env_id, deleted_at=None).prefetch_related("tags")
    )


def summarize(samples):
    samples = sorted(samples)
    return {
        "mean_ms": round(statistics.mean(samples) * 1000, 2),
        "p50_ms": round(samples[len(samples) // 2] * 1000, 2),
        "p95_ms": round(samples[int(len(samples) * 0.95)] * 1000, 2),
    }


def bench_request(targets, iterations=60):
    results = []
    for set_name in ("s10", "s50", "s200"):
        target = next(t for t in targets if t["set"] == set_name)
        sat = ServiceAccountToken.objects.get(token=target["token"])
        for strategy in ("orig", "sync", "buffered"):
            settings.SECRET_EVENT_BUFFER_ENABLED = strategy == "buffered"
            samples = []
            for i in range(iterations + 5):
                secrets = load_secrets(target["env_id"])
                token = ServiceAccountToken.objects.get(id=sat.id)  # fresh, like a request
                t0 = time.perf_counter()
                if strategy == "orig":
                    orig_log_secret_events_bulk(secrets, "R", None, token, "10.0.0.1", "microbench")
                else:
                    audit_logging.log_secret_events_bulk(secrets, "R", None, token, "10.0.0.1", "microbench")
                dt = time.perf_counter() - t0
                if i >= 5:
                    samples.append(dt)
            row = {"set": set_name, "strategy": strategy, **summarize(samples)}
            results.append(row)
            print(json.dumps(row), flush=True)
    settings.SECRET_EVENT_BUFFER_ENABLED = False
    return results


# ---------------------------------------------------------------- flush side


def synthetic_entries(targets, n_entries, rows_per_entry=50):
    """(header, rows) pairs copied from real seeded secrets, fresh ids."""
    pool = []
    for t in targets:
        if t["set"] != "s50":
            continue
        secrets = load_secrets(t["env_id"])
        sat = ServiceAccountToken.objects.get(token=t["token"])
        pool.append((secrets, sat))
    entries = []
    for i in range(n_entries):
        secrets, sat = pool[i % len(pool)]
        header = buf.build_header("R", timezone.now(), None, sat, "10.0.0.1", "flushbench")
        rows = [
            buf.build_row(str(uuid4()), s, [tag.id for tag in s.tags.all()])
            for s in secrets[:rows_per_entry]
        ]
        entries.append((header, rows))
    return entries


def fill_stream(entries):
    client = buf.get_client()
    pipe = client.pipeline(transaction=False)
    script = client.register_script(buf._ENQUEUE_LUA)
    total = 0
    for header, rows in entries:
        blob = buf.encode_payload(header, rows)
        total += len(blob)
        script(keys=[buf.STREAM_KEY, buf.BYTES_KEY], args=[blob, 1 << 40, len(rows)], client=pipe)
    pipe.execute()
    return total


def redis_used_memory():
    return buf.get_client().info("memory")["used_memory"]


def bench_flush(targets):
    client = buf.get_client()
    client.delete(buf.STREAM_KEY, buf.BYTES_KEY)
    results = []

    # Redis memory per buffered event (stream overhead included).
    entries = synthetic_entries(targets, 1000)
    before = redis_used_memory()
    payload = fill_stream(entries)
    after = redis_used_memory()
    n_rows = sum(len(r) for _, r in entries)
    mem = {
        "kind": "redis_memory",
        "entries": len(entries),
        "rows": n_rows,
        "payload_bytes_per_event": round(payload / n_rows, 1),
        "redis_bytes_per_event": round((after - before) / n_rows, 1),
        "uncompressed_json_bytes_per_event": round(
            sum(len(json.dumps({"v": 1, "h": h, "r": r}, separators=(",", ":"))) for h, r in entries[:50])
            / sum(len(r) for _, r in entries[:50]),
            1,
        ),
    }
    print(json.dumps(mem), flush=True)
    results.append(mem)
    client.delete(buf.STREAM_KEY, buf.BYTES_KEY)

    # Flusher drain throughput by read batch size (entries per transaction).
    for batch_entries in (10, 50, 250, 1000):
        client.delete(buf.STREAM_KEY, buf.BYTES_KEY)
        entries = synthetic_entries(targets, 2000)
        fill_stream(entries)
        n_rows = sum(len(r) for _, r in entries)
        flusher = SecretEventFlusher(batch_entries=batch_entries, block_ms=50, stats_every_s=1e9)
        flusher.ensure_group()
        t0 = time.perf_counter()
        flusher.drain()
        dt = time.perf_counter() - t0
        row = {
            "kind": "flusher_drain",
            "batch_entries": batch_entries,
            "rows_per_txn": batch_entries * 50,
            "rows": flusher.totals["rows"],
            "expected_rows": n_rows,
            "seconds": round(dt, 2),
            "rows_per_s": round(flusher.totals["rows"] / dt),
        }
        print(json.dumps(row), flush=True)
        results.append(row)

    # Raw insert method comparison on identical rows (10k rows / transaction).
    entries = synthetic_entries(targets, 200)
    pairs = [p for h, r in entries for p in buf.rows_to_event_kwargs(h, r)]
    for method in ("orm_bulk_create", "execute_values", "copy"):
        fresh = [({**kw, "id": str(uuid4())}, tags) for kw, tags in pairs]
        t0 = time.perf_counter()
        if method == "orm_bulk_create":
            audit_logging.insert_secret_events(fresh)
        elif method == "execute_values":
            insert_execute_values(fresh)
        else:
            insert_copy(fresh)
        dt = time.perf_counter() - t0
        row = {"kind": "insert_method", "method": method, "rows": len(fresh), "seconds": round(dt, 3), "rows_per_s": round(len(fresh) / dt)}
        print(json.dumps(row), flush=True)
        results.append(row)
    return results


COLS = [
    "id", "secret_id", "environment_id", "folder_id", "path", "user_id",
    "service_token_id", "service_account_id", "service_account_token_id",
    "key", "key_digest", "value", "version", "comment", "type", "event_type",
    "timestamp", "ip_address", "user_agent",
]


def _row_tuple(kw):
    return (
        kw["id"], kw["secret_id"], kw["environment_id"], kw["folder_id"], kw["path"],
        kw["user_id"], None, kw["service_account_id"], kw["service_account_token_id"],
        kw["key"], kw["key_digest"], kw["value"], kw["version"], kw["comment"],
        kw["type"], kw["event_type"], kw["timestamp"], kw["ip_address"], kw["user_agent"],
    )


def insert_execute_values(pairs):
    from psycopg2.extras import execute_values

    with transaction.atomic():
        with connection.cursor() as cur:
            execute_values(
                cur.cursor,
                f"INSERT INTO api_secretevent ({','.join(COLS)}) VALUES %s ON CONFLICT DO NOTHING",
                [_row_tuple(kw) for kw, _ in pairs],
                page_size=1000,
            )
            execute_values(
                cur.cursor,
                "INSERT INTO api_secretevent_tags (secretevent_id, secrettag_id) VALUES %s ON CONFLICT DO NOTHING",
                [(kw["id"], t) for kw, tags in pairs for t in tags],
                page_size=1000,
            )


def _copy_escape(v):
    if v is None:
        return "\\N"
    s = v.isoformat() if hasattr(v, "isoformat") else str(v)
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def insert_copy(pairs):
    # COPY can't do ON CONFLICT, so stage into a temp table and merge.
    with transaction.atomic():
        with connection.cursor() as cur:
            raw = cur.cursor
            raw.execute("CREATE TEMP TABLE IF NOT EXISTS se_stage (LIKE api_secretevent INCLUDING DEFAULTS) ON COMMIT DELETE ROWS")
            raw.execute("CREATE TEMP TABLE IF NOT EXISTS se_tag_stage (secretevent_id text, secrettag_id text) ON COMMIT DELETE ROWS")
            buf_rows = io.StringIO()
            for kw, _ in pairs:
                buf_rows.write("\t".join(_copy_escape(v) for v in _row_tuple(kw)) + "\n")
            buf_rows.seek(0)
            raw.copy_from(buf_rows, "se_stage", columns=COLS)
            buf_tags = io.StringIO()
            for kw, tags in pairs:
                for t in tags:
                    buf_tags.write(f"{kw['id']}\t{t}\n")
            buf_tags.seek(0)
            raw.copy_from(buf_tags, "se_tag_stage", columns=("secretevent_id", "secrettag_id"))
            raw.execute(f"INSERT INTO api_secretevent ({','.join(COLS)}) SELECT {','.join(COLS)} FROM se_stage ON CONFLICT DO NOTHING")
            raw.execute("INSERT INTO api_secretevent_tags (secretevent_id, secrettag_id) SELECT secretevent_id, secrettag_id FROM se_tag_stage ON CONFLICT DO NOTHING")


def cleanup():
    """Delete the rows the micro-benchmarks inserted."""
    with connection.cursor() as cur:
        cur.execute(
            "DELETE FROM api_secretevent_tags WHERE secretevent_id IN "
            "(SELECT id FROM api_secretevent WHERE user_agent IN ('microbench', 'flushbench'))"
        )
        cur.execute("DELETE FROM api_secretevent WHERE user_agent IN ('microbench', 'flushbench')")
    buf.get_client().delete(buf.STREAM_KEY, buf.BYTES_KEY)


if __name__ == "__main__":
    mode = sys.argv[1]
    targets = json.load(open(sys.argv[2]))
    try:
        if mode == "request":
            bench_request(targets)
        elif mode == "flush":
            bench_flush(targets)
        else:
            raise SystemExit(f"unknown mode {mode}")
    finally:
        cleanup()
