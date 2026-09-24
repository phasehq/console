"""GCP Secret Manager: the credential identity mutations and sync creation."""

import json
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric, random_key_pair
from api.utils.syncing import auth as syncing_auth
from api.utils.syncing.gcp import auth as gcp_auth
from api.utils.syncing.gcp.auth import (
    GCPAuthError,
    generate_workload_identity_key,
    get_gcp_credentials,
    open_workload_identity,
    public_jwks,
    seal_workload_identity,
)
from backend.graphene import types
from backend.graphene.mutations import syncing as mutations

PROVIDER = "projects/123456789012/locations/global/workloadIdentityPools/phase/providers/phase-console"
GLOBAL_KEY = "projects/kms-proj/locations/global/keyRings/ring/cryptoKeys/key"


def _make_info(user_id="actor-1"):
    info = MagicMock()
    info.context.user.userId = user_id
    return info


@pytest.fixture
def server_keys(monkeypatch):
    pk, sk = random_key_pair()
    for module in (mutations, gcp_auth, syncing_auth):
        monkeypatch.setattr(module, "get_server_keypair", lambda: (pk, sk))
    return SimpleNamespace(
        seal=lambda value: encrypt_asymmetric(value, pk.hex()),
        open=lambda value: decrypt_asymmetric(value, sk.hex(), pk.hex()),
    )


@pytest.fixture
def org(monkeypatch):
    org = MagicMock(id="org-1")
    organisation_model = MagicMock()
    organisation_model.objects.get.return_value = org
    monkeypatch.setattr(mutations, "Organisation", organisation_model)
    return org


# ---- generateGcpWorkloadIdentityKey ---------------------------------------------


def test_generate_key_requires_create_permission(monkeypatch, org):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=False))

    with pytest.raises(GraphQLError, match="permission to create Integration Credentials"):
        mutations.GenerateGCPWorkloadIdentityKey.mutate(None, _make_info(), organisation_id="org-1")


def test_generate_key_returns_the_identity_in_a_sealed_package(monkeypatch, org, server_keys):
    permission = MagicMock(return_value=True)
    monkeypatch.setattr(mutations, "user_has_permission", permission)

    monkeypatch.setenv("ALLOWED_ORIGINS", "https://console.phase.dev")
    result = mutations.GenerateGCPWorkloadIdentityKey.mutate(
        None, _make_info(), organisation_id="org-1"
    )

    key = result.key
    assert permission.call_args.args[1:] == ("create", "IntegrationCredentials", org)
    assert key.issuer == "https://console.phase.dev"
    assert key.subject == f"phase:org:org-1:key:{key.key_id}"
    identity = open_workload_identity(key.sealed_identity, "org-1")
    assert identity["issuer"] == key.issuer
    assert identity["subject"] == key.subject
    assert identity["key_id"] == key.key_id
    assert identity["jwks"] == key.jwks
    assert identity["private_key"].startswith("-----BEGIN PRIVATE KEY-----")
    # The plaintext key never appears outside the package.
    assert "PRIVATE KEY" not in json.dumps(
        {"issuer": key.issuer, "subject": key.subject, "jwks": key.jwks, "package": key.sealed_identity}
    )
    # The JWKS shown to the user is the public half of the packaged key.
    assert json.loads(key.jwks) == public_jwks(identity["private_key"], key.key_id)


# ---- validateGcpWorkloadIdentity -------------------------------------------------


def _identity(org_id="org-1"):
    with patch.dict(os.environ, {"ALLOWED_ORIGINS": "https://console.phase.dev"}):
        identity = generate_workload_identity_key(org_id)
    return {**identity, "jwks": json.dumps(identity["jwks"])}


def _sealed_credentials(server_keys, org_id="org-1", identity=None):
    """What the browser sends: the package generate returned, and the provider."""
    return {
        "sealed_identity": seal_workload_identity(org_id, identity or _identity(org_id)),
        "workload_identity_provider": server_keys.seal(PROVIDER),
    }


def _client_made_credentials(server_keys, org_id="org-1"):
    """Every field of an identity made outside Phase, each sealed to the
    server's public key, which any signed-in user can fetch."""
    identity = _identity(org_id)
    return {
        "workload_identity_provider": server_keys.seal(PROVIDER),
        **{field: server_keys.seal(value) for field, value in identity.items()},
    }


