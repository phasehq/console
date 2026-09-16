"""Cascade hard-deletes (environment, app, folder) bypass DynamicSecret.delete(),
so active leases must be revoked from a lease pre_delete receiver."""

import gc
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.db.models.deletion import Collector
from django.db.models.signals import pre_delete
from botocore.exceptions import EndpointConnectionError, ReadTimeoutError
from rq.exceptions import NoSuchJobError

from api import signals
from api.models import DynamicSecretLease, DynamicSecretLeaseEvent, RotatingSecretEvent
from ee.integrations.secrets.dynamic import utils as dynamic_utils
from ee.integrations.secrets.dynamic.aws import utils as aws_utils
from ee.integrations.secrets.dynamic.exceptions import LeaseAlreadyRevokedError


def test_receiver_is_connected():
    assert pre_delete.has_listeners(DynamicSecretLease)


def test_lease_events_stay_fast_deletable():
    # Revocation writes lease events during pre_delete; they are only cleaned up
    # because the collector fast-deletes events lazily after the signals run.
    collector = Collector(using="default")
    assert collector.can_fast_delete(DynamicSecretLeaseEvent)
    assert collector.can_fast_delete(RotatingSecretEvent)


@pytest.fixture
def receiver_mocks(monkeypatch):
    events = []

    mock_revoke = MagicMock(side_effect=lambda lease: events.append("revoke"))
    monkeypatch.setattr(dynamic_utils, "revoke_lease_immediately", mock_revoke)
    monkeypatch.setattr(
        dynamic_utils, "lease_iam_username", MagicMock(return_value="phase-user-1")
    )

    atomic = MagicMock()
    atomic.return_value.__enter__.side_effect = lambda: events.append("enter")
    atomic.return_value.__exit__.side_effect = lambda *exc: (
        events.append("exit"),
        False,
    )[1]
    connection = SimpleNamespace(atomic_blocks=[])
    monkeypatch.setattr(
        signals,
        "transaction",
        SimpleNamespace(atomic=atomic, get_connection=lambda: connection),
    )

    mock_logger = MagicMock()
    monkeypatch.setattr(signals, "logger", mock_logger)

    clock = SimpleNamespace(now=1000.0)
    monkeypatch.setattr(signals.time, "monotonic", lambda: clock.now)

    return SimpleNamespace(
        events=events,
        revoke=mock_revoke,
        atomic=atomic,
        connection=connection,
        logger=mock_logger,
        clock=clock,
    )


def _lease(lease_id="lease-1", status=DynamicSecretLease.ACTIVE, auth="cred-1"):
    return SimpleNamespace(
        id=lease_id,
        status=status,
        secret_id="ds-1",
        expires_at="2026-01-01T00:00:00Z",
        secret=SimpleNamespace(authentication_id=auth, environment_id="env-1"),
    )


class _Transaction:
    """Stands in for the outermost atomic block a delete runs in."""


class _Origin:
    """Stands in for the model instance a delete was called on."""


class _Delete:
    def __init__(self, origin=None, outermost=None):
        self.origin = origin or _Origin()
        self.outermost = outermost or _Transaction()


def _receive(mocks, lease, delete):
    mocks.connection.atomic_blocks = [delete.outermost]
    signals._dynamic_secret_lease_pre_delete(
        DynamicSecretLease, lease, origin=delete.origin
    )


def _unreachable():
    try:
        raise EndpointConnectionError(endpoint_url="https://iam.amazonaws.com")
    except EndpointConnectionError:
        try:
            raise Exception("Unexpected error deleting user")
        except Exception as wrapped:
            return wrapped


def _revoked_ids(mocks):
    return [c.args[0].id for c in mocks.revoke.call_args_list]


def test_active_lease_is_revoked_inside_savepoint(receiver_mocks):
    _receive(receiver_mocks, _lease(), _Delete())

    assert receiver_mocks.events == ["enter", "revoke", "exit"]
    receiver_mocks.logger.error.assert_not_called()


