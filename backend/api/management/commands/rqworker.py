from django.core.management.base import BaseCommand
from django.core import management
import contextlib
import logging
import math
import multiprocessing
from multiprocessing.connection import wait
import os
import signal
import sys
import time
from django_rq.management.commands.rqworker import Command as OriginalRQWorkerCommand

logger = logging.getLogger(__name__)

# Seconds a shutdown waits for in-flight jobs before killing the children,
# unless WORKER_SHUTDOWN_TIMEOUT says otherwise. A little under the 30s stop
# grace period the compose files give the worker (also the Kubernetes default),
# so the worker exits on its own instead of being SIGKILLed mid-shutdown.
DEFAULT_SHUTDOWN_TIMEOUT = 25


class Command(BaseCommand):
    help = "Runs both RQ worker and RQ scheduler in parallel"
    shutdown_timeout = DEFAULT_SHUTDOWN_TIMEOUT

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

    def run_maintenance_worker(self):
        """Starts the RQ worker for slow, database-heavy jobs nothing waits on
        (e.g. organisation purges). A single worker, so they run one at a
        time and never delay syncs or credential expiry."""
        self.stdout.write(
            self.style.SUCCESS("Starting RQ worker for maintenance jobs...")
        )

        OriginalRQWorkerCommand().run_from_argv(
            ["manage.py", "rqworker", "maintenance"]
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

    def bootstrap_org_deletion_schedule(self):
        """(Re-)register the organisation deletion sweep at worker startup, for
        the same reason as the log stream sweep: if its schedule is lost,
        purges stop until the next deploy."""
        try:
            from api.tasks.organisation_deletion import (
                init_organisation_deletion_sweeper,
            )

            init_organisation_deletion_sweeper()
        except Exception:
            logger.exception(
                "Failed to register organisation deletion sweeper at worker startup"
            )

    def get_shutdown_timeout(self):
        """Seconds a shutdown waits for in-flight jobs before killing the
        children, from WORKER_SHUTDOWN_TIMEOUT. Set it a little under the
        container's stop grace period.

        Parsed defensively, like LOG_STREAM_WORKERS: a typo'd value falls back
        to the default rather than stopping the worker from starting.
        """
        raw = os.getenv("WORKER_SHUTDOWN_TIMEOUT", "")
        try:
            timeout = float(raw) if raw.strip() else DEFAULT_SHUTDOWN_TIMEOUT
        except ValueError:
            timeout = None
        # Rejects negatives, inf and nan along with non-numbers.
        if timeout is None or not 0 <= timeout < math.inf:
            logger.warning(
                "Invalid WORKER_SHUTDOWN_TIMEOUT value %r — using the default (%ss)",
                raw,
                DEFAULT_SHUTDOWN_TIMEOUT,
            )
            timeout = DEFAULT_SHUTDOWN_TIMEOUT
        return timeout

    def handle(self, *args, **options):
        queue = options["queue"]
        num_workers = options["num_workers"]
        self.shutdown_timeout = self.get_shutdown_timeout()

        self.bootstrap_log_stream_schedule()
        self.bootstrap_org_deletion_schedule()

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
            multiprocessing.Process(
                name="rqworker-maintenance",
                target=self.run_maintenance_worker,
            ),
        ]

        for process in processes:
            process.start()

        # Install the stop handlers only now that the children are running: a
        # forked child inherits its parent's signal handlers, and with these it
        # would try to shut down its siblings instead of exiting on SIGTERM. RQ
        # workers and rqscheduler install their own handlers once running;
        # anything else keeps the default.
        with self._stop_on_signal(processes):
            # Supervise the children instead of blindly join()ing them: a dead
            # worker or scheduler process used to leave the container "Up" but
            # silently degraded (e.g. rq-scheduler dying after a host sleep
            # stops every recurring job with no visible failure). `wait()`
            # blocks until any child's sentinel fires; exiting non-zero lets the
            # container restart policy bring the whole pool back up cleanly.
            wait([process.sentinel for process in processes])

            # A child died on its own. A stop signal from here on must not
            # start a second shutdown on top of this one.
            self._shutting_down = True
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

    @contextlib.contextmanager
    def _stop_on_signal(self, processes):
        """While the block runs, SIGTERM (`docker stop`, Kubernetes pod
        termination) or SIGINT (Ctrl+C) shuts the pool down and exits 0.

        This process is PID 1 in the worker container, and the kernel drops
        signals PID 1 has no handler for: without one, SIGTERM would do nothing
        until the stop grace period ran out and the container was SIGKILLed,
        killing every in-flight job with it.
        """
        self._shutting_down = False

        def stop(signum, frame):
            if self._shutting_down:
                # Already stopping (a second Ctrl+C or `docker stop`), or going
                # down for a restart after a child died. SIGTERMing the
                # children again would turn RQ's warm shutdown into a cold one
                # and kill the jobs being waited on.
                return
            self._shutting_down = True
            self.stdout.write(
                self.style.WARNING(
                    f"Received {signal.Signals(signum).name}; stopping worker "
                    f"processes (waiting up to {self.shutdown_timeout:g}s for "
                    "in-flight jobs)..."
                )
            )
            # stdout is block-buffered in the container; show this now, not
            # at exit.
            self.stdout.flush()
            self._shutdown(processes)
            self.stdout.write(self.style.SUCCESS("Worker processes stopped"))
            sys.exit(0)

        previous = {
            signum: signal.signal(signum, stop)
            for signum in (signal.SIGTERM, signal.SIGINT)
        }
        try:
            yield
        finally:
            for signum, handler in previous.items():
                if handler is not None:  # None: set outside Python, can't restore
                    signal.signal(signum, handler)

    def _shutdown(self, processes):
        # SIGTERM is a warm shutdown for RQ workers: each finishes its current
        # job first. Wait for that up to shutdown_timeout, then SIGKILL
        # whatever is left, so a stuck child can't hold the shutdown open until
        # the container runtime kills everything anyway.
        for process in processes:
            if process.is_alive():
                process.terminate()

        deadline = time.monotonic() + self.shutdown_timeout
        for process in processes:
            process.join(max(0, deadline - time.monotonic()))

        for process in processes:
            if process.is_alive():
                self.stderr.write(
                    f"{process.name} did not exit within {self.shutdown_timeout:g}s "
                    "of SIGTERM; killing it"
                )
                process.kill()
                process.join()
