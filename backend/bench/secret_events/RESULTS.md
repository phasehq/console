# Secret event logging: sync inserts vs Redis write-behind

_Experiment run 2026-10-31 on a 4-vCPU / 15 GB sandbox VM, everything in prod
mode (gunicorn with 8 sync workers, Postgres 15.4, Redis 7). Absolute numbers
are this box's; the ratios are what carry over._

## TL;DR

1. **The worst part of logging wasn't that it was synchronous.** The "bulk"
   logger lazy-loaded `secret.environment` once per secret, so a 50-secret
   read ran 78 queries instead of 27. Fixing that alone (first commit on
   this branch, standalone): p50 at normal load −30% (50 secrets) / −46%
   (200 secrets); saturated throughput +28% / +81%; **+77% with a 2 ms
   network round trip**, which is closer to production.
2. **Three simple changes beat the Redis buffer:** that fix, persistent DB
   connections (`CONN_MAX_AGE` is unset, so every request forks a fresh
   Postgres backend), and trimming `api_secretevent` from 19 indexes to 8 (no
   query loses its index). Together, against `main` on the same table
   (§10): **50-secret reads 15.1 → 46.2 req/s (3.1×), 200-secret reads 6.8 →
   16.8 req/s (2.5×), p50 at normal load 223 → 86 ms, total CPU per request
   about −60%**, and 57–73% less WAL per event. No new moving parts.
3. **Redis write-behind works and is safe.** Across every run and failure
   drill (Redis hung, flusher down, Postgres down, flusher SIGKILLed mid-
   batch, app deleted with events in flight) **no event was lost or
   duplicated**. Secrets themselves stay real-time in Postgres; only audit
   rows are deferred. Redis stays small: ~0.6 KB per event, backlog ≤ 1.5 MB
   whenever the flushers kept up, and a hard byte cap past which requests
   insert synchronously.
4. **On top of those three changes it is a latency feature, not a capacity
   one.** It takes the INSERT + COMMIT off the request: p50 at normal load
   86 → 58 ms (−33%) for 50 secrets. At saturation it was 3% *slower*
   (sustained 43.3 vs 44.7 req/s): Postgres does the same per-row work either
   way, and encoding + flushing costs 4–11% more CPU in total. Before the
   other fixes it looked better (+10% sustained; up to +89% in 30 s bursts
   that the flusher paid back afterwards), largely because it skipped the
   per-request connection setup and the 19 indexes, which the simple changes
   remove for every path.

**Recommended order:** ship the N+1 fix → persistent DB connections → trim
the SecretEvent indexes. Then turn the buffer on (READ events, 2 flushers)
only if the remaining read latency, about one INSERT + COMMIT per request, is
worth a Redis dependency on the audit path and a ~1 s loss window on a Redis
failover. That saving will be larger on RDS Multi-AZ, where every COMMIT
waits on synchronous replication (local fsync here was ~0.4 ms).

## What was built (this branch)

1. **N+1 fix in `log_secret_events_bulk` / `log_secret_event`.** Rows are
   built from `*_id` attributes (`secret.environment_id`, `folder_id`,
   `service_account_token.service_account_id`) instead of related objects.
   A 50-secret GET went from 78 queries to 27.
2. **Redis write-behind buffer** (`api/utils/secret_event_buffer.py`), off by
   default (`SECRET_EVENT_BUFFER_ENABLED`); buffers READ events by default
   (`SECRET_EVENT_BUFFER_EVENT_TYPES=R`).
   - One stream entry per request: a header with the request-wide fields
     (actor, IP, UA, event type, timestamp) plus one compact row per secret,
     JSON + zlib. One Redis round trip whatever the number of secrets.
   - Written in `transaction.on_commit`, so a rolled-back write never leaves
     a buffered event pointing at nothing.
   - Conditional `XADD` in Lua against a byte budget
     (`SECRET_EVENT_BUFFER_MAX_BYTES`, default 64 MB). Over budget, Redis
     error or timeout (`SECRET_EVENT_BUFFER_REDIS_TIMEOUT`, 250 ms) → the
     request inserts synchronously, as before. A per-process breaker skips
     Redis for 5 s after a failure. Fallbacks are logged as one summary line
     per process per 10 s.
   - Event ids are minted before the write and reused on the fallback path,
     so a write Redis accepted but whose reply was lost can't duplicate.