@pytest.mark.parametrize(
    "status", [DynamicSecretLease.REVOKED, DynamicSecretLease.EXPIRED]
)
def test_finished_lease_is_skipped(receiver_mocks, status):
    _receive(receiver_mocks, _lease(status=status), _Delete())

    receiver_mocks.revoke.assert_not_called()


def test_revoke_failure_rolls_back_savepoint_and_does_not_block_delete(receiver_mocks):
    receiver_mocks.revoke.side_effect = RuntimeError("DeleteConflict")

    _receive(receiver_mocks, _lease(), _Delete())

    exit_args = receiver_mocks.atomic.return_value.__exit__.call_args.args
    assert exit_args[0] is RuntimeError
    receiver_mocks.logger.error.assert_called_once()
    assert receiver_mocks.logger.error.call_args.kwargs["exc_info"] is True


def test_lease_specific_failure_does_not_skip_sibling_leases(receiver_mocks):
    receiver_mocks.revoke.side_effect = RuntimeError("DeleteConflict")
    delete = _Delete()

    _receive(receiver_mocks, _lease("lease-1", auth="cred-1"), delete)
    _receive(receiver_mocks, _lease("lease-2", auth="cred-1"), delete)

    assert _revoked_ids(receiver_mocks) == ["lease-1", "lease-2"]


def test_unreachable_provider_is_not_retried_within_the_same_delete(receiver_mocks):
    receiver_mocks.revoke.side_effect = lambda lease: (_ for _ in ()).throw(
        _unreachable()
    )
    delete = _Delete()

    _receive(receiver_mocks, _lease("lease-1", auth="cred-1"), delete)
    _receive(receiver_mocks, _lease("lease-2", auth="cred-1"), delete)
    _receive(receiver_mocks, _lease("lease-3", auth="cred-2"), delete)

    assert _revoked_ids(receiver_mocks) == ["lease-1", "lease-3"]


def test_revocations_stop_once_the_delete_budget_is_spent(receiver_mocks):
    delete = _Delete()

    _receive(receiver_mocks, _lease("lease-1"), delete)
    receiver_mocks.clock.now += signals.CASCADE_REVOKE_BUDGET_SECONDS + 1
    _receive(receiver_mocks, _lease("lease-2"), delete)

    assert _revoked_ids(receiver_mocks) == ["lease-1"]
    receiver_mocks.logger.error.assert_called_once()


def _expire_budget_after_unreachable_attempt(mocks, lease, delete):
    mocks.revoke.side_effect = lambda _: (_ for _ in ()).throw(_unreachable())
    _receive(mocks, lease, delete)
    mocks.clock.now += signals.CASCADE_REVOKE_BUDGET_SECONDS + 1
    mocks.revoke.side_effect = None


def test_retry_of_the_same_object_in_a_new_transaction_gets_a_fresh_budget(
    receiver_mocks,
):
    lease, origin = _lease("lease-1"), _Origin()
    _expire_budget_after_unreachable_attempt(
        receiver_mocks, lease, _Delete(origin=origin)
    )

    _receive(receiver_mocks, lease, _Delete(origin=origin))

    assert _revoked_ids(receiver_mocks) == ["lease-1", "lease-1"]


def test_retry_through_a_reused_atomic_decorator_gets_a_fresh_budget(receiver_mocks):
    lease, outermost = _lease("lease-1"), _Transaction()
    _expire_budget_after_unreachable_attempt(
        receiver_mocks, lease, _Delete(outermost=outermost)
    )

    _receive(receiver_mocks, lease, _Delete(outermost=outermost))

    assert _revoked_ids(receiver_mocks) == ["lease-1", "lease-1"]


