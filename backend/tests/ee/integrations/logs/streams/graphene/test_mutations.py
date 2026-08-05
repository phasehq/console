"""Log stream mutations: permission, plan-gate and input validation guards."""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from graphql import GraphQLError

from ee.integrations.logs.streams.graphene.mutations import (
    CreateLogStreamMutation,
    RetryLogStreamDeliveryMutation,
    ToggleLogStreamMutation,
    UpdateLogStreamMutation,
)
# Aliased so pytest doesn't try to collect the graphene class as a test case.
from ee.integrations.logs.streams.graphene.mutations import (
    TestLogStreamConnectionMutation as ConnectionTestMutation,
)

_M = "ee.integrations.logs.streams.graphene.mutations"


@pytest.fixture(autouse=True)
def _global_access():
    """Log stream operations additionally require a role with global access;
    grant it by default so each test exercises its own concern. The denial
    path sets .return_value = False explicitly."""
    with patch(f"{_M}.user_has_global_access", return_value=True) as mock_global:
        yield mock_global


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _org():
    org = MagicMock()
    org.id = "org-1"
    org.plan = "EN"
    return org


def _adapter():
    adapter = MagicMock()
    adapter.id = "datadog"
    adapter.name = "Datadog"
    adapter.credentials_provider = "datadog"
    adapter.max_event_age = timedelta(hours=18)
    adapter.validate_options.side_effect = lambda options: options
    return adapter


def _credential(org_id="org-1", provider="datadog"):
    credential = MagicMock()
    credential.id = "cred-1"
    credential.organisation_id = org_id
    credential.provider = provider
    return credential


def _create(org, **overrides):
    kwargs = dict(
        organisation_id=org.id,
        name="Datadog prod",
        provider="datadog",
        credential_id="cred-1",
        sources=["org_audit"],
    )
    kwargs.update(overrides)
    return CreateLogStreamMutation.mutate(None, _info(), **kwargs)


def test_create_blocked_without_permission():
    org = _org()

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=False
    ):
        MockOrg.objects.get.return_value = org

        with pytest.raises(GraphQLError, match="permission"):
            _create(org)


def test_create_blocked_without_global_access(_global_access):
    """A scoped custom role can hold LogStreams permissions, but streams
    export org-wide activity — configuring one requires global access."""
    _global_access.return_value = False
    org = _org()

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=True
    ):
        MockOrg.objects.get.return_value = org

        with pytest.raises(GraphQLError, match="global access"):
            _create(org)


def test_create_blocked_on_non_enterprise_plan():
    org = _org()
    org.plan = "PR"

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=False):
        MockOrg.objects.get.return_value = org

        with pytest.raises(GraphQLError, match="Enterprise"):
            _create(org)


def test_create_rejects_cross_org_credential():
    org = _org()

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.get_source"
    ), patch(
        f"{_M}.ProviderCredentials"
    ) as MockCreds, patch(
        f"{_M}.LogStream"
    ) as MockStream:
        MockOrg.objects.get.return_value = org
        MockCreds.DoesNotExist = Exception
        MockCreds.objects.get.return_value = _credential(org_id="other-org")

        with pytest.raises(GraphQLError, match="don't exist"):
            _create(org)

        MockStream.objects.create.assert_not_called()


def test_create_rejects_wrong_provider_credential():
    org = _org()

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.get_source"
    ), patch(
        f"{_M}.ProviderCredentials"
    ) as MockCreds:
        MockOrg.objects.get.return_value = org
        MockCreds.DoesNotExist = Exception
        MockCreds.objects.get.return_value = _credential(provider="aws")

        with pytest.raises(GraphQLError, match="require datadog credentials"):
            _create(org)


def test_create_rejects_empty_and_unknown_sources():
    org = _org()

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.get_source", side_effect=ValueError("Unknown log stream source 'bogus'")
    ):
        MockOrg.objects.get.return_value = org

        with pytest.raises(GraphQLError, match="at least one"):
            _create(org, sources=[])

        with pytest.raises(GraphQLError, match="Unknown log stream source"):
            _create(org, sources=["bogus"])


