import pytest
from django.test import override_settings

from api.models import (
    Agent,
    AgentSession,
    CustomUser,
    Organisation,
    OrganisationMember,
    Role,
)
from api.utils.agent_sessions import (
    SESSION_CREDENTIAL_PREFIX,
    create_agent_session,
    hash_session_credential,
    mint_session_credential,
    render_decoy_format,
    rotate_session_credential,
    verify_session_credential,
)
from api.utils.agents import create_agent_with_default_workflow


@pytest.fixture
def principal(db):
    organisation = Organisation.objects.create(
        name="Agent session org", identity_key="00" * 32
    )
    role = Role.objects.create(
        name="Agent runner",
        organisation=organisation,
        permissions={
            "permissions": {
                "Agents": ["create", "read", "update"],
            },
            "agent_permissions": {
                "AgentWorkflows": ["create", "read", "update", "delete"],
                "AgentSessions": ["create", "read", "delete"],
            }
        },
    )
    user = CustomUser.objects.create_user(
        username="agent-session-user",
        email="agent-session@example.com",
    )
    member = OrganisationMember.objects.create(
        user=user,
        organisation=organisation,
        role=role,
    )
    agent, workflow = create_agent_with_default_workflow(
        organisation=organisation,
        name="Session agent",
        harness_type=Agent.OTHER,
        created_by=member,
    )
    return member, agent, workflow


@override_settings(SERVER_SECRET="11" * 32)
def test_idempotent_session_credentials_are_stable_and_url_safe():
    first = mint_session_credential("retry-key")
    second = mint_session_credential("retry-key")
    assert first == second
    assert first.startswith(SESSION_CREDENTIAL_PREFIX)
    assert ":" not in first
    assert "/" not in first


@pytest.mark.django_db
@override_settings(SERVER_SECRET="11" * 32)
def test_session_open_retry_returns_same_record_and_capability(principal):
    member, agent, workflow = principal
    session, credential, created = create_agent_session(
        agent=agent,
        workflow=workflow,
        idempotency_key="open-retry-1",
        opened_by_member=member,
        harness_label="test",
    )
    retried, retried_credential, retry_created = create_agent_session(
        agent=agent,
        workflow=workflow,
        idempotency_key="open-retry-1",
        opened_by_member=member,
        harness_label="ignored-on-retry",
    )

    assert created is True
    assert retry_created is False
    assert retried.pk == session.pk
    assert retried_credential == credential
    assert verify_session_credential(session, credential) is True
    assert verify_session_credential(session, credential + "bad") is False
    assert session.hashed_session_credential == hash_session_credential(credential)
    assert credential not in session.hashed_session_credential


@pytest.mark.django_db
@override_settings(SERVER_SECRET="11" * 32)
def test_rotation_invalidates_old_capability(principal):
    member, agent, workflow = principal
    session, original, _ = create_agent_session(
        agent=agent,
        workflow=workflow,
        opened_by_member=member,
    )
    rotated = rotate_session_credential(session)
    session.refresh_from_db()

    assert rotated != original
    assert verify_session_credential(session, original) is False
    assert verify_session_credential(session, rotated) is True
    assert session.config_generation == 2


@pytest.mark.parametrize(
    "format_string,prefix,length",
    [
        ("phx_{rand:base64:40}", "phx_", 44),
        ("ghp_{rand:alnum:36}", "ghp_", 40),
        ("phx_{rand:hex:32}", "phx_", 36),
    ],
)
def test_decoy_formats_have_required_shape(format_string, prefix, length):
    value = render_decoy_format(format_string)
    assert value.startswith(prefix)
    assert len(value) == length


@pytest.mark.parametrize(
    "format_string",
    ["static", "{rand:alnum:10}", "{rand:hex:16}", "{rand:alnum:32}{rand:hex:32}"],
)
def test_decoy_formats_reject_missing_or_weak_entropy(format_string):
    with pytest.raises(ValueError):
        render_decoy_format(format_string)