3. **Flusher** (`api/utils/secret_event_flusher.py`, `manage.py
   flush_secret_events`, supervised by `rqworker` when the buffer is on).
   - Consumer group: run any number (each one adds ~1.5–1.9k rows/s here);
     `rqworker` starts `SECRET_EVENT_FLUSH_CONSUMERS` of them (default 2).
   - Reads up to 250 entries (requests, from any tenant), inserts every row in
     one transaction with `ON CONFLICT DO NOTHING`, and only after COMMIT acks
     + deletes the entries and releases their bytes (one Lua call).
   - Postgres or Redis down: entries stay pending; backoff 0.5 s doubling to
     30 s with jitter; then the consumer retries its own pending entries first.
   - Parent hard-deleted while its events were buffered (org purge, app
     delete): rows are dropped or nulled exactly as `ON DELETE CASCADE` /
     `SET NULL` would have, without blocking other tenants' rows.
   - Poison entries go to a capped dead-letter stream: immediately if the
     rest of the batch inserts, otherwise after 10 attempts (so a systemic
     error waits instead of flooding the DLQ); `--replay-dead-letters`
     re-queues them.
   - Entries held by a dead consumer are reclaimed with `XAUTOCLAIM` after
     60 s idle (`--claim-idle-ms`).
4. **Event time is preserved.** `SecretEvent.timestamp` was `auto_now_add`,
   which overwrites any supplied value at INSERT, so deferred rows would have
   carried the flush time. It is now `default=timezone.now` (migration 0144,
   state-only, no SQL).
5. **Log streams stay correct.** The SIEM shipper only ships events older
   than a 30 s watermark and never looks back past its cursor, so late rows
   with their original timestamps would be skipped forever. With the buffer
   on, the watermark is held behind the oldest still-buffered entry; if Redis
   can't be read the sweep doesn't advance.

## Multi-tenancy

One flat stream for every tenant. Tenancy is a property of the row, not the
queue: each row carries its `environment_id` (hence app and org), exactly as
`api_secretevent` does. A single flusher INSERT carries rows for many
organisations. Per-tenant queues would only buy isolation or fairness, and
nothing here needs it. Capacity comes from adding consumers to the group,
and ordering doesn't matter because every row carries its own timestamp. A
deleted tenant's in-flight rows are dropped by the FK salvage, the same way
`ON DELETE CASCADE` treats rows already in Postgres.

## Method

- **Stack:** Postgres 15.4 and Redis 7 containers; backend images built from
  `main` (`orig`) and from this branch (`sync` = buffer off, `buffered` =
  buffer on, all event types, one flusher unless noted); gunicorn with 8 sync
  workers, which is what `start.sh` picks on 4 cores. Everything shares the
  4 vCPUs.
- **Data:** 20 orgs × 3 apps × 3 envs; the apps hold 10, 50 and 200 secrets
  per env (s10/s50/s200); about half the secrets are tagged; ciphertexts are
  real-sized `ph:v1:` strings. `api_secretevent` was pre-filled with 2.0M rows
  (3 GB) plus 1.4M tag links, so its indexes don't fit in shared_buffers.
- **Load:** closed-loop Go client on `GET /secrets/` (the endpoint the CLI and
  SDKs use) with service-account tokens, workers spread across tenants; `PUT
  /secrets/` updating 10 secrets per request. Variants interleaved,
  `CHECKPOINT` before each run, the run's rows deleted afterwards.
- **Checks:** after each run, once the flusher had drained, the number of rows
  with the run's user agent had to equal successful requests × secrets per
  request. **It matched in every run.** No run had an HTTP error.
- Every request opens a new Postgres connection (as in production; see §7).

## Results

### 1. Cost of the logging call alone (in-process, mean ms)

| secrets per request | `orig` | `sync` (N+1 fixed) | `buffered` (encode + one XADD) |
|---|---|---|---|
| 10  | 27.6  | 12.3  | 1.6  |
| 50  | 100.2 | 41.7  | 4.4  |
| 200 | 399.1 | 132.5 | 14.9 |

### 2. Latency at normal load (one request at a time, trimmed indexes)

What a `phase run` or a Kubernetes sync feels like when the server isn't busy:

| workload | variant | req/s | p50 ms | p99 ms | PG CPU ms/req | backend CPU ms/req | flusher CPU ms/req | PG commits/req | WAL KB/event | events ok | drain s | Redis peak KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET s10 c=1 | orig | 7.8 | 127 | 192 | 77.0 | 52.2 | 0.0 | 36.0 | 9.6 | yes (1780) | 0.0 | 0 |
| GET s10 c=1 | sync | 8.4 (+9%) | 116 (-9%) | 167 (-13%) | 75.7 | 44.6 | 0.0 | 25.1 | 9.6 | yes (1920) | 0.0 | 0 |
| GET s10 c=1 | buffered | 11.6 (+49%) | 84 (-34%) | 114 (-41%) | 60.8 | 35.0 | 4.3 | 25.0 | 9.1 | yes (2610) | 0.12 | 5 |
| GET s50 c=1 | orig | 4.8 | 200 | 371 | 102.4 | 97.0 | 0.0 | 76.1 | 8.7 | yes (5700) | 0.0 | 0 |
| GET s50 c=1 | sync | 6.7 (+39%) | 140 (-30%) | 323 (-13%) | 90.8 | 59.6 | 0.0 | 25.0 | 8.6 | yes (7650) | 0.0 | 0 |
| GET s50 c=1 | buffered | 10.2 (+111%) | 93 (-53%) | 235 (-37%) | 79.4 | 47.7 | 10.4 | 25.0 | 8.1 | yes (11300) | 0.11 | 22 |
| GET s200 c=1 | orig | 2.0 | 480 | 658 | 205.6 | 272.6 | 0.0 | 226.2 | 8.1 | yes (9400) | 0.0 | 0 |
| GET s200 c=1 | sync | 3.5 (+75%) | 261 (-46%) | 537 (-18%) | 159.8 | 119.6 | 0.0 | 25.0 | 7.4 | yes (16400) | 0.0 | 0 |
| GET s200 c=1 | buffered | 6.1 (+205%) | 148 (-69%) | 355 (-46%) | 146.8 | 98.8 | 32.2 | 25.0 | 6.5 | yes (28000) | 0.12 | 107 |

### 3. Throughput at saturation (30 s runs, original indexes)

