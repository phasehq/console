"""The bundled worker command is the worker container's entrypoint. It must run
a worker for every queue jobs are sent to, or those jobs wait forever; and as
the container's PID 1 it must stop its children cleanly on SIGTERM, or every
deploy kills the jobs they are running."""

import multiprocessing
import os
import signal
import time
from unittest.mock import patch

import django_rq
import pytest

from api.management.commands import rqworker


def _receive(signum):
    """`signum` arrives at the supervisor, e.g. while it is blocked in `wait`."""

    def deliver(*_):
        handler = signal.getsignal(signum)
        # Without a handler of the command's own, the signal would kill
        # (SIGTERM) or interrupt (SIGINT) the test run itself.
        assert (
            callable(handler) and handler is not signal.default_int_handler
        ), f"no {signal.Signals(signum).name} handler installed"
        os.kill(os.getpid(), signum)

    return deliver


def _start(command):
    with patch.object(rqworker.multiprocessing, "Process") as process, patch.object(
        rqworker, "wait", side_effect=_receive(signal.SIGTERM)
    ), patch.object(command, "bootstrap_log_stream_schedule"), pytest.raises(
        SystemExit
    ):
        # Already exited, so the shutdown has nothing to stop.
        process.return_value.is_alive.return_value = False
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


# --- Shutdown -----------------------------------------------------------------


class FakeProcess:
    """Enough of multiprocessing.Process for the supervisor. Like an RQ worker
    finishing its job, a child sent SIGTERM keeps running until it is joined;
    one that ignores SIGTERM keeps running until it is killed."""

    def __init__(self, name, ignores_sigterm=False):
        self.name = name
        self.ignores_sigterm = ignores_sigterm
        self.sentinel = object()
        self.started = False
        self.exitcode = None
        self.terminated = self.killed = 0
        self.join_timeouts = []
        self.on_join = None

    def start(self):
        self.started = True
        # What a forked child would inherit.
        self.handlers_at_start = (
            signal.getsignal(signal.SIGTERM),
            signal.getsignal(signal.SIGINT),
        )

    def is_alive(self):
        return self.started and self.exitcode is None

    def terminate(self):
        self.terminated += 1

    def kill(self):
        self.killed += 1
        self.exitcode = -signal.SIGKILL

    def join(self, timeout=None):
        self.join_timeouts.append(timeout)
        callback, self.on_join = self.on_join, None
        if callback:
            callback()
        if self.is_alive() and self.terminated and not self.ignores_sigterm:
            self.exitcode = 0


def _run(during_wait, ignores_sigterm=()):
    """Run the command with fake children. `during_wait(processes)` plays out
    while it supervises them. Returns its exit code and the children."""
    command = rqworker.Command()
    processes = []

    def make_process(name, **_):
        processes.append(FakeProcess(name, ignores_sigterm=name in ignores_sigterm))
        return processes[-1]

    with patch.object(
        rqworker.multiprocessing, "Process", side_effect=make_process
    ), patch.object(
        rqworker, "wait", side_effect=lambda sentinels: during_wait(processes)
    ), patch.object(
        command, "bootstrap_log_stream_schedule"
    ), patch.object(
        command, "bootstrap_org_deletion_schedule"
    ), pytest.raises(
        SystemExit
    ) as exited:
        command.handle(queue="default", num_workers=1)
    return exited.value.code, processes


def _named(processes, name):
    return next(process for process in processes if process.name == name)


@pytest.mark.parametrize(
    "signum", [signal.SIGTERM, signal.SIGINT], ids=lambda signum: signum.name
)
def test_a_stop_signal_shuts_the_children_down_and_exits_zero(signum, capsys):
    """SIGTERM (`docker stop`, pod termination) or SIGINT (Ctrl+C): every child
    gets one SIGTERM, a warm shutdown for RQ workers, and is joined. The exit
    is a clean 0, not the unexpected-exit restart path."""
    code, processes = _run(_receive(signum))

    assert code == 0
    assert [p.terminated for p in processes] == [1] * 5
    assert all(p.join_timeouts for p in processes)
    assert not any(p.killed for p in processes)
    out, err = capsys.readouterr()
    assert f"Received {signal.Signals(signum).name}" in out
    assert "Worker processes stopped" in out
    assert "unexpectedly" not in out + err


def test_the_children_start_before_the_stop_handlers_are_installed():
    """A forked child inherits its parent's signal handlers. Installed before
    start(), the stop handler would run in each child on SIGTERM (trying to
    shut down its siblings) instead of letting it exit."""
    defaults = (signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT))

    _, processes = _run(_receive(signal.SIGTERM))

    assert [p.handlers_at_start for p in processes] == [defaults] * 5


def test_the_previous_signal_handlers_are_restored_afterwards():
    before = (signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT))

    _run(_receive(signal.SIGTERM))

    assert (signal.getsignal(signal.SIGTERM), signal.getsignal(signal.SIGINT)) == before