def test_create_clamps_max_attempts_and_dedupes_sources():
    org = _org()

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.get_source"
    ), patch(
        f"{_M}.ProviderCredentials"
    ) as MockCreds, patch(
        f"{_M}.LogStream"
    ) as MockStream, patch(
        f"{_M}.log_audit_event"
    ):
        MockOrg.objects.get.return_value = org
        MockCreds.DoesNotExist = Exception
        MockCreds.objects.get.return_value = _credential()

        _create(org, sources=["org_audit", "org_audit", "secrets"], max_attempts=99)

        kwargs = MockStream.objects.create.call_args.kwargs
        assert kwargs["max_attempts"] == 10
        assert kwargs["sources"] == ["org_audit", "secrets"]


def test_toggle_pauses_via_engine():
    stream = MagicMock()
    stream.is_active = True
    stream.organisation = _org()

    with patch(f"{_M}.LogStream") as MockStream, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.engine.pause"
    ) as mock_pause, patch(
        f"{_M}.engine.resume"
    ) as mock_resume, patch(
        f"{_M}.log_audit_event"
    ):
        MockStream.objects.get.return_value = stream

        ToggleLogStreamMutation.mutate(None, _info(), stream_id="stream-1")

        mock_pause.assert_called_once_with(stream)
        mock_resume.assert_not_called()


def test_toggle_resume_requires_credentials():
    """A stream stranded by credential deletion can't resume until new
    credentials are selected — resuming would just re-pause on the next
    sweep."""
    stream = MagicMock()
    stream.is_active = False
    stream.authentication_id = None
    stream.organisation = _org()

    with patch(f"{_M}.LogStream") as MockStream, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.engine.resume"
    ) as mock_resume:
        MockStream.objects.get.return_value = stream

        with pytest.raises(GraphQLError, match="no credentials"):
            ToggleLogStreamMutation.mutate(None, _info(), stream_id="stream-1")

        mock_resume.assert_not_called()


def test_test_connection_rejects_wrong_provider_credential():
    """Without the provider check, another provider's api_key would be
    decrypted and sent to this adapter's destination."""
    org = _org()

    with patch(f"{_M}.Organisation") as MockOrg, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.ProviderCredentials"
    ) as MockCreds, patch(
        f"{_M}.engine.test_adapter_connection"
    ) as mock_test:
        MockOrg.objects.get.return_value = org
        MockCreds.DoesNotExist = Exception
        MockCreds.objects.get.return_value = _credential(provider="render")

        with pytest.raises(GraphQLError, match="require datadog credentials"):
            ConnectionTestMutation.mutate(
                None,
                _info(),
                organisation_id=org.id,
                provider="datadog",
                credential_id="cred-1",
            )

        mock_test.assert_not_called()


def test_update_saves_only_config_fields():
    """A full save would write cursors/health/activity from the mutation's
    (possibly stale) row and clobber concurrent worker state."""
    stream = MagicMock()
    stream.organisation = _org()
    stream.provider = "datadog"

    with patch(f"{_M}.LogStream") as MockStream, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.get_source"
    ), patch(
        f"{_M}.ProviderCredentials"
    ) as MockCreds, patch(
        f"{_M}.log_audit_event"
    ):
        MockStream.objects.get.return_value = stream
        MockCreds.DoesNotExist = Exception
        MockCreds.objects.get.return_value = _credential()

        UpdateLogStreamMutation.mutate(
            None,
            _info(),
            stream_id="stream-1",
            name="Renamed",
            credential_id="cred-1",
            sources=["org_audit"],
        )

        update_fields = stream.save.call_args.kwargs["update_fields"]
        assert "cursors" not in update_fields
        assert "is_active" not in update_fields
        assert "health" not in update_fields
        assert set(update_fields) == {
            "name",
            "authentication",
            "sources",
            "options",
            "max_attempts",
            "updated_at",
        }