def test_validate_passes_decrypted_values_to_the_exchange(monkeypatch, org, server_keys):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    exchange = MagicMock(return_value=("token", 0))
    monkeypatch.setattr(mutations, "exchange_token", exchange)

    result = mutations.ValidateGCPWorkloadIdentity.mutate(
        None, _make_info(), organisation_id="org-1", credentials=_sealed_credentials(server_keys)
    )

    assert result.valid is True
    assert result.error is None
    (decrypted,) = exchange.call_args.args
    assert decrypted["workload_identity_provider"] == PROVIDER
    assert decrypted["subject"].startswith("phase:org:org-1:key:")
    # The user is waiting on it: one quick try, not the background retries.
    assert exchange.call_args.kwargs == {"interactive": True}


def test_validate_refuses_an_identity_made_outside_phase(monkeypatch, org, server_keys):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    exchange = MagicMock()
    monkeypatch.setattr(mutations, "exchange_token", exchange)

    result = mutations.ValidateGCPWorkloadIdentity.mutate(
        None,
        _make_info(),
        organisation_id="org-1",
        credentials=_client_made_credentials(server_keys),
    )

    assert result.valid is False
    assert "wasn't created by this Phase instance" in result.error
    exchange.assert_not_called()


def test_validate_rejects_an_identity_minted_for_another_org(monkeypatch, org, server_keys):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    exchange = MagicMock()
    monkeypatch.setattr(mutations, "exchange_token", exchange)

    result = mutations.ValidateGCPWorkloadIdentity.mutate(
        None,
        _make_info(),
        organisation_id="org-1",
        credentials=_sealed_credentials(server_keys, org_id="org-2"),
    )

    assert result.valid is False
    assert "different organisation" in result.error
    exchange.assert_not_called()


def test_validate_reports_google_rejections(monkeypatch, org, server_keys):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations, "exchange_token", MagicMock(side_effect=GCPAuthError("Invalid JWT signature."))
    )

    result = mutations.ValidateGCPWorkloadIdentity.mutate(
        None, _make_info(), organisation_id="org-1", credentials=_sealed_credentials(server_keys)
    )

    assert result.valid is False
    assert result.error == "Invalid JWT signature."


def test_validate_rejects_unreadable_values(monkeypatch, org, server_keys):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    exchange = MagicMock()
    monkeypatch.setattr(mutations, "exchange_token", exchange)

    result = mutations.ValidateGCPWorkloadIdentity.mutate(
        None, _make_info(), organisation_id="org-1", credentials={"issuer": "not-ciphertext"}
    )

    assert result.valid is False
    exchange.assert_not_called()


def test_validate_accepts_update_permission(monkeypatch, org, server_keys):
    monkeypatch.setattr(
        mutations,
        "user_has_permission",
        MagicMock(side_effect=lambda user, action, *args: action == "update"),
    )
    monkeypatch.setattr(mutations, "exchange_token", MagicMock(return_value=("t", 0)))

    result = mutations.ValidateGCPWorkloadIdentity.mutate(
        None, _make_info(), organisation_id="org-1", credentials=_sealed_credentials(server_keys)
    )

    assert result.valid is True


def test_validate_requires_credential_permissions(monkeypatch, org):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=False))

    with pytest.raises(GraphQLError, match="permission to validate"):
        mutations.ValidateGCPWorkloadIdentity.mutate(
            None, _make_info(), organisation_id="org-1", credentials={}
        )


# ---- createGcpSecretManagerSync ----------------------------------------------------


def _patch_create(monkeypatch, *, provider="gcp", existing=(), env_access=True, permission=True):
    org = MagicMock(id="org-1")
    env = MagicMock(id="env-1")
    env.app.id = "app-1"
    env.app.organisation = org
    env.app.sse_enabled = True
    env_model = MagicMock()
    env_model.objects.get.return_value = env
    monkeypatch.setattr(mutations, "Environment", env_model)

    credential = MagicMock(id="cred-1", organisation=org, provider=provider)
    creds_model = MagicMock()
    creds_model.objects.get.return_value = credential
    monkeypatch.setattr(mutations, "ProviderCredentials", creds_model)

    sync_model = MagicMock()
    sync_model.objects.filter.return_value = [SimpleNamespace(options=o) for o in existing]
    monkeypatch.setattr(mutations, "EnvironmentSync", sync_model)

    monkeypatch.setattr(mutations, "user_can_access_app", MagicMock(return_value=True))
    monkeypatch.setattr(
        mutations, "user_can_access_environment", MagicMock(return_value=env_access)
    )
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=permission))
    trigger = MagicMock()
    monkeypatch.setattr(mutations, "trigger_sync_tasks", trigger)
    return SimpleNamespace(env=env, env_model=env_model, sync_model=sync_model, trigger=trigger)