def test_a_second_signal_during_shutdown_does_not_terminate_the_children_again():
    """RQ workers treat a second SIGTERM as a cold shutdown, killing the job
    they are finishing. Another Ctrl+C or `docker stop` while the pool is
    stopping must not cause one."""

    def stop_twice(processes):
        # The second signal lands while the children finish their jobs.
        processes[0].on_join = _receive(signal.SIGINT)
        _receive(signal.SIGTERM)()

    code, processes = _run(stop_twice)

    assert code == 0
    assert [p.terminated for p in processes] == [1] * 5


def test_a_child_still_running_at_the_timeout_is_killed(monkeypatch, capsys):
    """A stuck child, or a job running past the grace period, must not hold
    the shutdown open: whatever is left at the timeout is killed."""
    monkeypatch.setenv("WORKER_SHUTDOWN_TIMEOUT", "7")

    code, processes = _run(
        _receive(signal.SIGTERM), ignores_sigterm={"rqworker-maintenance"}
    )

    assert code == 0
    assert [p.name for p in processes if p.killed] == ["rqworker-maintenance"]
    assert all(0 <= p.join_timeouts[0] <= 7 for p in processes)
    assert "rqworker-maintenance did not exit within 7s" in capsys.readouterr().err


def test_an_unexpected_child_exit_still_exits_non_zero(capsys):
    """A child dying on its own takes the pool down with exit 1, so the
    container restart policy brings it back up."""

    def scheduler_dies(processes):
        _named(processes, "rqscheduler").exitcode = -signal.SIGKILL

    code, processes = _run(scheduler_dies)

    assert code == 1
    assert "rqscheduler exited unexpectedly (exitcode=-9)" in capsys.readouterr().err
    assert not any(p.is_alive() for p in processes)


def test_a_stop_signal_while_restarting_does_not_terminate_the_children_again():
    def scheduler_dies_then_sigterm(processes):
        _named(processes, "rqscheduler").exitcode = 1
        processes[0].on_join = _receive(signal.SIGTERM)

    code, processes = _run(scheduler_dies_then_sigterm)

    assert code == 1
    assert [p.terminated for p in processes if p.name != "rqscheduler"] == [1] * 4


@pytest.mark.parametrize("value, expected", [("", 25), ("90", 90), ("0.5", 0.5)])
def test_the_shutdown_timeout_comes_from_the_environment(value, expected, monkeypatch):
    monkeypatch.setenv("WORKER_SHUTDOWN_TIMEOUT", value)

    assert rqworker.Command().get_shutdown_timeout() == expected


@pytest.mark.parametrize("value", ["30s", "-1", "nan", "inf"])
def test_an_invalid_shutdown_timeout_falls_back_to_the_default(
    value, monkeypatch, caplog
):
    monkeypatch.setenv("WORKER_SHUTDOWN_TIMEOUT", value)

    assert rqworker.Command().get_shutdown_timeout() == 25
    assert "Invalid WORKER_SHUTDOWN_TIMEOUT" in caplog.text


def _idle(*args):
    # Bounded, so a broken shutdown fails the test rather than hanging it.
    time.sleep(10)


def test_real_children_stop_on_sigterm_and_a_stuck_one_is_killed(monkeypatch):
    """With real forked children: each one exits from the default SIGTERM
    action, so none inherited the stop handler (with it, a child would exit 1
    with a traceback). A child ignoring SIGTERM is killed at the timeout, and
    the supervisor exits 0."""
    ready = multiprocessing.Event()

    def ignores_sigterm(*args):
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        ready.set()
        _idle()

    command = rqworker.Command()
    for target in (
        "run_default_workers",
        "run_scheduled_jobs_worker",
        "run_scheduler",
        "run_log_streams_workers",
    ):
        monkeypatch.setattr(command, target, _idle)
    monkeypatch.setattr(command, "run_maintenance_worker", ignores_sigterm)
    monkeypatch.setenv("WORKER_SHUTDOWN_TIMEOUT", "0.5")

    started = []
    real_process = multiprocessing.Process

    def make_process(**kwargs):
        started.append(real_process(**kwargs))
        return started[-1]

    def sigterm_once_ready(sentinels):
        assert ready.wait(10)
        _receive(signal.SIGTERM)()

    with patch.object(
        rqworker.multiprocessing, "Process", side_effect=make_process
    ), patch.object(rqworker, "wait", side_effect=sigterm_once_ready), patch.object(
        command, "bootstrap_log_stream_schedule"
    ), patch.object(
        command, "bootstrap_org_deletion_schedule"
    ), pytest.raises(
        SystemExit
    ) as exited:
        command.handle(queue="default", num_workers=1)

    assert exited.value.code == 0
    assert {p.name: p.exitcode for p in started} == {
        "rqworker-pool-default": -signal.SIGTERM,
        "rqworker-scheduled-jobs": -signal.SIGTERM,
        "rqscheduler": -signal.SIGTERM,
        "rqworker-pool-log-streams": -signal.SIGTERM,
        "rqworker-maintenance": -signal.SIGKILL,
    }