def test_retry_rejects_completed_and_resolved_deliveries():
    stream = MagicMock()
    stream.organisation = _org()
    stream.deleted_at = None

    delivery = MagicMock()
    delivery.stream = stream

    with patch(f"{_M}.LogStreamDeliveryEvent") as MockDelivery, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True):
        (
            MockDelivery.objects.select_related.return_value.get.return_value
        ) = delivery

        delivery.status = "completed"
        delivery.resolved_at = None
        with pytest.raises(GraphQLError, match="Only failed or skipped"):
            RetryLogStreamDeliveryMutation.mutate(
                None, _info(), delivery_event_id="d-1"
            )

        delivery.status = "failed"
        delivery.resolved_at = "2026-07-30T12:00:00Z"
        with pytest.raises(GraphQLError, match="already been resolved"):
            RetryLogStreamDeliveryMutation.mutate(
                None, _info(), delivery_event_id="d-1"
            )


def _fresh_delivery(stream):
    now = timezone.now()
    delivery = MagicMock()
    delivery.id = "d-1"
    delivery.stream = stream
    delivery.status = "failed"
    delivery.resolved_at = None
    delivery.cursor_from = now - timedelta(hours=2)
    delivery.cursor_to = now - timedelta(hours=1)
    return delivery


def test_retry_enqueues_engine_job():
    stream = MagicMock()
    stream.organisation = _org()
    stream.deleted_at = None
    stream.provider = "datadog"

    delivery = _fresh_delivery(stream)

    with patch(f"{_M}.LogStreamDeliveryEvent") as MockDelivery, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.engine.retry_delivery"
    ) as mock_retry, patch(
        f"{_M}.log_audit_event"
    ):
        (
            MockDelivery.objects.select_related.return_value.get.return_value
        ) = delivery

        result = RetryLogStreamDeliveryMutation.mutate(
            None, _info(), delivery_event_id="d-1"
        )

        assert result.ok is True
        mock_retry.delay.assert_called_once_with("d-1")


def test_retry_rejects_expired_range():
    """The destination silently discards events older than its ingestion
    window — the mutation rejects the retry with actionable guidance."""
    stream = MagicMock()
    stream.organisation = _org()
    stream.deleted_at = None
    stream.provider = "datadog"

    delivery = _fresh_delivery(stream)
    delivery.cursor_from = timezone.now() - timedelta(hours=30)
    delivery.cursor_to = timezone.now() - timedelta(hours=20)

    with patch(f"{_M}.LogStreamDeliveryEvent") as MockDelivery, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.get_adapter", return_value=_adapter()
    ), patch(
        f"{_M}.engine.retry_delivery"
    ) as mock_retry:
        (
            MockDelivery.objects.select_related.return_value.get.return_value
        ) = delivery

        with pytest.raises(GraphQLError, match="ingestion window"):
            RetryLogStreamDeliveryMutation.mutate(
                None, _info(), delivery_event_id="d-1"
            )

        mock_retry.delay.assert_not_called()


def test_retry_rejects_paused_streams():
    """Pause means no egress — manual retries included."""
    stream = MagicMock()
    stream.organisation = _org()
    stream.deleted_at = None
    stream.is_active = False

    delivery = _fresh_delivery(stream)

    with patch(f"{_M}.LogStreamDeliveryEvent") as MockDelivery, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.engine.retry_delivery"
    ) as mock_retry:
        (
            MockDelivery.objects.select_related.return_value.get.return_value
        ) = delivery

        with pytest.raises(GraphQLError, match="paused"):
            RetryLogStreamDeliveryMutation.mutate(
                None, _info(), delivery_event_id="d-1"
            )

        mock_retry.delay.assert_not_called()


def test_retry_rejects_rows_without_event_range():
    stream = MagicMock()
    stream.organisation = _org()
    stream.deleted_at = None

    delivery = _fresh_delivery(stream)
    delivery.cursor_from = None
    delivery.cursor_to = None

    with patch(f"{_M}.LogStreamDeliveryEvent") as MockDelivery, patch(
        f"{_M}.user_has_permission", return_value=True
    ), patch(f"{_M}.can_use_log_streams", return_value=True), patch(
        f"{_M}.engine.retry_delivery"
    ) as mock_retry:
        (
            MockDelivery.objects.select_related.return_value.get.return_value
        ) = delivery

        with pytest.raises(GraphQLError, match="no event range"):
            RetryLogStreamDeliveryMutation.mutate(
                None, _info(), delivery_event_id="d-1"
            )

        mock_retry.delay.assert_not_called()