def test_budget_state_is_released_with_the_delete(receiver_mocks):
    existing = set(signals._cascade_revoke_state)
    delete = _Delete()
    _receive(receiver_mocks, _lease(), delete)
    created = set(signals._cascade_revoke_state) - existing
    assert created

    del delete
    receiver_mocks.connection.atomic_blocks = []
    gc.collect()

    assert not created & set(signals._cascade_revoke_state)


def test_skipped_lease_log_identifies_what_to_revoke(receiver_mocks):
    delete = _Delete()
    _receive(receiver_mocks, _lease("lease-1"), delete)
    receiver_mocks.clock.now += signals.CASCADE_REVOKE_BUDGET_SECONDS + 1

    _receive(receiver_mocks, _lease("lease-2"), delete)

    args = receiver_mocks.logger.error.call_args.args
    assert args[1:] == (
        "lease-2",
        "revocation time budget exhausted",
        "phase-user-1",
        "ds-1",
        "env-1",
        "cred-1",
        "2026-01-01T00:00:00Z",
    )


def test_budget_is_bounded_well_under_worker_timeouts():
    assert signals.CASCADE_REVOKE_BUDGET_SECONDS <= 30


@pytest.mark.parametrize(
    ("exc", "unreachable"),
    [
        (EndpointConnectionError(endpoint_url="https://iam.amazonaws.com"), True),
        (ReadTimeoutError(endpoint_url="https://iam.amazonaws.com"), True),
        (RuntimeError("DeleteConflict"), False),
        (None, False),
    ],
)
def test_provider_unreachable_detection(exc, unreachable):
    assert dynamic_utils.is_provider_unreachable_error(exc) is unreachable


def test_provider_unreachable_detection_follows_wrapped_errors():
    assert dynamic_utils.is_provider_unreachable_error(_unreachable())


class TestRevokeLeaseImmediately:
    @staticmethod
    def _lease(provider="aws", cleanup_job_id="job-1"):
        return SimpleNamespace(
            id="lease-1",
            secret=SimpleNamespace(provider=provider),
            cleanup_job_id=cleanup_job_id,
        )

    @pytest.fixture(autouse=True)
    def _scheduler(self, monkeypatch):
        self.on_commit = []
        monkeypatch.setattr(
            dynamic_utils.transaction, "on_commit", lambda fn: self.on_commit.append(fn)
        )
        self.scheduler = MagicMock()
        monkeypatch.setattr(
            dynamic_utils.django_rq, "get_scheduler", lambda name: self.scheduler
        )
        self.job = MagicMock()
        monkeypatch.setattr(dynamic_utils, "Job", self.job)

    def _commit(self):
        for fn in self.on_commit:
            fn()

    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_revokes_with_bounded_client_and_cancels_job_on_commit(self, mock_revoke):
        dynamic_utils.revoke_lease_immediately(self._lease())

        mock_revoke.assert_called_once_with(
            "lease-1",
            manual=True,
            client_config=dynamic_utils.IN_REQUEST_REVOKE_CLIENT_CONFIG,
        )
        self.scheduler.cancel.assert_not_called()

        self._commit()

        self.scheduler.cancel.assert_called_once_with("job-1")
        self.job.fetch.assert_called_once_with(
            "job-1", connection=self.scheduler.connection
        )
        self.job.fetch.return_value.delete.assert_called_once_with(
            remove_from_queue=False
        )

    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_already_revoked_still_cancels_job(self, mock_revoke):
        mock_revoke.side_effect = LeaseAlreadyRevokedError("already revoked")

        dynamic_utils.revoke_lease_immediately(self._lease())
        self._commit()

        self.scheduler.cancel.assert_called_once_with("job-1")

    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_provider_failure_raises_and_keeps_job(self, mock_revoke):
        mock_revoke.side_effect = Exception("AccessDenied")

        with pytest.raises(Exception, match="AccessDenied"):
            dynamic_utils.revoke_lease_immediately(self._lease())

        assert self.on_commit == []

    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_unknown_provider_is_skipped(self, mock_revoke):
        dynamic_utils.revoke_lease_immediately(self._lease(provider="gcp"))

        mock_revoke.assert_not_called()
        assert self.on_commit == []

    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_cancel_failure_after_revoke_is_swallowed(self, mock_revoke):
        self.scheduler.cancel.side_effect = ConnectionError("redis down")

        dynamic_utils.revoke_lease_immediately(self._lease())
        self._commit()

        mock_revoke.assert_called_once()

    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_missing_job_hash_is_ignored(self, mock_revoke):
        self.job.fetch.side_effect = NoSuchJobError("gone")

        dynamic_utils.revoke_lease_immediately(self._lease())
        self._commit()

        self.scheduler.cancel.assert_called_once_with("job-1")


