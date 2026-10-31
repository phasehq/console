# Secret event logging benchmark

Compares three ways of writing `SecretEvent` audit rows on the secrets API:

| variant    | image                      | what it does                                                                 |
|------------|----------------------------|------------------------------------------------------------------------------|
| `orig`     | `main` before this branch  | `log_secret_events_bulk` lazy-loads `secret.environment` per secret (N+1)    |
| `sync`     | this branch, buffer off    | one multi-row INSERT for events + one for tags, no per-secret queries        |
| `buffered` | this branch, buffer on     | one compressed Redis stream entry per request; `flush_secret_events` bulk-inserts |

Everything runs in prod mode: the backend image runs gunicorn with the same
worker count `scripts/start.sh` picks (min(2·cores+1, 8)).

## Layout

- `seed.py`: creates 20 orgs × 3 apps (10/50/200 secrets per env) × 3 envs,
  one service-account token per org, tags on ~half the secrets, and realistic
  ciphertext sizes. Writes `targets.json`.
- `loadgen/`: closed-loop Go load generator. Workers are spread across
  tenants; prints throughput and latency percentiles as JSON.
- `run_bench.py`: orchestrates the runs. Per run it restarts the backend for
  the variant, snapshots Postgres (`pg_stat_wal`, commits, inserts), Redis and
  per-container cgroup CPU, runs the load, waits for the flusher to drain,
  checks that exactly `requests × secrets` rows landed, then deletes the run's
  rows so every run starts from the same table state.
- `microbench.py`: in-process timings of the logging call alone, flusher drain
  throughput by batch size, and ORM `bulk_create` vs `execute_values` vs `COPY`.
- `bench_settings.py`: overlay that turns on persistent DB connections
  (`CONN_MAX_AGE=60`) for the side experiment.
- `sustained.py`: long run that samples the buffer backlog, flusher insert
  rate and budget fallbacks every 2 s.
- `failure_modes.py`: Redis hang, flusher down until the budget is hit, app
  hard-deleted while its events are buffered, Postgres outage, flusher
  SIGKILL mid-drain.
- `summarize.py`: markdown tables from the JSONL results.

## Reproduce

`$W` is a scratch directory that holds `bench.env`, `targets.json` and the
`loadgen` binary.

```sh
# infra (host networking so toxiproxy can sit in front of both stores)
docker run -d --name bench-pg --network host -e POSTGRES_DB=phase -e POSTGRES_USER=phase \
  -e POSTGRES_PASSWORD=phase postgres:15.4-alpine3.17 postgres -p 5433 -c max_connections=300 \
  -c shared_buffers=512MB -c dynamic_shared_memory_type=mmap
docker run -d --name bench-redis --network host redis:alpine3.19 redis-server --port 6380 --save "" --appendonly no

# images: main as phasehq/backend:baseline, this branch as phasehq/backend:buffered
docker run --rm --network host --env-file $W/bench.env -e DATABASE_PORT=5433 -e REDIS_PORT=6380 \
  phasehq/backend:buffered python manage.py migrate
docker run --rm --network host --env-file $W/bench.env -e DATABASE_PORT=5433 -e REDIS_PORT=6380 \
  -v $W:/out phasehq/backend:buffered python bench/secret_events/seed.py /out/targets.json

# optional: pre-populate api_secretevent (the benchmark used 2M rows) so the
# indexes don't fit in shared_buffers, as in production

(cd loadgen && go build -o $W/loadgen .)
python3 run_bench.py --workdir $W --envfile $W/bench.env --out $W/main.jsonl --plan main
python3 run_bench.py --workdir $W --envfile $W/bench.env --out $W/latency.jsonl --plan latency --latency-ms 2   # toxiproxy-server on :8474
python3 run_bench.py --workdir $W --envfile $W/bench.env --out $W/pconn.jsonl --plan pconn --persistent-conns
python3 sustained.py $W buffered 180 16777216     # does the flusher keep up? (16 MB budget)
python3 sustained.py $W sync 180
docker run --rm --network host --env-file $W/bench.env -e DATABASE_PORT=5433 -e REDIS_PORT=6380 \
  -v $PWD:/app/bench/secret_events:ro -v $W:/out phasehq/backend:buffered \
  python bench/secret_events/microbench.py flush /out/targets.json
python3 failure_modes.py $W
python3 summarize.py $W/main.jsonl
```

`bench.env` needs `SECRET_KEY`, `SERVER_SECRET`, `ALLOWED_HOSTS=localhost,127.0.0.1`,
`DATABASE_HOST=127.0.0.1`, `DATABASE_NAME/USER/PASSWORD=phase`, `REDIS_HOST=127.0.0.1`.
