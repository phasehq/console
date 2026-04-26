"""Tests for SCIM /Users endpoints — fully mocked, no database.

Covers: list, filter, create, get, replace (PUT), partial update (PATCH), delete.
"""

import json
import uuid
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from django.db import IntegrityError

from .conftest import (
    SCIM_CONTENT_TYPE,
    make_mock_organisation,
    make_mock_scim_user,
    make_patch_op,
    make_scim_user_payload,
)

USERS_URL = "/scim/v2/Users"

# Patch targets — where names are looked up in views/users.py
_P = "ee.authentication.scim.views.users"


def user_url(scim_user_id):
    return f"{USERS_URL}/{scim_user_id}"


def _serialized_user(scim_user=None, **overrides):
    """Return a fake serialized SCIM user dict for mocking serialize_scim_user."""
    su = scim_user or make_mock_scim_user()
    base = {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "id": str(overrides.get("id", su.id)),
        "externalId": overrides.get("external_id", su.external_id),
        "userName": overrides.get("email", su.email),
        "displayName": overrides.get("display_name", su.display_name),
        "active": overrides.get("active", su.active),
        "emails": [{"value": overrides.get("email", su.email), "type": "work", "primary": True}],
        "name": su.scim_data.get("name", {}),
        "meta": {
            "resourceType": "User",
            "created": "2025-01-01T00:00:00+00:00",
            "lastModified": "2025-01-01T00:00:00+00:00",
            "location": f"https://testserver/service/scim/v2/Users/{su.id}",
        },
    }
    base.update({k: v for k, v in overrides.items() if k not in (
        "id", "external_id", "email", "display_name", "active"
    )})
    return base


# ---------------------------------------------------------------------------
# List / Filter
# ---------------------------------------------------------------------------