| workload | variant | req/s | p50 ms | p99 ms | PG CPU ms/req | backend CPU ms/req | flusher CPU ms/req | PG commits/req | WAL KB/event | events ok | drain s | Redis peak KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET s10 c=8 | orig | 28.1 | 275 | 475 | 73.8 | 53.5 | 0.0 | 36.0 | 21.1 | yes (9900) | 0.0 | 0 |
| GET s10 c=8 | sync | 28.9 (+3%) | 268 (-2%) | 441 (-7%) | 78.1 | 45.9 | 0.0 | 25.0 | 21.0 | yes (10160) | 0.0 | 0 |
| GET s10 c=8 | buffered | 34.9 (+24%) | 220 (-20%) | 394 (-17%) | 59.3 | 39.5 | 3.2 | 24.6 | 19.4 | yes (12170) | 0.12 | 48 |
| GET s10 c=32 | orig | 27.3 | 1120 | 1403 | 73.6 | 52.7 | 0.0 | 36.0 | 20.6 | yes (10150) | 0.0 | 0 |
| GET s10 c=32 | sync | 30.5 (+12%) | 1005 (-10%) | 1288 (-8%) | 70.7 | 41.4 | 0.0 | 25.0 | 20.0 | yes (11420) | 0.0 | 0 |
| GET s10 c=32 | buffered | 32.8 (+20%) | 944 (-16%) | 1199 (-15%) | 61.3 | 41.2 | 3.3 | 24.6 | 19.4 | yes (12080) | 0.11 | 34 |
| GET s50 c=8 | orig | 16.2 | 481 | 851 | 113.5 | 111.5 | 0.0 | 76.0 | 15.0 | yes (28450) | 0.0 | 0 |
| GET s50 c=8 | sync | 20.7 (+28%) | 370 (-23%) | 724 (-15%) | 106.2 | 64.6 | 0.0 | 25.0 | 13.6 | yes (36600) | 0.0 | 0 |
| GET s50 c=8 | buffered | 27.8 (+72%) | 279 (-42%) | 526 (-38%) | 82.5 | 54.4 | 8.2 | 24.0 | 13.4 | yes (49700) | 18.01 | 18708 |
| GET s50 c=32 | orig | 13.5 | 2125 | 3128 | 121.9 | 120.0 | 0.0 | 76.0 | 15.6 | yes (27450) | 0.0 | 0 |
| GET s50 c=32 | sync | 18.9 (+40%) | 1582 (-26%) | 2066 (-34%) | 111.2 | 67.2 | 0.0 | 25.0 | 14.0 | yes (36300) | 0.0 | 0 |
| GET s50 c=32 | buffered | 25.5 (+89%) | 1190 (-44%) | 1733 (-45%) | 85.5 | 56.9 | 9.6 | 24.0 | 14.4 | yes (48250) | 17.31 | 16319 |
| GET s200 c=8 | orig | 5.3 | 1359 | 2689 | 276.6 | 388.3 | 0.0 | 226.1 | 13.2 | yes (39000) | 0.0 | 0 |
| GET s200 c=8 | sync | 9.6 (+81%) | 776 (-43%) | 1519 (-44%) | 221.2 | 144.6 | 0.0 | 25.0 | 14.2 | yes (69000) | 0.0 | 0 |
| GET s200 c=8 | buffered | 15.9 (+200%) | 452 (-67%) | 1542 (-43%) | 176.3 | 119.0 | 36.1 | 24.0 | 13.5 | yes (111000) | 56.02 | 55660 |
| GET s200 c=32 | orig | 5.2 | 4869 | 6096 | 246.6 | 342.5 | 0.0 | 226.0 | 16.7 | yes (49200) | 0.0 | 0 |
| GET s200 c=32 | sync | 8.8 (+71%) | 3215 (-34%) | 3976 (-35%) | 224.3 | 146.3 | 0.0 | 25.0 | 14.7 | yes (73400) | 0.0 | 0 |
| GET s200 c=32 | buffered | 16.6 (+221%) | 1759 (-64%) | 2915 (-52%) | 178.5 | 110.2 | 33.6 | 24.0 | 14.9 | yes (125600) | 67.35 | 64762 |
| PUT x10 c=8 | orig | 13.8 | 560 | 848 | 128.8 | 122.4 | 0.0 | 84.4 | 23.1 | yes (5000) | 0.0 | 0 |
| PUT x10 c=8 | sync | 14.6 (+6%) | 540 (-4%) | 743 (-12%) | 123.4 | 119.8 | 0.0 | 83.4 | 22.9 | yes (5140) | 0.0 | 0 |
| PUT x10 c=8 | buffered | 14.8 (+7%) | 525 (-6%) | 736 (-13%) | 112.8 | 121.3 | 4.5 | 83.3 | 23.0 | yes (5230) | 0.13 | 19 |

`PG commits/req`: every autocommit SELECT counts; the N+1 shows up as
36 → 25 (s10), 76 → 25 (s50) and 226 → 25 (s200). Total CPU per request across
containers, drain included, s50 c=8: `orig` 229 ms, `sync` 175 ms, `buffered`
152 ms. **The buffered rows overstate the gain:** for s50/s200 the flusher
fell behind (Redis 16–65 MB, 17–67 s to drain after the run), so part of that
throughput is work pushed past the end of the window. §4 shows steady state.

### 4. Sustained load (180 s, s50, c=8)

| schema | variant | req/s | p50 ms | p99 ms | buffer behaviour |
|---|---|---|---|---|---|
| original | `sync` | 22.7 | 342 | 609 | |
| original | `buffered`, 1 flusher, 16 MB budget | 24.9 (+10%) | 297 | 684 | full after ~40 s; ≥1,506 / 4,498 requests fell back to sync; Redis ≤ 16.8 MB |
| trimmed  | `sync` | 25.5 | 301 | 565 | |
| trimmed  | `buffered`, 1 flusher, 16 MB budget | 28.0 (+10%) | 269 | 588 | full after ~45 s; ≥1,345 / 5,044 fell back |
| trimmed  | `buffered`, **2 flushers** | 26.5 (+4%) | 288 | 568 | **kept up**: backlog 0.1–1.3 MB, 0 fallbacks, drained 2.5 s after the run |

