"""Consumer that drains the secret event write-behind buffer into Postgres.

Run with ``python manage.py flush_secret_events`` (the ``rqworker`` command
supervises one automatically when SECRET_EVENT_BUFFER_ENABLED is set). Any
number can run against the same Redis: they share one consumer group, so each
entry is delivered to exactly one of them at a time.

Per iteration:

1. Read up to ``batch_entries`` entries (each entry is one request's worth of
   events, from any tenant) with XREADGROUP, blocking up to ``block_ms``.
2. Insert every row in one transaction (multi-row INSERT ... ON CONFLICT DO
   NOTHING, so redelivered entries are harmless).
3. Only after COMMIT, XACK + XDEL the entries and release their bytes from
   the budget. A crash anywhere before this leaves them pending for redelivery.

Failure handling:

* Postgres/Redis unavailable: keep the entries pending, back off
  exponentially (0.5s doubling to 30s, with jitter), then retry this
  consumer's own pending entries before reading new ones.
* Foreign-key violation (a secret, environment or folder was hard-deleted
  while its events sat in the buffer): drop the rows whose parent is gone,
  exactly as ON DELETE CASCADE would have, null actors that no longer exist
  (ON DELETE SET NULL), and retry. Anything that still fails is isolated per
  entry and moved to a capped dead-letter stream rather than blocking the
  queue.
* A consumer that died mid-batch: its entries are reclaimed with XAUTOCLAIM
  once they have been idle for ``claim_idle_ms``.
"""

import logging
import random
import time
from collections import deque

from django.db import DatabaseError, InterfaceError, OperationalError, connection

from api.utils import secret_event_buffer as buf

logger = logging.getLogger(__name__)

DEAD_LETTER_MAXLEN = 10_000

# Connectivity problems: keep the entries pending and retry after a backoff.
TRANSIENT_DB_ERRORS = (OperationalError, InterfaceError)

# An entry whose rows keep failing for a non-transient reason is moved to the
# dead-letter stream after this many attempts (~2.5 min with backoff), so a
# systemic error (e.g. schema drift mid-deploy) waits instead of draining the
# whole queue into the dead-letter stream.
MAX_ENTRY_ATTEMPTS = 10


def _entry_time(entry_id):
    if isinstance(entry_id, bytes):
        entry_id = entry_id.decode()
    return int(entry_id.split("-", 1)[0]) / 1000.0