def test_bounded_client_config_is_timeout_limited():
    config = dynamic_utils.IN_REQUEST_REVOKE_CLIENT_CONFIG

    assert config.connect_timeout <= 5
    assert config.read_timeout <= 15
    assert config.retries["total_max_attempts"] <= 2


@pytest.mark.parametrize("integration_key", [None, "AKIAINTEGRATION"])
@pytest.mark.parametrize(
    "config", [None, dynamic_utils.IN_REQUEST_REVOKE_CLIENT_CONFIG]
)
def test_iam_client_passes_config_to_both_clients(monkeypatch, config, integration_key):
    mock_boto_client = MagicMock()
    monkeypatch.setattr(aws_utils.boto3, "client", mock_boto_client)
    monkeypatch.setattr(
        aws_utils,
        "get_aws_access_key_credentials",
        MagicMock(
            return_value={
                "access_key_id": "AKIAFAKE",
                "secret_access_key": "fake",
                "region": "us-east-1",
            }
        ),
    )
    monkeypatch.setattr(
        aws_utils, "get_secret", MagicMock(return_value=integration_key)
    )
    secret = SimpleNamespace(authentication=SimpleNamespace(credentials={}))

    aws_utils.get_iam_client(secret, config=config)

    assert [c.kwargs.get("config") for c in mock_boto_client.call_args_list] == [
        config,
        config,
    ]


class _StopAfterClient(Exception):
    pass


def test_revoke_forwards_client_config_to_iam_client(monkeypatch):
    config = dynamic_utils.IN_REQUEST_REVOKE_CLIENT_CONFIG
    lease = SimpleNamespace(id="lease-1", revoked_at=None, secret=object())
    monkeypatch.setattr(
        aws_utils.DynamicSecretLease.objects, "get", MagicMock(return_value=lease)
    )
    get_iam = MagicMock(side_effect=_StopAfterClient)
    monkeypatch.setattr(aws_utils, "get_iam_client", get_iam)

    with pytest.raises(_StopAfterClient):
        aws_utils.revoke_aws_dynamic_secret_lease(
            "lease-1", manual=True, client_config=config
        )

    assert get_iam.call_args.kwargs["config"] is config


def test_lease_iam_username_decrypts_with_environment_keys(monkeypatch):
    monkeypatch.setattr(
        dynamic_utils, "get_environment_keys", MagicMock(return_value=("pub", "priv"))
    )
    decrypt = MagicMock(return_value="phase-user-1")
    monkeypatch.setattr(dynamic_utils, "decrypt_asymmetric", decrypt)
    lease = SimpleNamespace(
        credentials={"username": "ph:v1:enc"},
        secret=SimpleNamespace(environment_id="env-1"),
    )

    assert dynamic_utils.lease_iam_username(lease) == "phase-user-1"
    decrypt.assert_called_once_with("ph:v1:enc", "priv", "pub")


def test_lease_iam_username_never_raises(monkeypatch):
    monkeypatch.setattr(
        dynamic_utils, "get_environment_keys", MagicMock(side_effect=RuntimeError)
    )
    lease = SimpleNamespace(credentials={}, secret=SimpleNamespace(environment_id="e"))

    assert dynamic_utils.lease_iam_username(lease) is None