def _create(**overrides):
    kwargs = {
        "env_id": "env-1",
        "path": "/",
        "credential_id": "cred-1",
        "project_id": "my-project",
        "location": "global",
        "sync_mode": "individual",
        "prefix": "",
    }
    kwargs.update(overrides)
    return mutations.CreateGCPSecretManagerSync.mutate(None, _make_info(), **kwargs)


def test_create_individual_sync(monkeypatch):
    mocks = _patch_create(monkeypatch)

    _create(prefix="PROD_", kms_key_name=GLOBAL_KEY)

    create_kwargs = mocks.sync_model.objects.create.call_args.kwargs
    assert create_kwargs["service"] == "gcp_secret_manager"
    assert create_kwargs["options"] == {
        "project_id": "my-project",
        "location": "global",
        "sync_mode": "individual",
        "prefix": "PROD_",
        "kms_key_name": GLOBAL_KEY,
    }
    assert create_kwargs["authentication_id"] == "cred-1"
    mocks.trigger.assert_called_once()
    filter_kwargs = mocks.sync_model.objects.filter.call_args.kwargs
    assert filter_kwargs["environment__app__organisation"] == mocks.env.app.organisation


def test_create_blob_sync_in_a_region(monkeypatch):
    mocks = _patch_create(monkeypatch)

    _create(sync_mode="blob", secret_name="app-prod", location="europe-west4", prefix=None)

    assert mocks.sync_model.objects.create.call_args.kwargs["options"] == {
        "project_id": "my-project",
        "location": "europe-west4",
        "sync_mode": "blob",
        "secret_name": "app-prod",
    }


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"sync_mode": "all"}, "Invalid sync mode"),
        ({"location": "us-central1.evil.example"}, "Secret Manager region"),
        ({"project_id": "Bad Project"}, "project ID"),
        ({"kms_key_name": GLOBAL_KEY, "location": "us-central1"}, "not a global key"),
        ({"sync_mode": "blob", "secret_name": None}, "Secret names may only contain"),
        ({"prefix": "PROD."}, "prefix may only contain"),
    ],
)
def test_invalid_input_is_rejected_before_any_lookup(monkeypatch, overrides, message):
    mocks = _patch_create(monkeypatch)

    with pytest.raises(GraphQLError, match=message):
        _create(**overrides)

    mocks.env_model.objects.get.assert_not_called()


def test_non_gcp_credentials_are_rejected(monkeypatch):
    mocks = _patch_create(monkeypatch, provider="aws")

    with pytest.raises(GraphQLError, match="can't be used with GCP Secret Manager"):
        _create()

    mocks.sync_model.objects.create.assert_not_called()


def test_an_existing_sync_to_the_same_secrets_is_rejected(monkeypatch):
    existing = [
        {"project_id": "my-project", "location": "global", "sync_mode": "individual", "prefix": "PROD_"}
    ]
    mocks = _patch_create(monkeypatch, existing=existing)

    with pytest.raises(GraphQLError, match="already writes to these secrets"):
        _create(prefix="PROD_")

    mocks.sync_model.objects.create.assert_not_called()


def test_a_different_prefix_in_the_same_project_is_allowed(monkeypatch):
    existing = [
        {"project_id": "my-project", "location": "global", "sync_mode": "individual", "prefix": "PROD_"}
    ]
    mocks = _patch_create(monkeypatch, existing=existing)

    _create(prefix="STAGING_")

    mocks.sync_model.objects.create.assert_called_once()


def test_create_requires_environment_access(monkeypatch):
    mocks = _patch_create(monkeypatch, env_access=False)

    with pytest.raises(GraphQLError, match="access to this environment"):
        _create()

    mocks.sync_model.objects.create.assert_not_called()


def test_create_requires_integrations_permission(monkeypatch):
    mocks = _patch_create(monkeypatch, permission=False)

    with pytest.raises(GraphQLError, match="permission to create Integrations"):
        _create()

    mocks.sync_model.objects.create.assert_not_called()


# ---- saving and editing a Google Cloud credential ---------------------------------


def _patch_credentials(monkeypatch, stored=None):
    monkeypatch.setattr(mutations, "user_has_permission", MagicMock(return_value=True))
    credential = MagicMock(
        provider="gcp", organisation_id="org-1", credentials=stored, save=MagicMock()
    )
    model = MagicMock()
    model.objects.get.return_value = credential
    model.objects.create.side_effect = lambda **kwargs: SimpleNamespace(**kwargs)
    monkeypatch.setattr(mutations, "ProviderCredentials", model)
    return SimpleNamespace(credential=credential, model=model)


