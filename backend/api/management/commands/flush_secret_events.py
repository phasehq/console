import signal

from django.conf import settings
from django.core.management.base import BaseCommand

from api.utils.secret_event_flusher import SecretEventFlusher


class Command(BaseCommand):
    help = (
        "Drain the Redis write-behind buffer of secret events into Postgres. "
        "Safe to run several in parallel (they share a consumer group)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--batch-entries",
            type=int,
            default=settings.SECRET_EVENT_FLUSH_BATCH_ENTRIES,
            help="Stream entries (requests) per read/INSERT transaction.",
        )
        parser.add_argument(
            "--block-ms",
            type=int,
            default=settings.SECRET_EVENT_FLUSH_BLOCK_MS,
            help="How long a read waits for new entries before looping.",
        )
        parser.add_argument(
            "--claim-idle-ms",
            type=int,
            default=60_000,
            help="Reclaim entries another consumer has held unacked this long.",
        )
        parser.add_argument(
            "--drain",
            action="store_true",
            help="Flush whatever is buffered, then exit.",
        )
        parser.add_argument(
            "--replay-dead-letters",
            action="store_true",
            help="Move dead-lettered entries back onto the stream, then exit.",
        )

    def handle(self, *args, **options):
        flusher = SecretEventFlusher(
            batch_entries=options["batch_entries"],
            block_ms=options["block_ms"],
            claim_idle_ms=options["claim_idle_ms"],
        )

        if options["replay_dead_letters"]:
            moved = flusher.replay_dead_letters()
            self.stdout.write(f"Re-queued {moved} dead-lettered entries")
            return

        if options["drain"]:
            flusher.drain()
            self.stdout.write(str(flusher.totals))
            return

        stopping = {"flag": False}

        def _stop(signum, frame):
            # Finish the in-flight batch (its entries are acked only after
            # COMMIT), then exit.
            stopping["flag"] = True

        signal.signal(signal.SIGTERM, _stop)
        signal.signal(signal.SIGINT, _stop)
        flusher.run(should_stop=lambda: stopping["flag"])
