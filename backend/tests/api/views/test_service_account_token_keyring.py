import json
import uuid
from unittest.mock import Mock, MagicMock, patch

import pytest
from nacl.bindings import (
    crypto_kx_seed_keypair,
    crypto_sign_ed25519_pk_to_curve25519,
    crypto_sign_keypair,
)
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from api.utils.crypto import encrypt_asymmetric
from api.views.service_accounts import PublicServiceAccountTokensView, _mint_sa_token

VIEW = "api.views.service_accounts"
SA_UTILS = "api.utils.service_accounts"
ERROR = "Invalid service account keyring"
SERVER_PK, SERVER_SK = crypto_kx_seed_keypair(b"\x01" * 32)


# ────────────────────────────────────────────────────────────────────
# Request helpers mirrored from test_service_accounts_api.py
# ────────────────────────────────────────────────────────────────────


def _make_org(plan="PR", org_id=None):
    org = Mock()
    org.id = org_id or uuid.uuid4()
    org.plan = plan
    org.organisation_id = org.id
    return org


def _make_role(name="Service", role_id=None, org=None, is_default=True, global_access=False):
    role = Mock()
    role.id = role_id or uuid.uuid4()
    role.name = name
    role.is_default = is_default
    role.managed_key = name.lower() if is_default else None
    role.organisation = org
    role.permissions = {
        "global_access": global_access,
    }
    return role


def _make_user():
    user = Mock()
    user.userId = uuid.uuid4()
    user.id = user.userId
    user.is_authenticated = True
    user.is_active = True
    return user


def _make_org_member(org=None, role_name="Owner"):
    member = Mock()
    member.id = uuid.uuid4()
    member.user = _make_user()
    member.organisation = org or _make_org()
    member.deleted_at = None
    member.role = Mock()
    member.role.name = role_name
    member.role.is_default = True
    member.role.managed_key = role_name.lower()
    member.apps = Mock()
    return member


def _make_service_account(org=None, name="test-sa", sa_id=None, role=None):
    sa = Mock()
    sa.id = sa_id or str(uuid.uuid4())
    sa.name = name
    sa.organisation = org or _make_org()
    sa.organisation_id = sa.organisation.id
    sa.role = role or _make_role(org=sa.organisation)
    sa.identity_key = "aa" * 32
    sa.server_wrapped_keyring = "ph:v1:keyring"
    sa.server_wrapped_recovery = "ph:v1:recovery"
    sa.deleted_at = None
    sa.created_at = "2024-01-01T00:00:00Z"
    sa.updated_at = "2024-01-01T00:00:00Z"
    sa.apps = MagicMock()
    sa.serviceaccounttoken_set = MagicMock()
    sa.save = Mock()
    sa.delete = Mock()
    sa.team = None
    return sa


def _make_auth_org_only(org, auth_type="User", org_member=None, service_account=None):
    return {
        "token": "Bearer User test_token",
        "auth_type": auth_type,
        "app": None,
        "environment": None,
        "org_member": org_member,
        "service_token": None,
        "service_account": service_account,
        "service_account_token": None,
        "organisation": org,
        "org_only": True,
    }


def _build_list_request(method, url, org, data=None, auth_type="User", role_name="Owner"):
    factory = APIRequestFactory()
    if method == "get":
        request = factory.get(url)
    elif method == "post":
        request = factory.post(url, data=data, format="json")
    else:
        raise ValueError(f"Unknown method: {method}")

    org_member = _make_org_member(org=org, role_name=role_name)

    sa = None
    if auth_type == "ServiceAccount":
        sa = _make_service_account(org=org)

    auth = _make_auth_org_only(
        org,
        auth_type=auth_type,
        org_member=org_member if auth_type == "User" else None,
        service_account=sa,
    )

    force_authenticate(request, user=org_member.user, token=auth)
    return request


# ────────────────────────────────────────────────────────────────────
# Keyring helpers
# ────────────────────────────────────────────────────────────────────


def _keyring():
    """Real Ed25519 keyring in the stored JSON shape."""
    public_key, private_key = crypto_sign_keypair()
    return {"publicKey": public_key.hex(), "privateKey": private_key.hex()}


def _kx_public(keyring):
    return crypto_sign_ed25519_pk_to_curve25519(
        bytes.fromhex(keyring["publicKey"])
    ).hex()


def _wrap(keyring):
    return encrypt_asymmetric(json.dumps(keyring), SERVER_PK.hex())


def _minted_token():
    token = Mock()
    token.id = uuid.uuid4()
    token.name = "t"
    token.created_at = "2026-01-01T00:00:00Z"
    token.expires_at = None
    return token