class SecretEventFlusher:
    def __init__(
        self,
        consumer=None,
        batch_entries=250,
        block_ms=1000,
        claim_idle_ms=60_000,
        claim_every_s=30.0,
        cleanup_every_s=600.0,
        consumer_max_idle_ms=3_600_000,
        max_backoff_s=30.0,
        insert_batch_size=1000,
        stats_every_s=10.0,
    ):
        import redis

        self._redis_errors = (redis.ConnectionError, redis.TimeoutError)
        self._response_error = redis.ResponseError
        self.consumer = consumer or buf.default_consumer_name()
        self.batch_entries = batch_entries
        self.block_ms = block_ms
        self.claim_idle_ms = claim_idle_ms
        self.claim_every_s = claim_every_s
        self.cleanup_every_s = cleanup_every_s
        self.consumer_max_idle_ms = consumer_max_idle_ms
        self.max_backoff_s = max_backoff_s
        self.insert_batch_size = insert_batch_size
        self.stats_every_s = stats_every_s

        # Socket timeout must outlast the XREADGROUP block.
        self.client = buf.make_client(timeout=block_ms / 1000.0 + 5.0)
        self._ack = self.client.register_script(buf._ACK_LUA)

        self._drain_own_pending = True
        self._last_claim = 0.0
        self._last_cleanup = 0.0
        self._failures = 0
        self._entry_attempts = {}
        self._window = deque()  # (flush_time, rows, lag_seconds)
        self._last_stats = time.monotonic()
        self.totals = {"rows": 0, "entries": 0, "dropped_rows": 0, "dead_letters": 0}

    # ------------------------------------------------------------------ setup

    def ensure_group(self):
        try:
            # id "0": also deliver entries written before the group existed
            # (e.g. after a Redis restart wiped the group but producers have
            # already recreated the stream).
            self.client.xgroup_create(
                buf.STREAM_KEY, buf.CONSUMER_GROUP, id="0", mkstream=True
            )
        except self._response_error as e:
            if "BUSYGROUP" not in str(e):
                raise

    # ------------------------------------------------------------------- loop

    def run(self, should_stop=lambda: False):
        logger.info("Secret event flusher %s starting", self.consumer)
        self.ensure_group()
        while not should_stop():
            try:
                self.step()
                self._failures = 0
            except self._redis_errors:
                # An ack may have been lost after COMMIT: re-read our own
                # pending entries first (re-inserting them is a no-op).
                logger.warning("Flusher lost Redis; backing off", exc_info=True)
                self._drain_own_pending = True
                self._backoff()
            except DatabaseError:
                # Entries stay pending; reconnect and retry them first.
                logger.warning("Flusher database error; backing off", exc_info=True)
                self._reset_db()
                self._drain_own_pending = True
                self._backoff()
            except Exception:
                logger.exception("Unexpected flusher error; backing off")
                self._reset_db()
                self._drain_own_pending = True
                self._backoff()
        logger.info("Secret event flusher %s stopped: %s", self.consumer, self.totals)

    def step(self):
        """One read/insert/ack cycle. Returns the number of entries handled."""
        now = time.monotonic()
        if now - self._last_claim >= self.claim_every_s:
            self._last_claim = now
            handled = self.claim_stale()
            if handled:
                return handled

        if now - self._last_cleanup >= self.cleanup_every_s:
            self._last_cleanup = now
            self.remove_dead_consumers()

        entries = self._read()
        if entries:
            self.process(entries)
        self._maybe_log_stats()
        return len(entries)

    def drain(self, idle_reads=1):
        """Flush until the stream is empty (used by tests/benchmarks)."""
        self.ensure_group()
        idle = 0
        while idle < idle_reads:
            if self.step() == 0:
                idle += 1
            else:
                idle = 0

    # ------------------------------------------------------------------- read

    def _read(self):
        try:
            if self._drain_own_pending:
                resp = self.client.xreadgroup(
                    buf.CONSUMER_GROUP,
                    self.consumer,
                    {buf.STREAM_KEY: "0"},
                    count=self.batch_entries,
                )
                entries = resp[0][1] if resp else []
                if entries:
                    return entries
                self._drain_own_pending = False

            resp = self.client.xreadgroup(
                buf.CONSUMER_GROUP,
                self.consumer,
                {buf.STREAM_KEY: ">"},
                count=self.batch_entries,
                block=self.block_ms,
            )
            return resp[0][1] if resp else []
        except self._response_error as e:
            if "NOGROUP" in str(e):
                # Stream or group vanished (Redis restart without persistence).
                self.ensure_group()
                return []
            raise

    def remove_dead_consumers(self):
        """Forget consumers from old processes (every deploy or restart adds
        a new name). Only ones with nothing pending: deleting a consumer that
        still owns entries would drop them from the group."""
        removed = 0
        for info in self.client.xinfo_consumers(buf.STREAM_KEY, buf.CONSUMER_GROUP):
            name = info.get("name")
            if isinstance(name, bytes):
                name = name.decode()
            if (
                name != self.consumer
                and int(info.get("pending", 0)) == 0
                and int(info.get("idle", 0)) > self.consumer_max_idle_ms
            ):
                self.client.xgroup_delconsumer(buf.STREAM_KEY, buf.CONSUMER_GROUP, name)
                removed += 1
        if removed:
            logger.info("Removed %s idle secret event consumers", removed)
        return removed

    def claim_stale(self):
        """Take over entries a dead consumer read but never acked."""
        handled = 0
        start = "0-0"
        for _ in range(10):  # bounded per pass
            resp = self.client.xautoclaim(
                buf.STREAM_KEY,
                buf.CONSUMER_GROUP,
                self.consumer,
                min_idle_time=self.claim_idle_ms,
                start_id=start,
                count=self.batch_entries,
            )
            start, entries = resp[0], resp[1]
            if entries:
                logger.warning(
                    "Reclaimed %s stale secret event entries", len(entries)
                )
                self.process(entries)
                handled += len(entries)
            if start in (b"0-0", "0-0"):
                break
        return handled

    # ---------------------------------------------------------------- process

    def process(self, entries):
        decoded = []  # (entry_id, blob, pairs)
        ack_ids = []
        ack_bytes = 0
        for entry_id, fields in entries:
            ack_ids.append(entry_id)
            if not fields:
                # Already deleted (acked by a previous owner); just ack.
                continue
            blob = fields.get(b"d") or fields.get("d")
            ack_bytes += len(blob)
            try:
                header, rows = buf.decode_payload(blob)
                pairs = buf.rows_to_event_kwargs(header, rows)
            except Exception as e:
                self._dead_letter(entry_id, blob, f"decode: {e!r}")
                continue
            decoded.append((entry_id, blob, pairs))

        rows = self._insert(decoded)

        self._ack(
            keys=[buf.STREAM_KEY, buf.BYTES_KEY],
            args=[buf.CONSUMER_GROUP, ack_bytes, *ack_ids],
        )

        flushed_at = time.time()
        for entry_id, _, pairs in decoded:
            self._window.append((flushed_at, len(pairs), flushed_at - _entry_time(entry_id)))
        self.totals["rows"] += rows
        self.totals["entries"] += len(ack_ids)
        return rows

    def _insert(self, decoded):
        from api.utils.audit_logging import insert_secret_events

        pairs = [p for _, _, entry_pairs in decoded for p in entry_pairs]
        if not pairs:
            return 0
        try:
            return insert_secret_events(pairs, batch_size=self.insert_batch_size)
        except TRANSIENT_DB_ERRORS:
            raise
        except Exception:
            logger.warning(
                "Secret event batch of %s rows failed; salvaging", len(pairs), exc_info=True
            )
        return self._insert_salvaged(decoded)

    def _insert_salvaged(self, decoded):
        from api.utils.audit_logging import insert_secret_events

        sanitized = self._sanitize([p for _, _, pairs in decoded for p in pairs])
        try:
            inserted = insert_secret_events(sanitized, batch_size=self.insert_batch_size)
            self._forget_attempts(decoded)
            return inserted
        except TRANSIENT_DB_ERRORS:
            raise
        except Exception:
            pass

        # Still failing: isolate entry by entry. Each insert is its own
        # transaction, so the good entries land even if a neighbour is poison.
        inserted = 0
        failures = []
        for entry in decoded:
            entry_id, blob, pairs = entry
            try:
                inserted += insert_secret_events(
                    self._sanitize(pairs), batch_size=self.insert_batch_size
                )
                self._forget_attempts([entry])
            except TRANSIENT_DB_ERRORS:
                raise
            except Exception as e:
                failures.append((entry, e))

        if not failures:
            return inserted

        some_succeeded = len(failures) < len(decoded)
        retry_later = []
        for entry, error in failures:
            entry_id, blob, _ = entry
            attempts = self._entry_attempts.get(entry_id, 0) + 1
            self._entry_attempts[entry_id] = attempts
            if some_succeeded or attempts >= MAX_ENTRY_ATTEMPTS:
                self._dead_letter(entry_id, blob, f"insert after {attempts} attempt(s): {error!r}")
                self._entry_attempts.pop(entry_id, None)
            else:
                retry_later.append(error)

        if retry_later:
            # Everything failed and nothing is clearly poison yet: treat as
            # systemic, leave the entries pending and back off. (The good
            # entries in this batch, if any, were inserted and are re-inserted
            # as no-ops next time.)
            raise retry_later[-1]
        return inserted

    def _forget_attempts(self, decoded):
        for entry_id, _, _ in decoded:
            self._entry_attempts.pop(entry_id, None)

    def _sanitize(self, pairs):
        """Apply the FK semantics Postgres would have applied had the rows
        been inserted before their parents were deleted."""
        from api.models import (
            Environment,
            OrganisationMember,
            Secret,
            SecretFolder,
            SecretTag,
            ServiceAccount,
            ServiceAccountToken,
        )

        existing = self._existing_ids

        secrets = existing(Secret, (kw["secret_id"] for kw, _ in pairs))
        envs = existing(Environment, (kw["environment_id"] for kw, _ in pairs))
        folders = existing(SecretFolder, (kw["folder_id"] for kw, _ in pairs))
        members = existing(OrganisationMember, (kw["user_id"] for kw, _ in pairs))
        sas = existing(ServiceAccount, (kw["service_account_id"] for kw, _ in pairs))
        sats = existing(
            ServiceAccountToken, (kw["service_account_token_id"] for kw, _ in pairs)
        )
        tags = existing(SecretTag, (t for _, ts in pairs for t in ts))

        kept = []
        dropped = 0
        for kwargs, tag_ids in pairs:
            if (
                kwargs["secret_id"] not in secrets
                or kwargs["environment_id"] not in envs
                or (kwargs["folder_id"] and kwargs["folder_id"] not in folders)
            ):
                dropped += 1  # ON DELETE CASCADE
                continue
            kwargs = dict(kwargs)
            for field, alive in (
                ("user_id", members),
                ("service_account_id", sas),
                ("service_account_token_id", sats),
            ):
                if kwargs[field] and kwargs[field] not in alive:
                    kwargs[field] = None  # ON DELETE SET NULL
            kept.append((kwargs, [t for t in tag_ids if t in tags]))

        if dropped:
            self.totals["dropped_rows"] += dropped
            logger.info(
                "Dropped %s buffered secret events whose secret/environment/folder "
                "was deleted before flush",
                dropped,
            )
        return kept

    def replay_dead_letters(self, limit=None):
        """Move dead-lettered entries back onto the main stream (after the
        cause has been fixed). Returns the number moved."""
        moved = 0
        enqueue = self.client.register_script(buf._ENQUEUE_LUA)
        while limit is None or moved < limit:
            batch = self.client.xrange(buf.DEAD_LETTER_KEY, count=100)
            if not batch:
                break
            for entry_id, fields in batch:
                blob = fields.get(b"d") or fields.get("d")
                if blob:
                    enqueue(
                        keys=[buf.STREAM_KEY, buf.BYTES_KEY],
                        args=[blob, 1 << 62, 0],
                    )
                self.client.xdel(buf.DEAD_LETTER_KEY, entry_id)
                moved += 1
        return moved

    @staticmethod
    def _existing_ids(model, ids):
        ids = {i for i in ids if i}
        if not ids:
            return set()
        return set(model.objects.filter(id__in=ids).values_list("id", flat=True))

    def _dead_letter(self, entry_id, blob, reason):
        logger.error("Dead-lettering secret event entry %s: %s", entry_id, reason)
        self.client.xadd(
            buf.DEAD_LETTER_KEY,
            {"d": blob, "src": entry_id, "err": reason[:1000]},
            maxlen=DEAD_LETTER_MAXLEN,
            approximate=True,
        )
        self.totals["dead_letters"] += 1

    # ---------------------------------------------------------------- helpers

    def _backoff(self):
        self._failures += 1
        delay = min(self.max_backoff_s, 0.5 * (2 ** (self._failures - 1)))
        time.sleep(delay * random.uniform(0.5, 1.0))

    @staticmethod
    def _reset_db():
        try:
            connection.close()
        except Exception:
            pass

    def _maybe_log_stats(self):
        now = time.monotonic()
        if now - self._last_stats < self.stats_every_s:
            return
        self._last_stats = now
        cutoff = time.time() - self.stats_every_s
        while self._window and self._window[0][0] < cutoff:
            self._window.popleft()
        if not self._window:
            return
        lags = sorted(lag for _, _, lag in self._window)
        rows = sum(n for _, n, _ in self._window)

        def pct(p):
            return lags[min(len(lags) - 1, int(p * len(lags)))] * 1000

        logger.info(
            "secret-event-flusher rows/s=%.0f entries=%s lag_ms p50=%.0f p99=%.0f max=%.0f totals=%s",
            rows / self.stats_every_s,
            len(lags),
            pct(0.50),
            pct(0.99),
            lags[-1] * 1000,
            self.totals,
        )