The 2-flusher row is the honest steady state on this box: the flushers burn
the same 4 cores the API uses, so total work, and therefore throughput, barely
changes. On production hardware the flusher runs on worker nodes and the
inserts on RDS, so the API-side saving (§3: backend CPU/req 64.6 → 54.4 ms for
s50) and the Postgres-side saving (106 → 82.5 ms) land on different machines.

### 5. Flusher throughput and Redis footprint

| | original indexes | trimmed indexes |
|---|---|---|
| Redis memory per buffered event (payload 546 B, uncompressed 822 B) | 592 B | 592 B |
| one flusher, 10 / 50 / 250 / 1000 entries per txn | 1,503 / 1,539 / 1,571 / 1,559 rows/s | 1,763 / 1,881 / 1,851 / 1,846 rows/s |
| 10k rows via ORM `bulk_create` / `execute_values` / `COPY` | 1,632 / 1,817 / 1,914 rows/s | 1,895 / 1,968 / 2,284 rows/s |
| 1 / 2 / 4 flushers in parallel (incl. ~5 s start-up) | | 1,598 / 3,124 / 4,486 rows/s |

Batch size barely matters and `COPY` buys ~20%: the cost is per row inside
Postgres (index maintenance and WAL), so it scales by adding connections
(consumers), not by bigger batches. Each event row costs ~28 WAL records and
**13–21 KB of WAL** with the original indexes (mostly full-page images,
because random UUID keys touch a different index page per row).

### 6. With network latency (+2 ms RTT to Postgres and Redis, toxiproxy)

| workload | variant | req/s | p50 ms | p99 ms | PG CPU ms/req | backend CPU ms/req | flusher CPU ms/req | PG commits/req | WAL KB/event | events ok | drain s | Redis peak KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET s50 c=8 +2ms RTT | orig | 9.3 | 817 | 1089 | 129.2 | 139.6 | 0.0 | 76.0 | 15.7 | yes (17200) | 0.0 | 0 |
| GET s50 c=8 +2ms RTT | sync | 16.5 (+77%) | 472 (-42%) | 805 (-26%) | 111.1 | 64.9 | 0.0 | 25.0 | 13.7 | yes (29300) | 0.0 | 0 |
| GET s50 c=8 +2ms RTT | buffered | 20.9 (+124%) | 368 (-55%) | 685 (-37%) | 86.1 | 55.8 | 7.9 | 24.0 | 12.2 | yes (37250) | 6.58 | 7481 |
| PUT x10 c=8 +2ms RTT | orig | 8.9 | 868 | 1003 | 124.8 | 134.3 | 0.0 | 84.4 | 22.8 | yes (3230) | 0.0 | 0 |
| PUT x10 c=8 +2ms RTT | sync | 9.1 (+2%) | 862 (-1%) | 1026 (+2%) | 122.0 | 127.0 | 0.0 | 83.4 | 21.3 | yes (3280) | 0.0 | 0 |
| PUT x10 c=8 +2ms RTT | buffered | 9.0 (+1%) | 858 (-1%) | 1020 (+2%) | 113.4 | 128.0 | 4.6 | 83.3 | 21.0 | yes (3340) | 0.14 | 14 |

### 7. Side experiment: persistent DB connections (`CONN_MAX_AGE=60`)

`CONN_MAX_AGE` is unset, so every request forks a Postgres backend that
rebuilds its catalog caches. That includes the 19 + 6 event-table indexes
whenever the request inserts a log row. Same runs with persistent
connections:

| workload | variant | req/s | p50 ms | p99 ms | PG CPU ms/req | backend CPU ms/req | flusher CPU ms/req | PG commits/req | WAL KB/event | events ok | drain s | Redis peak KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET s50 c=8 | orig | 25.4 | 295 | 588 | 49.2 | 93.6 | 0.0 | 75.0 | 11.3 | yes (44850) | 0.0 | 0 |
| GET s50 c=8 | sync | 39.5 (+55%) | 189 (-36%) | 350 (-41%) | 43.3 | 51.6 | 0.0 | 24.5 | 12.0 | yes (66850) | 0.0 | 0 |
| GET s50 c=8 | buffered | 47.8 (+88%) | 156 (-47%) | 351 (-40%) | 38.3 | 47.2 | 8.0 | 24.0 | 11.9 | yes (81350) | 25.61 | 22383 |
| GET s200 c=8 | orig | 7.4 | 989 | 2065 | 173.3 | 316.3 | 0.0 | 223.7 | 12.4 | yes (53800) | 0.0 | 0 |
| GET s200 c=8 | sync | 14.5 (+95%) | 511 (-48%) | 1285 (-38%) | 132.2 | 121.0 | 0.0 | 24.9 | 12.0 | yes (102400) | 0.0 | 0 |
| GET s200 c=8 | buffered | 23.6 (+219%) | 279 (-72%) | 1137 (-45%) | 122.9 | 96.2 | 29.8 | 24.1 | 12.5 | yes (165400) | 76.53 | 65524 |

