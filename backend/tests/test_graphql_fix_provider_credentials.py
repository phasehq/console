"""What an Integration Credential shows its readers, and what an update keeps."""

import json
from types import SimpleNamespace

import pytest
from django.test import RequestFactory
from graphql import GraphQLError

from api.models import (
    CustomUser,
    Organisation,
    OrganisationMember,
    ProviderCredentials,
    Role,
)
from api.utils.crypto import encrypt_asymmetric, get_server_keypair
from api.utils.syncing.auth import get_credentials
from backend.graphene.mutations.syncing import (
    CreateProviderCredentials,
    UpdateProviderCredentials,
    validate_credential_values,
)
from backend.schema import schema


@pytest.fixture
def member(db):
    organisation = Organisation.objects.create(
        name="Provider credentials", identity_key="00" * 32
    )
    role = Role.objects.create(
        organisation=organisation,
        name="Integration editor",
        permissions={
            "permissions": {
                "IntegrationCredentials": ["create", "read", "update", "delete"]
            }
        },
    )
    user = CustomUser.objects.create_user(
        username="credential-editor", email="credential-editor@example.com"
    )
    return OrganisationMember.objects.create(
        organisation=organisation, user=user, role=role
    )


def _info(member):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return SimpleNamespace(context=request)


def _encrypt(values):
    public_key, _ = get_server_keypair()
    return {
        key: encrypt_asymmetric(value, public_key.hex())
        for key, value in values.items()
    }


def _credential(member, provider, values):
    return ProviderCredentials.objects.create(
        organisation=member.organisation,
        provider=provider,
        name=provider,
        credentials=_encrypt(values),
    )


def _update(member, credential, values):
    return UpdateProviderCredentials.mutate(
        None,
        _info(member),
        credential_id=credential.id,
        expected_revision=credential.revision,
        name=credential.name,
        credentials=_encrypt(values),
    ).credential


# --- A GitLab host is shown to every reader -----------------------------------


@pytest.mark.parametrize(
    "host",
    [
        "https://proxyuser:proxy-pass@gitlab.example.com",
        "https://token@gitlab.example.com/group",
        "proxyuser:proxy-pass@gitlab.example.com",
        "  HTTPS://proxyuser:proxy-pass@gitlab.example.com:8443  ",
        "https://proxyuser:proxy-pass\\@gitlab.example.com",
    ],
)
def test_a_gitlab_host_with_a_username_or_password_is_refused(host):
    with pytest.raises(GraphQLError, match="username or password"):
        validate_credential_values(
            "gitlab", _encrypt({"gitlab_host": host, "gitlab_token": "glpat-x"})
        )


@pytest.mark.parametrize(
    "host",
    [
        "https://gitlab.example.com",
        "gitlab.example.com",
        "https://gitlab.example.com:8443/gitlab",
        "https://gitlab.example.com/team@work",
    ],
)
def test_a_gitlab_host_without_them_is_accepted(host):
    assert (
        validate_credential_values(
            "gitlab", _encrypt({"gitlab_host": host, "gitlab_token": "glpat-x"})
        )
        is None
    )


def test_a_gitlab_credential_is_not_saved_with_a_password_in_its_host(member):
    values = {
        "gitlab_host": "https://proxyuser:proxy-pass@gitlab.example.com",
        "gitlab_token": "glpat-x",
    }

    with pytest.raises(GraphQLError, match="username or password"):
        CreateProviderCredentials.mutate(
            None,
            _info(member),
            org_id=member.organisation.id,
            provider="gitlab",
            name="GitLab",
            credentials=_encrypt(values),
        )
    assert not ProviderCredentials.objects.filter(
        organisation=member.organisation
    ).exists()

    credential = _credential(
        member,
        "gitlab",
        {"gitlab_host": "https://gitlab.example.com", "gitlab_token": "glpat-x"},
    )
    with pytest.raises(GraphQLError, match="username or password"):
        _update(member, credential, values)
    assert get_credentials(credential.id)["gitlab_host"] == "https://gitlab.example.com"


# --- A Vault role ID is sealed -------------------------------------------------


def test_a_vault_role_id_is_not_shown_to_readers(member):
    credential = _credential(
        member,
        "hashicorp_vault",
        {
            "vault_addr": "https://vault.example.com",
            "vault_role_id": "role-id-sentinel",
            "vault_secret_id": "secret-id-sentinel",
        },
    )

    result = schema.execute(
        """
        query($credentialId: ID!) {
          providerCredential(credentialId: $credentialId) {
            credentials
            sealedCredentials
          }
        }
        """,
        variables={"credentialId": str(credential.id)},
        context_value=_info(member).context,
    )

    assert result.errors is None, result.errors
    saved = result.data["providerCredential"]
    assert json.loads(saved["credentials"]) == {
        "vault_addr": "https://vault.example.com"
    }
    assert saved["sealedCredentials"] == ["vault_role_id", "vault_secret_id"]
    assert "sentinel" not in json.dumps(result.data)


# --- An update that leaves optional values out ---------------------------------


def test_an_update_that_omits_the_port_and_database_keeps_them(member):
    credential = _credential(
        member,
        "postgres",
        {
            "username": "app",
            "password": "old-password",
            "host": "db.internal.example",
            "port": "6432",
            "database": "analytics",
        },
    )
    before = validate_credential_values("postgres", credential.credentials)

    updated = _update(
        member,
        credential,
        {"username": "app", "password": "new-password", "host": "db.internal.example"},
    )

    stored = get_credentials(updated.id)
    assert stored["password"] == "new-password"
    assert (stored["port"], stored["database"]) == ("6432", "analytics")
    assert validate_credential_values("postgres", updated.credentials) == before


def test_an_update_that_sends_an_optional_value_blank_clears_it(member):
    credential = _credential(
        member,
        "postgres",
        {
            "username": "app",
            "password": "old-password",
            "host": "db.internal.example",
            "port": "6432",
            "database": "analytics",
        },
    )

    updated = _update(
        member,
        credential,
        {
            "username": "app",
            "password": "new-password",
            "host": "db.internal.example",
            "port": "6432",
            "database": "",
        },
    )

    assert get_credentials(updated.id)["database"] == ""