def _opened(server_keys, credentials):
    return {field: server_keys.open(value) for field, value in credentials.items()}


def test_a_new_credential_stores_the_identity_phase_made(monkeypatch, org, server_keys):
    _patch_credentials(monkeypatch)
    identity = _identity()

    result = mutations.CreateProviderCredentials.mutate(
        None,
        _make_info(),
        org_id="org-1",
        provider="gcp",
        name="Google Cloud credentials",
        credentials=_sealed_credentials(server_keys, identity=identity),
    )

    stored = result.credential.credentials
    assert "sealed_identity" not in stored
    assert _opened(server_keys, stored) == {"workload_identity_provider": PROVIDER, **identity}


@pytest.mark.parametrize(
    ("make_credentials", "message"),
    [
        (lambda keys: _client_made_credentials(keys), "wasn't created by this Phase instance"),
        (lambda keys: _sealed_credentials(keys, org_id="org-2"), "different organisation"),
    ],
)
def test_a_new_credential_refuses_any_other_identity(
    monkeypatch, org, server_keys, make_credentials, message
):
    mocks = _patch_credentials(monkeypatch)

    with pytest.raises(GraphQLError, match=message):
        mutations.CreateProviderCredentials.mutate(
            None,
            _make_info(),
            org_id="org-1",
            provider="gcp",
            name="Google Cloud credentials",
            credentials=make_credentials(server_keys),
        )

    mocks.model.objects.create.assert_not_called()


def test_editing_a_credential_changes_only_the_provider_name(monkeypatch, org, server_keys):
    identity = _identity()
    stored = {
        "workload_identity_provider": server_keys.seal(PROVIDER),
        **{field: server_keys.seal(value) for field, value in identity.items()},
    }
    mocks = _patch_credentials(monkeypatch, stored=stored)
    moved = PROVIDER.replace("123456789012", "999999999999")
    # An editor tries to swap in a key they hold, along with the new provider.
    request = {
        **_client_made_credentials(server_keys),
        "workload_identity_provider": server_keys.seal(moved),
    }

    mutations.UpdateProviderCredentials.mutate(
        None, _make_info(), credential_id="cred-1", name="Renamed", credentials=request
    )

    saved = _opened(server_keys, mocks.credential.credentials)
    assert saved == {**identity, "workload_identity_provider": moved}
    assert mocks.credential.name == "Renamed"
    mocks.credential.save.assert_called_once()


def test_credential_reads_leave_out_the_private_key(monkeypatch, server_keys):
    identity = _identity()
    credential = SimpleNamespace(
        id="cred-1",
        provider="gcp",
        organisation=MagicMock(),
        credentials={
            "workload_identity_provider": server_keys.seal(PROVIDER),
            **{field: server_keys.seal(value) for field, value in identity.items()},
        },
    )
    monkeypatch.setattr(types, "user_has_permission", MagicMock(return_value=True))

    read = types.ProviderCredentialsType.resolve_credentials(credential, _make_info())

    assert "private_key" not in read
    assert read == {
        "workload_identity_provider": PROVIDER,
        "issuer": identity["issuer"],
        "subject": identity["subject"],
        "key_id": identity["key_id"],
        "jwks": identity["jwks"],
    }


def test_credential_reads_of_providers_without_the_list_are_unchanged(monkeypatch):
    credential = SimpleNamespace(id="cred-1", provider="aws", organisation=MagicMock(), credentials={})
    monkeypatch.setattr(types, "user_has_permission", MagicMock(return_value=True))
    every_value = {"access_key_id": "AKIA", "secret_access_key": "secret", "region": "eu-west-1"}
    monkeypatch.setattr(types, "get_credentials", MagicMock(return_value=every_value))

    assert types.ProviderCredentialsType.resolve_credentials(credential, _make_info()) == every_value


def test_the_sync_reads_the_signing_identity_from_the_stored_credentials(server_keys):
    identity = _identity()
    credential = SimpleNamespace(
        credentials={
            "workload_identity_provider": server_keys.seal(PROVIDER),
            **{field: server_keys.seal(value) for field, value in identity.items()},
        }
    )

    assert get_gcp_credentials(credential) == {
        "workload_identity_provider": PROVIDER,
        "issuer": identity["issuer"],
        "subject": identity["subject"],
        "key_id": identity["key_id"],
        "private_key": identity["private_key"],
    }