class TestServiceAccountTokenKeyringBinding:
    """Minting from a stored SSK keyring must refuse a keyring that is not
    the SA's own, even though the caller passed every permission check."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.org = _make_org()
        self.post_view = PublicServiceAccountTokensView.as_view()
        with patch(
            f"{SA_UTILS}.get_server_keypair", return_value=(SERVER_PK, SERVER_SK)
        ):
            yield

    def _wire_target_sa(self, mock_sa_model, stored_keyring, identity_key):
        sa = _make_service_account(org=self.org, name="target-sa")
        sa.identity_key = identity_key
        sa.server_wrapped_keyring = _wrap(stored_keyring)
        mock_sa_model.objects.get.return_value = sa
        return sa

    def _post(self, sa_id, data):
        return _build_list_request(
            "post", f"/public/v1/service-accounts/{sa_id}/tokens/", self.org,
            data=data,
        )

    @patch(f"{VIEW}.log_audit_event")
    @patch(f"{VIEW}.ServiceAccountToken")
    @patch(f"{VIEW}._caller_can_manage_sa_tokens", return_value=True)
    @patch(f"{VIEW}.ServiceAccount")
    @patch(f"{VIEW}.user_has_permission", return_value=True)
    @patch(f"{VIEW}.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch(f"{VIEW}.IsIPAllowed.has_permission", return_value=True)
    def test_mint_refuses_stored_keyring_of_another_sa(
        self, _ip, _throttle, _perm, mock_sa_model, _scope, mock_token_model, _audit
    ):
        sa = self._wire_target_sa(
            mock_sa_model, stored_keyring=_keyring(), identity_key=_keyring()["publicKey"]
        )

        response = self.post_view(self._post(sa.id, {"name": "t"}), sa_id=str(sa.id))

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.data["error"] == ERROR
        mock_token_model.objects.create.assert_not_called()
        _audit.assert_not_called()

    @patch(f"{VIEW}.log_audit_event")
    @patch(f"{VIEW}.ServiceAccountToken")
    @patch(f"{VIEW}._caller_can_manage_sa_tokens", return_value=True)
    @patch(f"{VIEW}.ServiceAccount")
    @patch(f"{VIEW}.user_has_permission", return_value=True)
    @patch(f"{VIEW}.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch(f"{VIEW}.IsIPAllowed.has_permission", return_value=True)
    def test_mint_refuses_stored_keyring_with_swapped_private_key(
        self, _ip, _throttle, _perm, mock_sa_model, _scope, mock_token_model, _audit
    ):
        own, foreign = _keyring(), _keyring()
        planted = {"publicKey": own["publicKey"], "privateKey": foreign["privateKey"]}
        sa = self._wire_target_sa(
            mock_sa_model, stored_keyring=planted, identity_key=own["publicKey"]
        )

        response = self.post_view(self._post(sa.id, {"name": "t"}), sa_id=str(sa.id))

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert response.data["error"] == ERROR
        mock_token_model.objects.create.assert_not_called()

    @patch(f"{VIEW}.log_audit_event")
    @patch(f"{VIEW}.ServiceAccountToken")
    @patch(f"{VIEW}._caller_can_manage_sa_tokens", return_value=True)
    @patch(f"{VIEW}.ServiceAccount")
    @patch(f"{VIEW}.user_has_permission", return_value=True)
    @patch(f"{VIEW}.PlanBasedRateThrottle.allow_request", return_value=True)
    @patch(f"{VIEW}.IsIPAllowed.has_permission", return_value=True)
    def test_mint_accepts_stored_keyring_of_the_sa(
        self, _ip, _throttle, _perm, mock_sa_model, _scope, mock_token_model, _audit
    ):
        keyring = _keyring()
        sa = self._wire_target_sa(
            mock_sa_model, stored_keyring=keyring, identity_key=keyring["publicKey"]
        )
        mock_token_model.objects.create.return_value = _minted_token()

        response = self.post_view(self._post(sa.id, {"name": "t"}), sa_id=str(sa.id))

        assert response.status_code == status.HTTP_201_CREATED
        created = mock_token_model.objects.create.call_args.kwargs
        assert created["identity_key"] == _kx_public(keyring)
        assert response.data["token"].split(":")[3] == _kx_public(keyring)

    @patch(f"{VIEW}.ServiceAccountToken")
    def test_mint_sa_token_raises_on_keyring_mismatch(self, mock_token_model):
        sa = _make_service_account(org=self.org)
        sa.identity_key = _keyring()["publicKey"]
        sa.server_wrapped_keyring = _wrap(_keyring())

        with pytest.raises(ValueError, match=ERROR):
            _mint_sa_token(
                sa, name="t", expires_at=None, created_by=None, created_by_sa=None
            )

        mock_token_model.objects.create.assert_not_called()

    @patch(f"{VIEW}.ServiceAccountToken")
    def test_mint_sa_token_raises_on_corrupt_keyring(self, mock_token_model):
        sa = _make_service_account(org=self.org)
        sa.server_wrapped_keyring = "ph:v1:zz:zz"

        with pytest.raises(ValueError, match=ERROR):
            _mint_sa_token(
                sa, name="t", expires_at=None, created_by=None, created_by_sa=None
            )

        mock_token_model.objects.create.assert_not_called()
