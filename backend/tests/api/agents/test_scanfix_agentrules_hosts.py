"""A GitLab credential whose instance is served two or more path segments
down backs no Connection: the GitLab manifest's guard and call class paths
reach only the root and one segment below it."""

import pytest
from graphql import GraphQLError

from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_connection_config,
)
from api.utils.crypto import encrypt_asymmetric
from backend.graphene.mutations.syncing import UpdateProviderCredentials

from .custom_connections import (
    ACTIONS,
    SERVER_KEYPAIR,
    grant,
    live_packaged_connection,
    member_client,
    open_session,
    provider_credential,
    use_test_server_keypair,
    workspace,
)


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("agentrules-hosts")
    role = space.member.role
    role.permissions["permissions"]["IntegrationCredentials"] = ACTIONS
    role.save()
    return space


def _gitlab_material(gitlab_host):
    return {"gitlab_host": gitlab_host, "gitlab_token": "live-gitlab-token"}


@pytest.mark.django_db
def test_a_gitlab_credential_served_two_segments_down_backs_no_connection(space):
    credential = provider_credential(
        space, "gitlab", _gitlab_material("https://code.example.com/tools/gitlab")
    )

    with pytest.raises(CredentialResolutionError, match="at most one path segment") as error:
        resolve_connection_config(credential)
    assert "live-gitlab-token" not in str(error.value)


@pytest.mark.django_db
def test_a_credential_a_gitlab_connection_uses_cannot_move_two_segments_down(space):
    connection = live_packaged_connection(
        space, "gitlab", _gitlab_material("https://code.example.com/gitlab")
    )
    credential = connection.authentication

    with pytest.raises(
        GraphQLError, match="used by an Agent Connection.*at most one path segment"
    ):
        UpdateProviderCredentials.mutate(
            None,
            space.info,
            credential_id=credential.id,
            expected_revision=credential.revision,
            name=credential.name,
            credentials={
                field: encrypt_asymmetric(value, SERVER_KEYPAIR[0].hex())
                for field, value in _gitlab_material(
                    "https://code.example.com/tools/gitlab"
                ).items()
            },
        )

    connection.refresh_from_db()
    assert connection.config["hosts"][0]["path"] == "/gitlab/api/*"


@pytest.mark.django_db
def test_a_gitlab_token_is_not_released_once_its_host_moves_two_segments_down(space):
    connection = live_packaged_connection(
        space, "gitlab", _gitlab_material("https://code.example.com/gitlab")
    )
    grant(space, connection)
    # Written straight to the row: a member's edit to this host is refused
    # while a Connection uses the credential.
    deeper = provider_credential(
        space, "gitlab", _gitlab_material("https://code.example.com/tools/gitlab")
    )
    type(deeper).objects.filter(pk=connection.authentication_id).update(
        credentials=deeper.credentials
    )

    refusal = open_session(member_client(space), space.workflow, expect=400)

    assert refusal["error"]["code"] == "credential_resolution_failed"
    assert "at most one path segment" in refusal["error"]["details"]["reason"]
    assert "live-gitlab-token" not in str(refusal)
