from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from rest_framework import exceptions
from rest_framework.test import APIRequestFactory

from api.auth import AgentAPIAuthentication, AgentUser, PhaseTokenAuthentication


def _request(token_type="Agent", extra_headers=None):
    headers = {
        "HTTP_AUTHORIZATION": f"Bearer {token_type} token-value",
        **(extra_headers or {}),
    }
    request = APIRequestFactory().get("/v1/agents/sessions", **headers)
    request.resolver_match = MagicMock(kwargs={})
    return request


def _agent_token():
    organisation = SimpleNamespace(id="org-1")
    member = SimpleNamespace(id="member-1", role=SimpleNamespace(), deleted_at=None)
    agent = SimpleNamespace(
        id="agent-1",
        name="build-agent",
        ACTIVE="active",
        status="active",
        deleted_at=None,
        organisation=organisation,
        organisation_id="org-1",
    )
    workflow = SimpleNamespace(
        id="workflow-1",
        name="default",
        agent_id="agent-1",
        organisation_id="org-1",
        deleted_at=None,
    )
    return SimpleNamespace(
        id="token-1",
        agent=agent,
        workflow=workflow,
        created_by=member,
        created_by_id=member.id,
    )


def test_legacy_phase_authentication_rejects_agent_tokens():
    with patch("api.auth.get_token_type", return_value="Agent"):
        with pytest.raises(exceptions.AuthenticationFailed, match="Invalid token"):
            PhaseTokenAuthentication().authenticate(_request())


def test_agent_api_authentication_is_runtime_scoped_and_ignores_resource_headers():
    token = _agent_token()
    request = _request(extra_headers={"HTTP_SECRET_ID": "must-not-be-resolved"})

    with patch("api.auth.get_token_type", return_value="Agent"), patch(
        "api.auth.get_agent_token", return_value=token
    ), patch(
        "api.auth.account_can_access_workflow", return_value=True
    ), patch(
        "api.auth.AgentToken.objects.filter"
    ) as update_qs, patch("api.auth.Secret.objects") as secret_objects:
        update_qs.return_value.filter.return_value.update.return_value = 1
        user, auth = AgentAPIAuthentication().authenticate(request)

    assert isinstance(user, AgentUser)
    assert auth["agent"] is token.agent
    assert auth["workflow"] is token.workflow
    assert auth["organisation"] is token.agent.organisation
    assert auth["org_only"] is True
    secret_objects.select_related.assert_not_called()
    update_qs.assert_called_once_with(
        id="token-1",
        deleted_at__isnull=True,
        workflow__agent__deleted_at__isnull=True,
        workflow__agent__status="active",
        created_by__deleted_at__isnull=True,
        workflow__deleted_at__isnull=True,
    )


def test_agent_api_authentication_accepts_member_bound_agent_token():
    token = _agent_token()
    request = _request()

    with patch("api.auth.get_token_type", return_value="Agent"), patch(
        "api.auth.get_agent_token", return_value=token
    ), patch(
        "api.auth.account_can_access_workflow", return_value=True
    ), patch(
        "api.auth.AgentToken.objects.filter"
    ) as update_qs:
        update_qs.return_value.filter.return_value.update.return_value = 1
        user, auth = AgentAPIAuthentication().authenticate(request)

    assert isinstance(user, AgentUser)
    assert auth["agent"] is token.agent
    assert auth["workflow"] is token.workflow
    update_qs.assert_called_once_with(
        id="token-1",
        deleted_at__isnull=True,
        workflow__agent__deleted_at__isnull=True,
        workflow__agent__status="active",
        created_by__deleted_at__isnull=True,
        workflow__deleted_at__isnull=True,
    )


def test_agent_api_rejects_environment_service_tokens():
    with patch("api.auth.get_token_type", return_value="Service"):
        with pytest.raises(exceptions.AuthenticationFailed, match="Invalid token"):
            AgentAPIAuthentication().authenticate(_request(token_type="Service"))


def test_agent_api_rejects_service_account_tokens():
    with patch("api.auth.get_token_type", return_value="ServiceAccount"):
        with pytest.raises(exceptions.AuthenticationFailed, match="Invalid token"):
            AgentAPIAuthentication().authenticate(
                _request(token_type="ServiceAccount")
            )


def test_agent_api_rejects_agent_token_not_resolved_as_active():
    with patch("api.auth.get_token_type", return_value="Agent"), patch(
        "api.auth.get_agent_token", return_value=None
    ), patch("api.auth.token_is_expired_or_deleted") as expiry_check:
        with pytest.raises(
            exceptions.AuthenticationFailed, match="Agent token not found"
        ):
            AgentAPIAuthentication().authenticate(_request())

    expiry_check.assert_not_called()


def test_agent_api_rejects_token_revoked_after_active_lookup():
    token = _agent_token()
    with patch("api.auth.get_token_type", return_value="Agent"), patch(
        "api.auth.get_agent_token", return_value=token
    ), patch(
        "api.auth.account_can_access_workflow", return_value=True
    ), patch("api.auth.AgentToken.objects.filter") as update_qs:
        update_qs.return_value.filter.return_value.update.return_value = 0
        with pytest.raises(
            exceptions.AuthenticationFailed,
            match="Agent token is no longer active",
        ):
            AgentAPIAuthentication().authenticate(_request())


def test_agent_api_rejects_token_when_creators_workflow_access_is_revoked():
    token = _agent_token()
    with patch("api.auth.get_token_type", return_value="Agent"), patch(
        "api.auth.get_agent_token", return_value=token
    ), patch(
        "api.auth.account_can_access_workflow", return_value=False
    ) as access:
        with pytest.raises(
            exceptions.AuthenticationFailed,
            match="Agent token is no longer active",
        ):
            AgentAPIAuthentication().authenticate(_request())

    access.assert_called_once_with(
        token.created_by,
        token.workflow,
        "create",
        resource="AgentSessions",
    )
