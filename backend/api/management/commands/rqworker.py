from django.core.management.base import BaseCommand
from django.core import management
import logging
import multiprocessing
from multiprocessing.connection import wait
import os
import sys
from django_rq.management.commands.rqworker import Command as OriginalRQWorkerCommand

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Runs both RQ worker and RQ scheduler in parallel"

    def add_arguments(self, parser):
        parser.add_argument(
            "queue",
            nargs="?",
            default="default",
            help="The name of the queue to process",
        )
        parser.add_argument(
            "--num-workers",
            type=int,
            default=1,
            help="Number of workers to spawn",
        )

    def run_default_workers(self, queue="default", workers=3):
        """Starts the RQ worker"""
        self.stdout.write(
            self.style.SUCCESS(
                f"Starting default RQ worker pool with {workers} workers..."
            )
        )

        management.call_command("rqworker-pool", queue, num_workers=workers)

    def run_scheduled_jobs_worker(self):
        """Starts the RQ worker"""
        self.stdout.write(
            self.style.SUCCESS("Starting RQ worker for scheduled jobs...")
        )

        # Call the original rqworker command
        OriginalRQWorkerCommand().run_from_argv(
            ["manage.py", "rqworker", "scheduled-jobs", "--with-scheduler"]
        )

    def run_scheduler(self):
        """Starts the RQ scheduler"""
        self.stdout.write(self.style.SUCCESS("Starting RQ scheduler..."))
        # Default rqscheduler interval is 60s, so an enqueue_at job waits up
        # to a full minute past its due time before being moved to the queue.
        management.call_command("rqscheduler", "scheduled-jobs", interval=2)

    def run_log_streams_workers(self):
        """Starts the worker pool for the log-streams queue.

        Log shipping is network-I/O bound and per-stream serialized, so
        useful concurrency ~= number of active streams. Sized via the
        LOG_STREAM_WORKERS env var.

        Parsed defensively: this runs in a supervised child, and a crash here
        (e.g. a typo'd env value) would tear down the whole worker container
        — syncs, emails and rotations included, not just log streams. A
        zero/negative value would silently starve the queue while the
        container looks healthy, so it is clamped to 1.
        """
        default_workers = 2
        raw = os.getenv("LOG_STREAM_WORKERS", "")
        try:
            workers = int(raw) if raw.strip() else default_workers
        except ValueError:
            logger.warning(
                "Invalid LOG_STREAM_WORKERS value %r — using the default (%s)",
                raw,
                default_workers,
            )
            workers = default_workers
        if workers < 1:
            logger.warning(
                "LOG_STREAM_WORKERS=%s would start no delivery workers — clamping to 1",
                workers,
            )
            workers = 1
        self.stdout.write(
            self.style.SUCCESS(
                f"Starting log-streams RQ worker pool with {workers} workers..."
            )
        )

        management.call_command("rqworker-pool", "log-streams", num_workers=workers)

    def bootstrap_log_stream_schedule(self):
        """(Re-)register the recurring log stream sweep at worker startup.

        The schedule lives only in Redis. If it's lost — a Redis restart, or
        rq-scheduler dropping an interval job whose hash expired while the
        host was frozen — backend post_migrate wouldn't re-create it until
        the next deploy. Worker startup is the natural recovery point; the
        registration is idempotent (stable id, cancel-before-schedule).
        """
        try:
            from ee.integrations.logs.streams.jobs import init_log_stream_sweeper

            init_log_stream_sweeper()
        except Exception:
            logger.exception("Failed to register log stream sweeper at worker startup")

    def handle(self, *args, **options):
        queue = options["queue"]
        num_workers = options["num_workers"]

        self.bootstrap_log_stream_schedule()

        processes = [
            multiprocessing.Process(
                name="rqworker-pool-default",
                target=self.run_default_workers,
                args=(
                    queue,
                    num_workers,
                ),
            ),
            multiprocessing.Process(
                name="rqworker-scheduled-jobs",
                target=self.run_scheduled_jobs_worker,
            ),
            multiprocessing.Process(name="rqscheduler", target=self.run_scheduler),
            multiprocessing.Process(
                name="rqworker-pool-log-streams",
                target=self.run_log_streams_workers,
            ),
        ]

        for process in processes:
            process.start()

        # Supervise the children instead of blindly join()ing them: a dead
        # worker or scheduler process used to leave the container "Up" but
        # silently degraded (e.g. rq-scheduler dying after a host sleep stops
        # every recurring job with no visible failure). `wait()` blocks until
        # any child's sentinel fires; exiting non-zero lets the container
        # restart policy bring the whole pool back up cleanly.
        try:
            wait([process.sentinel for process in processes])
        except KeyboardInterrupt:
            self._shutdown(processes)
            return

        dead = next((p for p in processes if not p.is_alive()), None)
        self.stderr.write(
            self.style.ERROR(
                f"{dead.name if dead else 'a worker process'} exited unexpectedly "
                f"(exitcode={dead.exitcode if dead else '?'}); shutting down "
                "worker pool for a clean restart"
            )
        )
        self._shutdown(processes)
        sys.exit(1)

    def _shutdown(self, processes):
        for process in processes:
            if process.is_alive():
                process.terminate()
        for process in processes:
            process.join()
