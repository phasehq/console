"""GCP Secret Manager: the credential identity mutations and sync creation."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from django.test import override_settings
from graphql import GraphQLError

from api.utils.crypto import decrypt_asymmetric, encrypt_asymmetric, random_key_pair
from api.utils.syncing.gcp.auth import (
    GCPAuthError,
    generate_workload_identity_key,
    public_jwks,
)
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
    monkeypatch.setattr(mutations, "get_server_keypair", lambda: (pk, sk))
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


def test_generate_key_returns_only_sealed_secrets(monkeypatch, org, server_keys):
    permission = MagicMock(return_value=True)
    monkeypatch.setattr(mutations, "user_has_permission", permission)

    with override_settings(OAUTH_REDIRECT_URI="https://console.phase.dev"):
        result = mutations.GenerateGCPWorkloadIdentityKey.mutate(
            None, _make_info(), organisation_id="org-1"
        )

    key = result.key
    assert permission.call_args.args[1:] == ("create", "IntegrationCredentials", org)
    assert key.issuer == "https://console.phase.dev"
    assert key.subject == f"phase:org:org-1:key:{key.key_id}"
    sealed = key.sealed_credentials
    assert set(sealed) == {"issuer", "subject", "key_id", "private_key", "jwks"}
    assert server_keys.open(sealed["jwks"]) == key.jwks
    assert server_keys.open(sealed["subject"]) == key.subject
    assert server_keys.open(sealed["key_id"]) == key.key_id
    private_key = server_keys.open(sealed["private_key"])
    assert private_key.startswith("-----BEGIN PRIVATE KEY-----")
    # The plaintext key never appears outside the sealed box.
    assert "PRIVATE KEY" not in json.dumps(
        {"issuer": key.issuer, "subject": key.subject, "jwks": key.jwks}
    )
    # The JWKS shown to the user is the public half of the sealed key.
    assert json.loads(key.jwks) == public_jwks(private_key, key.key_id)


# ---- validateGcpWorkloadIdentity -------------------------------------------------


def _sealed_credentials(server_keys, org_id="org-1"):
    with override_settings(OAUTH_REDIRECT_URI="https://console.phase.dev"):
        identity = generate_workload_identity_key(org_id)
    return {
        "workload_identity_provider": server_keys.seal(PROVIDER),
        "issuer": server_keys.seal(identity["issuer"]),
        "subject": server_keys.seal(identity["subject"]),
        "key_id": server_keys.seal(identity["key_id"]),
        "private_key": server_keys.seal(identity["private_key"]),
        "jwks": server_keys.seal(json.dumps(identity["jwks"])),
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
