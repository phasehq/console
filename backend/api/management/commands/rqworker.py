from django.core.management.base import BaseCommand
from django.core import management
import multiprocessing
from django.core.management.base import BaseCommand
from django_rq.management.commands.rqworker import Command as OriginalRQWorkerCommand


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
            default=3,
            help="Number of workers to spawn",
        )

    def run_default_workers(self, queue="default", workers=3):
        """Starts the RQ worker"""
        self.stdout.write(
            self.style.SUCCESS(
                f"Starting default RQ worker pool with  {workers} workers..."
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
        management.call_command("rqscheduler", "scheduled-jobs")

    def handle(self, *args, **options):
        queue = options["queue"]
        num_workers = options["num_workers"]

        default_workers_process = multiprocessing.Process(
            target=self.run_default_workers,
            args=(
                queue,
                num_workers,
            ),
        )
        scheduled_jobs_worker_process = multiprocessing.Process(
            target=self.run_scheduled_jobs_worker
        )
        scheduler_process = multiprocessing.Process(target=self.run_scheduler)

        default_workers_process.start()
        scheduled_jobs_worker_process.start()
        scheduler_process.start()

        default_workers_process.join()
        scheduled_jobs_worker_process.join()
        scheduler_process.join()
