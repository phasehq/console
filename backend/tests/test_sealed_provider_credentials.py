"""Sealed Integration Credential fields are write-only.

Every declared field that is not non-sensitive is sealed: the console never
receives its value, an update that omits it keeps the stored value, and moving
an endpoint requires re-entering it so an editor cannot point a stored secret
at a server they control.
"""

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
from api.utils.syncing.auth import get_credentials, get_sealed_credential_keys
from backend.graphene.mutations.syncing import UpdateProviderCredentials
from backend.schema import schema


@pytest.fixture
def member(db):
    organisation = Organisation.objects.create(
        name="Sealed credentials", identity_key="00" * 32
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
        username="sealed-editor", email="sealed-editor@example.com"
    )
    return OrganisationMember.objects.create(
        organisation=organisation, user=user, role=role
    )


def _request(member):
    request = RequestFactory().post("/graphql/")
    request.user = member.user
    return request


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
        SimpleNamespace(context=_request(member)),
        credential_id=credential.id,
        expected_revision=credential.revision,
        name=credential.name,
        credentials=_encrypt(values),
    ).credential


def test_console_receives_visible_values_and_only_the_names_of_sealed_ones(member):
    credential = _credential(
        member,
        "aws",
        {
            "access_key_id": "AKIAIOSFODNN7EXAMPLE",
            "secret_access_key": "aws-secret-sentinel",
            "region": "us-east-2",
        },
    )

    result = schema.execute(
        """
        query SavedCredential($credentialId: ID!) {
          providerCredential(credentialId: $credentialId) {
            credentials
            sealedCredentials
          }
        }
        """,
        variables={"credentialId": str(credential.id)},
        context_value=_request(member),
    )

    assert result.errors is None
    saved = result.data["providerCredential"]
    assert json.loads(saved["credentials"]) == {
        "access_key_id": "AKIAIOSFODNN7EXAMPLE",
        "region": "us-east-2",
    }
    assert saved["sealedCredentials"] == ["secret_access_key"]
    assert "aws-secret-sentinel" not in json.dumps(result.data)


def test_update_keeps_an_omitted_sealed_value_and_replaces_a_submitted_one(member):
    credential = _credential(
        member,
        "aws",
        {
            "access_key_id": "AKIAIOSFODNN7EXAMPLE",
            "secret_access_key": "first-secret",
            "region": "us-east-2",
        },
    )
    stored_secret = credential.credentials["secret_access_key"]

    credential = _update(
        member,
        credential,
        {"access_key_id": "AKIAI44QH8DHBEXAMPLE", "region": "eu-west-1"},
    )
    assert credential.credentials["secret_access_key"] == stored_secret
    assert get_credentials(credential.id) == {
        "access_key_id": "AKIAI44QH8DHBEXAMPLE",
        "secret_access_key": "first-secret",
        "region": "eu-west-1",
    }

    credential = _update(
        member,
        credential,
        {
            "access_key_id": "AKIAI44QH8DHBEXAMPLE",
            "secret_access_key": "second-secret",
            "region": "eu-west-1",
        },
    )
    assert get_credentials(credential.id)["secret_access_key"] == "second-secret"


def test_moving_an_endpoint_requires_re_entering_the_sealed_values(member):
    credential = _credential(
        member,
        "postgres",
        {
            "username": "phase",
            "password": "db-password-sentinel",
            "host": "database.internal.example",
            "database": "phase",
        },
    )
    routing = {"username": "phase", "database": "phase"}

    with pytest.raises(GraphQLError, match="Re-enter PASSWORD to change HOST"):
        _update(
            member,
            credential,
            {**routing, "host": "collector.attacker.example"},
        )
    assert get_credentials(credential.id)["host"] == "database.internal.example"

    # Fields that do not decide where the password goes stay editable.
    credential = _update(
        member,
        credential,
        {**routing, "username": "phase_app", "host": "database.internal.example"},
    )
    assert get_credentials(credential.id)["password"] == "db-password-sentinel"

    credential = _update(
        member,
        credential,
        {
            **routing,
            "username": "phase_app",
            "password": "db-password-sentinel",
            "host": "replica.internal.example",
        },
    )
    assert get_credentials(credential.id)["host"] == "replica.internal.example"


def test_an_empty_sealed_value_is_neither_reported_nor_required(member):
    role = "arn:aws:iam::111111111111:role/phase"
    credential = _credential(
        member,
        "aws_assume_role",
        {"role_arn": role, "region": "us-east-1", "external_id": ""},
    )
    assert get_sealed_credential_keys(credential) == []

    other_role = "arn:aws:iam::222222222222:role/phase"
    credential = _update(
        member, credential, {"role_arn": other_role, "region": "us-east-1"}
    )
    assert "external_id" not in get_credentials(credential.id)

    credential = _update(
        member,
        credential,
        {"role_arn": other_role, "region": "us-east-1", "external_id": "generated"},
    )
    assert get_sealed_credential_keys(credential) == ["external_id"]

    credential = _update(
        member, credential, {"role_arn": other_role, "region": "eu-west-1"}
    )
    assert get_credentials(credential.id)["external_id"] == "generated"

    with pytest.raises(GraphQLError, match="Re-enter EXTERNAL ID to change ROLE ARN"):
        _update(member, credential, {"role_arn": role, "region": "eu-west-1"})