Against §3, Postgres CPU per request drops 30–60% (s50 `sync`: 106 → 43 ms)
and throughput rises 40–91%. **N+1 fix + persistent connections
take a 50-secret GET from 16.2 to 39.5 req/s (2.4×) without Redis.** The pool
is gunicorn workers × replicas, within the budget `start.sh` already plans
for; add `CONN_HEALTH_CHECKS=True`, or use PgBouncer / RDS Proxy.

### 8. Trimming the SecretEvent indexes (19 → 8, tags 6 → 3)

Dropped: the `text_pattern_ops` "_like" twins of the PK and all seven FK
columns (they only serve `LIKE 'prefix%'` on UUIDs; nothing does that); the
single-column `secret_id`, `environment_id` and `service_account_token_id`
indexes (each is the leading column of an existing composite); the tag
table's redundant `secretevent_id` index and its "_like" twins. The
`user_id`, `service_account_id`, `service_token_id` and `folder_id` indexes
became partial (`WHERE … IS NOT NULL`), so the common NULL rows skip them.
`EXPLAIN` confirms the logs view, secret history, token last-used and every FK
cascade / SET NULL path still use an index. Index size: 1.33 GB → 0.84 GB
(tags 0.49 → 0.28 GB). SQL in `index_cleanup.sql` (bench only; production
would use `DROP/CREATE INDEX CONCURRENTLY`).

| workload | variant | req/s | p50 ms | p99 ms | PG CPU ms/req | backend CPU ms/req | flusher CPU ms/req | PG commits/req | WAL KB/event | events ok | drain s | Redis peak KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET s50 c=8 | orig | 16.6 | 465 | 794 | 104.3 | 109.5 | 0.0 | 76.0 | 6.4 | yes (29650) | 0.0 | 0 |
| GET s50 c=8 | sync | 23.1 (+39%) | 332 (-29%) | 686 (-14%) | 95.0 | 59.2 | 0.0 | 25.0 | 5.9 | yes (41000) | 0.0 | 0 |
| GET s50 c=8 | buffered | 30.6 (+84%) | 251 (-46%) | 462 (-42%) | 74.0 | 47.5 | 7.5 | 24.0 | 5.2 | yes (54000) | 11.74 | 14095 |
| GET s200 c=8 | sync | 12.9 | 575 | 1338 | 163.4 | 113.0 | 0.0 | 25.0 | 4.2 | yes (93200) | 0.0 | 0 |
| GET s200 c=8 | buffered | 21.5 (+66%) | 331 (-43%) | 1077 (-20%) | 130.6 | 85.8 | 28.2 | 24.1 | 3.7 | yes (153600) | 55.99 | 65497 |

Against §3: WAL per event 13.6 → 5.9 KB (s50 `sync`) and 14.2 → 4.2 KB (s200);
`sync` +12% (s50) and +34% (s200); `buffered` +10% / +35%.

### 9. Failure modes (`failure_modes.py`, buffered, all pass)