class TestListUsers:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_list_empty(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        qs = MagicMock()
        qs.count.return_value = 0
        qs.__getitem__ = MagicMock(return_value=[])
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        resp = scim_client.get(USERS_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalResults"] == 0
        assert data["Resources"] == []

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_list_returns_provisioned_users(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")
        bob = make_mock_scim_user(email="bob@example.com")

        qs = MagicMock()
        qs.count.return_value = 2
        qs.__getitem__ = MagicMock(return_value=[alice, bob])
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        mock_serialize.side_effect = [
            _serialized_user(alice),
            _serialized_user(bob),
        ]

        resp = scim_client.get(USERS_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalResults"] == 2
        assert len(data["Resources"]) == 2

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.scim_filter_to_queryset")
    @patch(f"{_P}.SCIMUser")
    def test_filter_by_username(self, MockSCIMUser, mock_filter_qs, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")

        qs = MagicMock()
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        filtered_qs = MagicMock()
        filtered_qs.count.return_value = 1
        filtered_qs.__getitem__ = MagicMock(return_value=[alice])
        mock_filter_qs.return_value = filtered_qs

        mock_serialize.return_value = _serialized_user(alice)

        resp = scim_client.get(USERS_URL, {"filter": 'userName eq "alice@example.com"'})
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalResults"] == 1

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_list_pagination_count(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")

        qs = MagicMock()
        qs.count.return_value = 2
        qs.__getitem__ = MagicMock(return_value=[alice])
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        mock_serialize.return_value = _serialized_user(alice)

        resp = scim_client.get(USERS_URL, {"startIndex": 1, "count": 1})
        data = resp.json()
        assert data["totalResults"] == 2
        assert data["itemsPerPage"] == 1


# ---------------------------------------------------------------------------
# Create (POST)
# ---------------------------------------------------------------------------


class TestCreateUser:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_new_user(self, mock_quota, mock_provision, mock_serialize, mock_log, scim_client):
        scim_user = make_mock_scim_user(email="carol@example.com", external_id="carol-ext-id")
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user)

        payload = make_scim_user_payload("carol@example.com", "carol-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["userName"] == "carol@example.com"
        mock_provision.assert_called_once()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_user_calls_provision_with_correct_args(
        self, mock_quota, mock_provision, mock_serialize, mock_log, scim_client, mock_organisation
    ):
        scim_user = make_mock_scim_user(email="test@example.com")
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user)

        payload = make_scim_user_payload("test@example.com", "test-ext-id", display_name="Test User")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        call_kwargs = mock_provision.call_args
        assert call_kwargs[1]["email"] == "test@example.com"
        assert call_kwargs[1]["external_id"] == "test-ext-id"
        assert call_kwargs[1]["display_name"] == "Test User"
        assert call_kwargs[1]["scim_data"] == payload

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_duplicate_returns_409(self, mock_quota, mock_provision, mock_log, scim_client):
        mock_provision.side_effect = IntegrityError("duplicate key")

        payload = make_scim_user_payload("dup@example.com", "dup-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 409
        assert "uniqueness" in resp.json().get("scimType", "")

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_missing_username_returns_400(self, mock_quota, mock_log, scim_client):
        payload = {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
            "externalId": "x",
        }
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_missing_external_id_returns_400(self, mock_quota, mock_log, scim_client):
        payload = {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
            "userName": "test@example.com",
        }
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_user_with_active_false(
        self, mock_quota, mock_provision, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        scim_user = make_mock_scim_user(email="inactive@example.com", active=False)
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user, active=False)

        payload = make_scim_user_payload("inactive@example.com", "inactive-ext", active=False)
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        mock_deactivate.assert_called_once_with(scim_user)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_user_logs_event(
        self, mock_quota, mock_provision, mock_serialize, mock_log, scim_client
    ):
        scim_user = make_mock_scim_user(email="logged@example.com")
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user)

        payload = make_scim_user_payload("logged@example.com", "logged-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        mock_log.assert_called()
        # The final log call should have event_type="user_created" and response_status=201
        final_call = mock_log.call_args_list[-1]
        assert final_call[0][1] == "user_created"
        assert final_call[1]["response_status"] == 201

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_user_display_name_from_name_parts(
        self, mock_quota, mock_provision, mock_serialize, mock_log, scim_client
    ):
        """If displayName is missing, _extract_user_fields builds it from name parts."""
        scim_user = make_mock_scim_user(email="nodisp@example.com", display_name="Jane Doe")
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user, display_name="Jane Doe")

        payload = {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
            "externalId": "nodisp-ext",
            "userName": "nodisp@example.com",
            "name": {"givenName": "Jane", "familyName": "Doe"},
            "active": True,
        }
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        call_kwargs = mock_provision.call_args[1]
        assert call_kwargs["display_name"] == "Jane Doe"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_user_email_from_emails_array(
        self, mock_quota, mock_provision, mock_serialize, mock_log, scim_client
    ):
        """If userName is empty, falls back to emails array."""
        scim_user = make_mock_scim_user(email="fallback@example.com")
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user, email="fallback@example.com")

        payload = {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
            "externalId": "emails-ext",
            "userName": "",
            "emails": [{"value": "fallback@example.com", "type": "work", "primary": True}],
            "active": True,
        }
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        call_kwargs = mock_provision.call_args[1]
        assert call_kwargs["email"] == "fallback@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.can_add_account", return_value=False)
    def test_create_user_seat_limit_returns_403(self, mock_quota, mock_log, scim_client):
        payload = make_scim_user_payload("over@example.com", "over-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Get (GET /:id)
# ---------------------------------------------------------------------------


class TestGetUser:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_get_existing_user(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", id="alice-id")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice)

        resp = scim_client.get(user_url("alice-id"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(alice.id)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMUser")
    def test_get_nonexistent_user(self, MockSCIMUser, mock_log, scim_client):
        MockSCIMUser.DoesNotExist = Exception
        MockSCIMUser.objects.select_related.return_value.get.side_effect = Exception("not found")

        resp = scim_client.get(user_url("nonexistent-id"))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Replace (PUT)
# ---------------------------------------------------------------------------


class TestReplaceUser:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_update_display_name_via_put(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", display_name="Alice Test")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, display_name="Alice Updated")

        payload = make_scim_user_payload(
            "alice@example.com", "alice-ext-id",
            display_name="Alice Updated",
        )
        resp = scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["displayName"] == "Alice Updated"
        assert alice.display_name == "Alice Updated"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_deactivate_via_put(self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_scim_user_payload("alice@example.com", "alice-ext-id", active=False)
        resp = scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False
        mock_deactivate.assert_called_once_with(alice)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_deactivate_via_put_logs_correct_event_type(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_scim_user_payload("alice@example.com", "alice-ext-id", active=False)
        scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "user_deactivated"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.reactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_reactivate_via_put(self, MockSCIMUser, mock_reactivate, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", active=False)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=True)

        payload = make_scim_user_payload("alice@example.com", "alice-ext-id", active=True)
        resp = scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is True
        mock_reactivate.assert_called_once_with(alice)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.reactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_reactivate_via_put_logs_correct_event_type(
        self, MockSCIMUser, mock_reactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=False)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=True)

        payload = make_scim_user_payload("alice@example.com", "alice-ext-id", active=True)
        scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "user_reactivated"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_update_email_via_put(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, email="alice-new@example.com")

        payload = make_scim_user_payload("alice-new@example.com", "alice-ext-id")
        resp = scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert alice.email == "alice-new@example.com"
        alice.user.save.assert_called()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMUser")
    def test_put_nonexistent_user_returns_404(self, MockSCIMUser, mock_log, scim_client):
        MockSCIMUser.DoesNotExist = Exception
        MockSCIMUser.objects.select_related.return_value.get.side_effect = Exception("not found")

        payload = make_scim_user_payload("nobody@example.com", "nobody-ext")
        resp = scim_client.put(
            user_url("nonexistent"),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Partial update (PATCH)
# ---------------------------------------------------------------------------


class TestPatchUser:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_deactivate_via_patch_entra_style(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "False"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False
        mock_deactivate.assert_called_once_with(alice)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_deactivate_via_patch_bool_value(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": False},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_deactivate.assert_called_once()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_deactivate_via_patch_valueless_replace(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        """Valueless replace with value as a dict."""
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_patch_op([
            {"op": "Replace", "value": {"active": False}},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_deactivate.assert_called_once()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_deactivate_via_patch_valueless_string_active(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_patch_op([
            {"op": "Replace", "value": {"active": "false"}},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_deactivate.assert_called_once()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.reactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_reactivate_via_patch(
        self, MockSCIMUser, mock_reactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=False)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=True)

        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "True"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is True
        mock_reactivate.assert_called_once_with(alice)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_username(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, email="alice-renamed@example.com")

        payload = make_patch_op([
            {"op": "Replace", "path": "userName", "value": "alice-renamed@example.com"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert alice.email == "alice-renamed@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_display_name(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", display_name="Alice Test")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, display_name="Alice Wonderland")

        payload = make_patch_op([
            {"op": "Replace", "path": "displayName", "value": "Alice Wonderland"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert alice.display_name == "Alice Wonderland"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_name_given_name(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(
            email="alice@example.com",
            scim_data={"name": {"givenName": "Alice", "familyName": "Test"}},
        )
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice)

        payload = make_patch_op([
            {"op": "Replace", "path": "name.givenName", "value": "Alicia"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert "Alicia" in alice.display_name

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_name_family_name(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(
            email="alice@example.com",
            scim_data={"name": {"givenName": "Alice", "familyName": "Test"}},
        )
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice)

        payload = make_patch_op([
            {"op": "Replace", "path": "name.familyName", "value": "Wonderland"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert "Wonderland" in alice.display_name

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_deactivate_logs_correct_event_type(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "False"},
        ])
        scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "user_deactivated"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMUser")
    def test_patch_no_operations_returns_400(self, MockSCIMUser, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        payload = {
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            "Operations": [],
        }
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_entra_multi_op(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, active=False)

        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "False"},
            {"op": "Add", "path": "title", "value": "Engineer"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_deactivate.assert_called_once()


# ---------------------------------------------------------------------------
# Delete (DELETE)
# ---------------------------------------------------------------------------


class TestDeleteUser:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_delete_returns_204(self, MockSCIMUser, mock_deactivate, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        resp = scim_client.delete(user_url(alice.id))
        assert resp.status_code == 204

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_delete_calls_deactivate(self, MockSCIMUser, mock_deactivate, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        scim_client.delete(user_url(alice.id))
        mock_deactivate.assert_called_once_with(alice)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_delete_already_inactive_skips_deactivate(
        self, MockSCIMUser, mock_deactivate, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com", active=False)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        resp = scim_client.delete(user_url(alice.id))
        assert resp.status_code == 204
        mock_deactivate.assert_not_called()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_delete_logs_event(self, MockSCIMUser, mock_deactivate, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        scim_client.delete(user_url(alice.id))
        mock_log.assert_called()
        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "user_deactivated"
        assert log_call[1]["response_status"] == 204

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMUser")
    def test_delete_nonexistent_returns_404(self, MockSCIMUser, mock_log, scim_client):
        MockSCIMUser.DoesNotExist = Exception
        MockSCIMUser.objects.select_related.return_value.get.side_effect = Exception("not found")

        resp = scim_client.delete(user_url("nonexistent-id"))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Response format validation
# ---------------------------------------------------------------------------


class TestUserResponseFormat:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_response_contains_schemas(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice)

        resp = scim_client.get(user_url(alice.id))
        data = resp.json()
        assert "schemas" in data
        assert "urn:ietf:params:scim:schemas:core:2.0:User" in data["schemas"]

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_response_meta_location_format(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice)

        resp = scim_client.get(user_url(alice.id))
        location = resp.json()["meta"]["location"]
        assert "/service/scim/v2/Users/" in location

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_list_response_format(self, MockSCIMUser, mock_serialize, mock_log, scim_client):
        qs = MagicMock()
        qs.count.return_value = 0
        qs.__getitem__ = MagicMock(return_value=[])
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        resp = scim_client.get(USERS_URL)
        data = resp.json()
        assert "urn:ietf:params:scim:api:messages:2.0:ListResponse" in data["schemas"]
        assert "totalResults" in data
        assert "startIndex" in data
        assert "itemsPerPage" in data
        assert "Resources" in data

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMUser")
    def test_error_response_format(self, MockSCIMUser, mock_log, scim_client):
        MockSCIMUser.DoesNotExist = Exception
        MockSCIMUser.objects.select_related.return_value.get.side_effect = Exception("not found")

        resp = scim_client.get(user_url("nonexistent"))
        data = resp.json()
        assert "urn:ietf:params:scim:api:messages:2.0:Error" in data["schemas"]
        assert "status" in data
        assert "detail" in data
