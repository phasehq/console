"""A sync job updates its own sync event, which exists before the job can start."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from api.services import ServiceConfig
from api.tasks import syncing


class FakeEvent(SimpleNamespace):
    def save(self):
        pass


class FakeQuerySet(list):
    def order_by(self, field):
        assert field == "-created_at"
        return FakeQuerySet(reversed(self))

    def first(self):
        return self[0] if self else None


class FakeEvents:
    """EnvironmentSyncEvent.objects, with events kept in creation order."""

    def __init__(self):
        self.rows = []

    def create(self, **fields):
        event = FakeEvent(status="queued", meta=None, completed_at=None, **fields)
        self.rows.append(event)
        return event

    def filter(self, **lookup):
        return FakeQuerySet(
            event
            for event in self.rows
            if all(getattr(event, field) == value for field, value in lookup.items())
        )


@pytest.fixture
def events():
    sync_model = SimpleNamespace(
        QUEUED="queued",
        IN_PROGRESS="in_progress",
        COMPLETED="completed",
        FAILED="failed",
        TIMED_OUT="timed_out",
        CANCELLED="cancelled",
    )
    events = FakeEvents()
    models = {
        "EnvironmentSync": sync_model,
        "EnvironmentSyncEvent": SimpleNamespace(objects=events),
    }
    with patch.object(
        syncing.apps, "get_model", side_effect=lambda app, name: models[name]
    ), patch.object(
        syncing, "organisation_is_locked", return_value=False
    ), patch.object(
        syncing, "get_environment_secrets", return_value=[]
    ), patch.object(
        syncing, "cancel_sync_tasks"
    ):
        yield events


def _run_as_job(job_id, env_sync, sync_function):
    """Run handle_sync_event as the worker would, in the job with this ID."""
    job = SimpleNamespace(id=job_id)
    with patch.object(syncing, "get_current_job", return_value=job, create=True):
        syncing.handle_sync_event(env_sync, sync_function)


def test_a_job_that_starts_at_once_updates_its_event(events):
    """A worker can start the job before delay() returns."""
    env_sync = MagicMock(service=ServiceConfig.HASHICORP_VAULT["id"])

    def start_at_once(*args, job_id=None, **kwargs):
        _run_as_job(job_id, env_sync, MagicMock(return_value=(True, {"message": "ok"})))
        return SimpleNamespace(get_id=lambda: job_id)

    with patch.object(syncing, "perform_vault_sync") as vault_sync:
        vault_sync.delay.side_effect = start_at_once
        syncing.trigger_sync_tasks(env_sync)

    (event,) = events.rows
    vault_sync.delay.assert_called_once_with(env_sync, job_id=event.id)
    assert event.env_sync == env_sync
    assert event.status == "completed"
    assert event.meta == {"message": "ok"}
    assert event.completed_at is not None
    assert env_sync.status == "completed"


def test_a_job_updates_its_own_event_not_a_newer_one(events):
    """A sync triggered again while it runs has a newer event for the next job."""
    env_sync = MagicMock()
    own_event = events.create(id="job-1", env_sync=env_sync)
    newer_event = events.create(id="job-2", env_sync=env_sync)

    _run_as_job("job-1", env_sync, MagicMock(return_value=(True, {"message": "ok"})))

    assert own_event.status == "completed"
    assert newer_event.status == "queued"
    assert newer_event.completed_at is None


def test_a_job_finds_an_event_created_while_it_runs(events):
    """E.g. a job queued before this fix, whose event was created after it started."""
    env_sync = MagicMock()

    def sync_function(secrets):
        events.create(id="job-1", env_sync=env_sync)
        return True, {"message": "ok"}

    _run_as_job("job-1", env_sync, sync_function)

    (event,) = events.rows
    assert event.status == "completed"
    assert event.meta == {"message": "ok"}
    assert env_sync.status == "completed"


@pytest.mark.parametrize(
    ("sync_function", "status"),
    [
        (MagicMock(return_value=(True, {"message": "ok"})), "completed"),
        (MagicMock(return_value=(False, {"error": "denied"})), "failed"),
        (MagicMock(side_effect=Exception("GitLab is down")), "failed"),
    ],
)
def test_a_job_without_an_event_still_records_the_sync_status(
    events, sync_function, status
):
    env_sync = MagicMock()

    _run_as_job("job-1", env_sync, sync_function)

    assert env_sync.status == status
    assert env_sync.last_sync is not None
    assert events.rows == []


@pytest.mark.parametrize(
    ("sync_function", "status", "meta"),
    [
        (
            MagicMock(return_value=(False, {"error": "denied"})),
            "failed",
            {"error": "denied"},
        ),
        (
            MagicMock(side_effect=Exception("GitLab is down")),
            "failed",
            {"message": "GitLab is down"},
        ),
        (
            MagicMock(side_effect=syncing.JobTimeoutException()),
            "timed_out",
            {"message": "Sync job timed out"},
        ),
    ],
)
def test_a_failed_job_records_why_on_its_event(events, sync_function, status, meta):
    env_sync = MagicMock()
    event = events.create(id="job-1", env_sync=env_sync)

    _run_as_job("job-1", env_sync, sync_function)

    assert (event.status, event.meta) == (status, meta)
    assert event.completed_at is not None
    assert env_sync.status == status


def test_a_sync_without_credentials_fails_on_its_event(events):
    env_sync = MagicMock(authentication=None)
    event = events.create(id="job-1", env_sync=env_sync)
    sync_function = MagicMock()

    _run_as_job("job-1", env_sync, sync_function)

    sync_function.assert_not_called()
    assert event.status == "failed"
    assert event.meta == {"message": "No authentication credentials for this sync"}


def test_the_event_fails_when_the_job_cannot_be_queued(events):
    env_sync = MagicMock(service=ServiceConfig.HASHICORP_VAULT["id"])

    with patch.object(syncing, "perform_vault_sync") as vault_sync:
        vault_sync.delay.side_effect = ConnectionError("Redis is down")
        syncing.trigger_sync_tasks(env_sync)

    (event,) = events.rows
    assert event.status == "failed"
    assert event.meta == {"message": "Failed to queue the sync job"}
    assert event.completed_at is not None
    assert env_sync.status == "failed"