| scenario | result |
|---|---|
| Redis paused for 8 s mid-load | 0 errors; requests paid the 250 ms timeout at most once per worker per 5 s breaker window, then inserted synchronously; 23,600 / 23,600 events; max latency 865 ms |
| Flusher stopped, 2 MB budget | Redis plateaued at 2.08 MB; 14,150 events inserted synchronously while it was down; all 18,700 landed after it restarted |
| App hard-deleted while 10 of its entries were buffered | its 100 rows were dropped (CASCADE semantics, logged); the other tenant's 50 rows in the same batch landed; 0 dead letters |
| Postgres paused 12 s with 233 entries buffered | entries stayed pending (the flusher's DB call waited); drained on recovery; 11,650 / 11,650 |
| Flusher SIGKILLed mid-drain (4,000 rows in, 5 entries read but unacked) | a second consumer reclaimed them after the idle timeout; 72,000 / 72,000 rows, 72,000 distinct ids |

### 10. Everything together (end state vs `main`, same table)

`orig` = `main`. `sync` = N+1 fix + `CONN_MAX_AGE=60` + trimmed indexes.
`buffered` = the same plus the buffer with 2 flushers (the shipped default).
`orig` runs on the trimmed indexes too; trimming gave `main` only +2% (§8),
so if anything the gains are understated.

| workload | variant | req/s | p50 ms | p99 ms | PG CPU ms/req | backend CPU ms/req | flusher CPU ms/req | PG commits/req | WAL KB/event | events ok | drain s | Redis peak KB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET s50 c=8 | orig | 15.1 | 515 | 911 | 110.4 | 117.0 | 0.0 | 76.0 | 6.4 | yes (27600) | 0.0 | 0 |
| GET s50 c=8 | sync | 46.2 (+206%) | 163 (-68%) | 305 (-67%) | 33.1 | 47.3 | 0.0 | 24.7 | 4.4 | yes (79200) | 0.0 | 0 |
| GET s50 c=8 | buffered | 41.3 (+174%) | 183 (-64%) | 362 (-60%) | 35.1 | 45.3 | 8.3 | 24.2 | 4.6 | yes (71750) | 0.11 | 558 |
| GET s200 c=8 | orig | 6.8 | 1074 | 2324 | 212.2 | 314.6 | 0.0 | 226.0 | 5.4 | yes (49200) | 0.0 | 0 |
| GET s200 c=8 | sync | 16.8 (+145%) | 431 (-60%) | 1195 (-49%) | 101.2 | 116.4 | 0.0 | 24.7 | 3.8 | yes (119200) | 0.0 | 0 |
| GET s200 c=8 | buffered | 18.3 (+168%) | 359 (-67%) | 1971 (-15%) | 100.2 | 97.1 | 32.6 | 24.1 | 3.6 | yes (131600) | 15.99 | 39869 |
| GET s50 c=1 | orig | 4.4 | 223 | 465 | 126.3 | 109.3 | 0.0 | 76.1 | 8.5 | yes (7700) | 0.0 | 0 |
| GET s50 c=1 | sync | 10.9 (+149%) | 86 (-61%) | 260 (-44%) | 38.6 | 50.8 | 0.0 | 23.6 | 7.0 | yes (18650) | 0.0 | 0 |
| GET s50 c=1 | buffered | 16.3 (+273%) | 58 (-74%) | 213 (-54%) | 39.3 | 44.9 | 10.6 | 23.5 | 6.6 | yes (27800) | 0.13 | 22 |

Total CPU per request, all containers: s50 c=8 `orig` 232 / `sync` 82 /
`buffered` 91 ms; s200 538 / 222 / 239 ms; s50 c=1 253 / 96 / 101 ms.

Sustained 180 s, s50 c=8:

| | req/s | p50 ms | p99 ms | p99.9 ms | notes |
|---|---|---|---|---|---|
| `sync` | 44.7 | 164 | 353 | 874 | 402,350 / 402,350 events |
| `buffered`, 2 flushers | 43.3 (−3%) | 170 | 387 | 1066 | flushers kept up: backlog ≤ 1.1 MB, 0 fallbacks, drained 1.7 s after the run; 390,150 / 390,150 events |

With connections reused, the synchronous insert is cheap for Postgres
(33 vs 35 ms of Postgres CPU per request), so batching saves nothing there.
The buffer then only relocates work (encode on the request, decode + insert
in the flusher), which costs 4–11% more CPU overall. What it still buys is
that the request doesn't wait for the INSERT and COMMIT: −33% p50 at normal
load.

## Queue shape, timeouts and backoffs (as shipped)

| knob | default | why |
|---|---|---|
| `SECRET_EVENT_BUFFER_ENABLED` | `false` | opt-in |
| `SECRET_EVENT_BUFFER_EVENT_TYPES` | `R` | reads are the volume; buffering writes measured +1% on PUT (logging is a sliver of a write's cost) and would make the history panel lag and put write audits behind Redis durability |
| `SECRET_EVENT_BUFFER_REDIS_TIMEOUT` | 250 ms | the whole enqueue measured 1.6 / 4.4 / 14.9 ms for 10 / 50 / 200 secrets (mostly JSON + zlib); the timeout only bites in a Redis brownout |
| breaker | 5 s per process | after a Redis error, skip Redis for 5 s instead of paying the timeout on every request |
| `SECRET_EVENT_BUFFER_MAX_BYTES` | 64 MB | ≈110k events at 592 B. Size it as peak events/s × the flusher outage you want to ride out; past it requests insert synchronously (slower, never lossy) |
| `SECRET_EVENT_FLUSH_CONSUMERS` | 2 per worker container | one consumer is ~1.5–1.9k rows/s here and a single one fell behind at saturation; two kept up (§4, §10) and give HA |
| `SECRET_EVENT_FLUSH_BATCH_ENTRIES` | 250 | entries per read/transaction; throughput is flat from 10 to 1000, this only bounds transaction size |
| `SECRET_EVENT_FLUSH_BLOCK_MS` | 1000 | XREADGROUP block; idle cost is one blocked read per second |
| flusher backoff | 0.5 s doubling to 30 s, jittered | on Postgres or Redis errors; entries stay pending |
| reclaim (`--claim-idle-ms`) | 60 s | entries held by a dead consumer are taken over |
| dead letters | 10 attempts / immediate if the batch's other entries succeed; capped at 10k | `--replay-dead-letters` re-queues them |

Monitor: stream length, bytes and oldest-entry age (`secret_event_buffer.stats()`;
the oldest entry also holds the log-stream watermark), dead-letter length
(alert on > 0), the flusher's 10 s `rows/s … lag_ms p50/p99` line, and the
backend's `Secret event buffer fallback` warning.

Why a stream with a consumer group rather than RQ jobs: one RQ job per request
stores the payload plus job metadata in its own hash and gives one
transaction per job, which is the per-request insert we're trying to remove. A
stream entry is just the compressed payload; consumer groups give
at-least-once delivery with acks and reclaim; XREADGROUP batches across
requests and tenants into one INSERT; the byte budget gives backpressure.

## Risks and trade-offs

- **Durability window.** A buffered event lives only in Redis until flushed
  (under a second when the flusher keeps up). ElastiCache/Valkey replicates
  asynchronously, so a primary failure can lose what wasn't replicated:
  normally about a second of read events, at most the whole backlog (≤ the
  budget) if the flusher was behind. This is why writes stay synchronous by
  default.
- **Freshness.** Read events appear in the logs UI after the flusher lag
  (sub-second when keeping up). SIEM log streams wait for the buffer too: if
  the flusher is down, shipping pauses and resumes, it never skips.
- **Postgres per-row cost is unchanged** (§4–5). Throughput is bounded by how
  fast the flushers can insert; beyond that the budget hands the overflow back
  to synchronous inserts. Once connections are reused, the buffer costs 4–11%
  more total CPU than inserting synchronously (§10).
- **`purge_app_logs` edge case.** Events still buffered when an app's logs are
  purged land afterwards (seconds' worth). Add a drain-first if purges must be
  exact.
- The stream sits on a single Redis Cluster shard (hash tag). Fine at 592 B
  per event under a 64 MB cap.

## Other things found along the way (not changed here)

- The auth path runs ~24 queries per GET (the token row is fetched 4×, the
  service account 3×, the organisation 3×) and an `UPDATE … last_used_at` on
  every request: a write transaction per read. Coalescing `last_used_at`
  (e.g. at most once a minute, or through this buffer) removes it.
- A 10-secret PUT runs ~84 statements (per-secret lookups, tag resolution and
  saves in a loop): the same per-row pattern on the write path.
- The worker container ignores SIGTERM: `rqworker` runs as PID 1 with no
  handler, so `docker stop` / pod termination always ends in SIGKILL after
  the grace period. The flusher is safe under SIGKILL (the crash drill above),
  but a SIGTERM handler that forwards to the children would make stops
  graceful for RQ jobs too.
- READ events copy the full ciphertext (key, value, comment) into every row;
  that's most of the 592 B in Redis and of the table's 3 GB here. Storing
  `secret_id` + `version` for reads would shrink both several-fold, but it's a
  product decision (what the logs UI shows for a read of an older version).
