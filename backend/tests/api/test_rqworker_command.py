"""The bundled worker command must run a worker for every queue jobs are sent
to, or those jobs wait forever."""

from unittest.mock import patch

import django_rq

from api.management.commands import rqworker


def _start(command):
    with patch.object(rqworker.multiprocessing, "Process") as process, patch.object(
        rqworker, "wait", side_effect=KeyboardInterrupt
    ), patch.object(command, "bootstrap_log_stream_schedule"):
        command.handle(queue="default", num_workers=1)
    return process


def test_starts_a_maintenance_worker():
    command = rqworker.Command()
    with patch.object(command, "bootstrap_org_deletion_schedule"):
        process = _start(command)

    targets = {
        call.kwargs["name"]: call.kwargs["target"] for call in process.call_args_list
    }
    assert targets["rqworker-maintenance"] == command.run_maintenance_worker


def test_maintenance_worker_listens_on_the_maintenance_queue():
    with patch.object(rqworker, "OriginalRQWorkerCommand") as worker:
        rqworker.Command().run_maintenance_worker()

    worker.return_value.run_from_argv.assert_called_once_with(
        ["manage.py", "rqworker", "maintenance"]
    )
    assert django_rq.get_queue("maintenance").name == "maintenance"


def test_registers_the_org_deletion_sweep_at_startup():
    """The sweep's schedule lives only in Redis. Registering it at startup
    restores it after a Redis restart, instead of at the next migrate."""
    with patch(
        "api.tasks.organisation_deletion.init_organisation_deletion_sweeper"
    ) as init:
        _start(rqworker.Command())

    init.assert_called_once_with()


def test_a_failed_sweep_registration_does_not_stop_the_workers():
    with patch(
        "api.tasks.organisation_deletion.init_organisation_deletion_sweeper",
        side_effect=ConnectionError("Redis is down"),
    ):
        process = _start(rqworker.Command())

    assert process.return_value.start.called
