"""Renewing a lease must actually move its scheduled revocation and reject
input that would shorten or resurrect it."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from django.utils import timezone

from api.models import Organisation
from ee.integrations.secrets.dynamic import utils as dynamic_utils
from ee.integrations.secrets.dynamic.exceptions import (
    DynamicSecretError,
    LeaseAlreadyRevokedError,
    LeaseRenewalError,
)


def _lease(**overrides):
    org = SimpleNamespace(plan=Organisation.ENTERPRISE_PLAN)
    secret = SimpleNamespace(
        environment=SimpleNamespace(app=SimpleNamespace(organisation=org)),
        max_ttl=timedelta(hours=24),
        deleted_at=None,
        provider="aws",
    )
    lease = SimpleNamespace(
        id="lease-1",
        secret=secret,
        ttl=timedelta(hours=1),
        expires_at=timezone.now() + timedelta(minutes=30),
        revoked_at=None,
        cleanup_job_id="old-job",
        updated_at=None,
    )
    for key, value in overrides.items():
        setattr(lease, key, value)
    return lease


@pytest.fixture
def renew_mocks(monkeypatch):
    calls = MagicMock()

    def schedule(lease, immediate=False):
        calls.schedule(lease.cleanup_job_id)
        lease.cleanup_job_id = "new-job"

    monkeypatch.setattr(dynamic_utils, "schedule_lease_revocation", schedule)
    monkeypatch.setattr(
        dynamic_utils,
        "cancel_scheduled_lease_job",
        lambda job_id, lease_id: calls.cancel(job_id),
    )
    monkeypatch.setattr(dynamic_utils, "DynamicSecretLeaseEvent", MagicMock())
    return calls


def test_renew_cancels_old_job_after_enqueueing_new_one(renew_mocks):
    lease = _lease()
    original_expiry = lease.expires_at

    dynamic_utils.renew_dynamic_secret_lease(lease, 600)

    assert [c[0] for c in renew_mocks.mock_calls] == ["schedule", "cancel"]
    renew_mocks.cancel.assert_called_once_with("old-job")
    assert lease.expires_at == original_expiry + timedelta(seconds=600)
    assert lease.cleanup_job_id == "new-job"


def test_renew_enqueue_failure_keeps_old_job(renew_mocks, monkeypatch):
    def failing_schedule(lease, immediate=False):
        raise RuntimeError("redis down")

    monkeypatch.setattr(dynamic_utils, "schedule_lease_revocation", failing_schedule)

    with pytest.raises(RuntimeError):
        dynamic_utils.renew_dynamic_secret_lease(_lease(), 600)

    renew_mocks.cancel.assert_not_called()


def test_renew_rejects_revoked_lease_before_changing_it(renew_mocks):
    lease = _lease(revoked_at=timezone.now())
    original_expiry = lease.expires_at

    with pytest.raises(LeaseAlreadyRevokedError):
        dynamic_utils.renew_dynamic_secret_lease(lease, 600)

    assert lease.expires_at == original_expiry
    renew_mocks.schedule.assert_not_called()


def test_renew_rejects_lease_of_deleted_secret(renew_mocks):
    lease = _lease()
    lease.secret.deleted_at = timezone.now()

    with pytest.raises(LeaseRenewalError, match="deleted"):
        dynamic_utils.renew_dynamic_secret_lease(lease, 600)

    renew_mocks.schedule.assert_not_called()


@pytest.mark.parametrize("ttl", [0, -5, "60", True, 1.5])
def test_renew_rejects_invalid_ttl(renew_mocks, ttl):
    lease = _lease()
    original_expiry = lease.expires_at

    with pytest.raises(DynamicSecretError, match="positive integer"):
        dynamic_utils.renew_dynamic_secret_lease(lease, ttl)

    assert lease.expires_at == original_expiry
    renew_mocks.schedule.assert_not_called()


def test_renew_persists_new_expiry_and_job_through_real_scheduling(monkeypatch):
    scheduler = MagicMock()
    scheduler.enqueue_at.return_value = SimpleNamespace(id="new-job")
    monkeypatch.setattr(
        dynamic_utils.django_rq, "get_scheduler", lambda name: scheduler
    )
    monkeypatch.setattr(dynamic_utils, "Job", MagicMock())
    monkeypatch.setattr(dynamic_utils, "DynamicSecretLeaseEvent", MagicMock())
    lease = _lease()
    original_expiry = lease.expires_at
    saved = []
    lease.save = lambda: saved.append((lease.expires_at, lease.cleanup_job_id))

    dynamic_utils.renew_dynamic_secret_lease(lease, 600)

    renewed_expiry = original_expiry + timedelta(seconds=600)
    assert saved[-1] == (renewed_expiry, "new-job")
    assert scheduler.enqueue_at.call_args.args[0] == renewed_expiry
    scheduler.cancel.assert_called_once_with("old-job")
