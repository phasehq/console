"""AWS keys assumed for an AWS role credential are released only when the
credential is still at the revision they were assumed for. The AWS call is
replaced before anything can reach it, and makes its change by hand."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone

from api.models import AgentConnection
from api.utils import agent_credentials
from api.utils.agent_config import get_config_registry
from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_agent_credential,
)
from api.utils.agent_sessions import create_agent_session

from .custom_connections import (
    grant,
    provider_credential,
    use_test_server_keypair,
    workspace,
)


OLD_ROLE = "arn:aws:iam::123456789012:role/phase-agent-old"
NEW_ROLE = "arn:aws:iam::123456789012:role/phase-agent-new"


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture(autouse=True)
def no_cached_roles():
    agent_credentials._ASSUMED_ROLES.clear()
    yield
    agent_credentials._ASSUMED_ROLES.clear()


@pytest.fixture
def role(db):
    space = workspace("agentrules-assumed-roles")
    space.credential = provider_credential(
        space,
        "aws_assume_role",
        {"role_arn": OLD_ROLE, "region": "eu-west-1"},
        name="AWS deploy role",
    )
    connection = AgentConnection.objects.create(
        organisation=space.organisation,
        name="AWS role",
        service_type="aws",
        config=get_config_registry().validate_service_config("aws", {}),
        authentication=space.credential,
        state=AgentConnection.ACTIVE,
        created_by=space.member,
        updated_by=space.member,
    )
    space.grant = grant(space, connection)
    space.session, _, _ = create_agent_session(
        agent=space.agent,
        workflow=space.workflow,
        opened_by_member=space.member,
        idempotency_key=f"agentrules-{uuid4().hex}",
        client_info={"features": ["provider_rules"], "injectionActions": ["aws_sigv4"]},
    )
    return space


def _assumed_keys(role_arn):
    return {
        "AccessKeyId": "ASIA" + "O" * 16,
        "SecretAccessKey": f"session-secret-for-{role_arn.rsplit('/', 1)[-1]}",
        "SessionToken": "session-token",
        "Expiration": timezone.now() + timedelta(hours=1),
    }


def test_keys_assumed_while_the_credential_changed_are_not_released(role, monkeypatch):
    assumed = []

    def assume_while_the_role_changes(role_arn, region=None, external_id=None, **options):
        assumed.append(role_arn)
        # A member's edit commits while AWS answers, as a credential update does.
        row = type(role.credential).objects.get(pk=role.credential.pk)
        row.credentials = provider_credential(
            role, "aws_assume_role", {"role_arn": NEW_ROLE, "region": "eu-west-1"}
        ).credentials
        row.save()
        return _assumed_keys(role_arn)

    # Installed before anything below can reach AWS.
    monkeypatch.setattr(
        "api.utils.syncing.aws.auth.assume_aws_role", assume_while_the_role_changes
    )

    with pytest.raises(CredentialResolutionError, match="changed while its role"):
        resolve_agent_credential(role.credential, role.session, grant=role.grant)
    assert assumed == [OLD_ROLE]


def test_keys_assumed_for_an_unchanged_credential_are_released(role, monkeypatch):
    monkeypatch.setattr(
        "api.utils.syncing.aws.auth.assume_aws_role",
        lambda role_arn, region=None, external_id=None, **options: _assumed_keys(
            role_arn
        ),
    )

    resolved = resolve_agent_credential(role.credential, role.session, grant=role.grant)

    assert resolved.material["secret_access_key"] == "session-secret-for-phase-agent-old"
    assert resolved.generation == str(role.credential.revision)
