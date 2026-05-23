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

USERS_URL = "/v1/scim/v2/Users"

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
            "location": f"https://testserver/service/v1/scim/v2/Users/{su.id}",
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

    @patch(f"{_P}.SCIMUser")
    def test_filter_with_unsupported_operator_returns_400(self, MockSCIMUser, scim_client):
        """RFC 7644 §3.4.2.2: unsupported operators must yield 400 invalidFilter,
        not a full unfiltered collection (IdPs make sync decisions on responses)."""
        qs = MagicMock()
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        resp = scim_client.get(USERS_URL, {"filter": 'userName gt "alice"'})
        assert resp.status_code == 400
        body = resp.json()
        assert body["status"] == "400"
        assert body["scimType"] == "invalidFilter"

    @patch(f"{_P}.SCIMUser")
    def test_filter_with_unknown_attribute_returns_400(self, MockSCIMUser, scim_client):
        qs = MagicMock()
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        resp = scim_client.get(USERS_URL, {"filter": 'phoneNumbers.value eq "555"'})
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "invalidFilter"

    @patch(f"{_P}.SCIMUser")
    def test_filter_unparseable_returns_400(self, MockSCIMUser, scim_client):
        qs = MagicMock()
        MockSCIMUser.objects.filter.return_value.order_by.return_value = qs

        resp = scim_client.get(USERS_URL, {"filter": "garbage..."})
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "invalidFilter"


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
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_missing_external_id_synthesizes(
        self, mock_quota, mock_provision, mock_serialize, mock_log, scim_client
    ):
        """externalId is OPTIONAL per RFC 7643 §3.1; missing must not be
        rejected. Synthesize a UUID so behavior matches Groups."""
        scim_user = make_mock_scim_user(email="test@example.com")
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user)

        payload = {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
            "userName": "test@example.com",
        }
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        call_kwargs = mock_provision.call_args[1]
        assert call_kwargs["external_id"]
        assert len(call_kwargs["external_id"]) > 0

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

    @patch("api.tasks.emails.send_scim_provisioned_email_job")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_active_user_with_empty_crypto_sends_setup_email(
        self, mock_quota, mock_provision, mock_serialize, mock_log, mock_email_job, scim_client
    ):
        """Fresh SCIM user (active, empty identity_key) gets the setup email."""
        scim_user = make_mock_scim_user(email="newbie@example.com", active=True)
        scim_user.org_member.identity_key = ""
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user)

        payload = make_scim_user_payload("newbie@example.com", "newbie-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        mock_email_job.assert_called_once_with(scim_user)

    @patch("api.tasks.emails.send_scim_provisioned_email_job")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_inactive_user_does_not_send_email(
        self, mock_quota, mock_provision, mock_deactivate, mock_serialize, mock_log, mock_email_job, scim_client
    ):
        """If the user is provisioned with active=false, skip the setup email
        — they can't sign in anyway until reactivated."""
        scim_user = make_mock_scim_user(email="inactive@example.com", active=False)
        scim_user.org_member.identity_key = ""
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user, active=False)

        payload = make_scim_user_payload("inactive@example.com", "inactive-ext", active=False)
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        mock_email_job.assert_not_called()

    @patch("api.tasks.emails.send_scim_provisioned_email_job")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_create_adopting_keyed_user_skips_email(
        self, mock_quota, mock_provision, mock_serialize, mock_log, mock_email_job, scim_client
    ):
        """If the adopted OM already has crypto material, skip the setup
        email — they don't need to re-do key ceremony. (Defence-in-depth;
        the provisioning guard normally refuses this case altogether.)"""
        scim_user = make_mock_scim_user(email="returning@example.com", active=True)
        scim_user.org_member.identity_key = "existing-key"
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user)

        payload = make_scim_user_payload("returning@example.com", "returning-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        mock_email_job.assert_not_called()

    @patch("api.tasks.emails.send_scim_provisioned_email_job", side_effect=RuntimeError("queue down"))
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.provision_scim_user")
    @patch(f"{_P}.can_add_account", return_value=True)
    def test_email_dispatch_failure_does_not_break_create_response(
        self, mock_quota, mock_provision, mock_serialize, mock_log, mock_email_job, scim_client
    ):
        """A flaky email queue must not turn a successful provision into a 5xx."""
        scim_user = make_mock_scim_user(email="newbie@example.com", active=True)
        scim_user.org_member.identity_key = ""
        mock_provision.return_value = scim_user
        mock_serialize.return_value = _serialized_user(scim_user)

        payload = make_scim_user_payload("newbie@example.com", "newbie-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201

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

    @patch("api.tasks.emails.send_scim_provisioned_email_job")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.reactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_reactivate_via_put_sends_setup_email_when_crypto_is_empty(
        self, MockSCIMUser, mock_reactivate, mock_serialize, mock_log, mock_email_job, scim_client
    ):
        """After SCIM deactivate wipes crypto, the next reactivate leaves the
        OM empty-crypto so the user must redo key ceremony — re-send the
        same setup email they got on initial provision."""
        alice = make_mock_scim_user(email="alice@example.com", active=False)
        alice.org_member.identity_key = ""
        # Real reactivate flips active=True on the model; simulate that side
        # effect so _send_setup_email_if_needed's predicate evaluates correctly.
        def _flip_active(su):
            su.active = True
        mock_reactivate.side_effect = _flip_active
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
        mock_email_job.assert_called_once_with(alice)

    @patch("api.tasks.emails.send_scim_provisioned_email_job")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.reactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_reactivate_via_put_skips_email_when_crypto_present(
        self, MockSCIMUser, mock_reactivate, mock_serialize, mock_log, mock_email_job, scim_client
    ):
        """If the OM somehow still has crypto material, the user doesn't
        need key ceremony — skip the email."""
        alice = make_mock_scim_user(email="alice@example.com", active=False)
        alice.org_member.identity_key = "still-here"
        def _flip_active(su):
            su.active = True
        mock_reactivate.side_effect = _flip_active
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
        mock_email_job.assert_not_called()

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
    def test_put_same_email_is_noop_not_rejected(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """PUT carrying the same email (typical full-resource sync from IdPs)
        must NOT trip the immutability guard — it's a no-op for that field."""
        alice = make_mock_scim_user(email="alice@example.com", display_name="Alice")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice, display_name="Alice Renamed")

        payload = make_scim_user_payload(
            "alice@example.com", "alice-ext-id", display_name="Alice Renamed",
        )
        resp = scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert alice.display_name == "Alice Renamed"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_put_email_change_returns_400_mutability(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """Email is immutable post-creation (device key salt). PUT with a
        different userName must 400 with scimType=mutability."""
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        payload = make_scim_user_payload("alice-new@example.com", "alice-ext-id")
        resp = scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "mutability"
        # Email must remain unchanged
        assert alice.email == "alice@example.com"

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

    @patch("api.tasks.emails.send_scim_provisioned_email_job")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.reactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_reactivate_via_patch_sends_setup_email_when_crypto_is_empty(
        self, MockSCIMUser, mock_reactivate, mock_serialize, mock_log, mock_email_job, scim_client
    ):
        """PATCH active=true path also re-sends the setup email when the
        OM's crypto has been wiped."""
        alice = make_mock_scim_user(email="alice@example.com", active=False)
        alice.org_member.identity_key = ""
        def _flip_active(su):
            su.active = True
        mock_reactivate.side_effect = _flip_active
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
        mock_email_job.assert_called_once_with(alice)

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_username_change_returns_400_mutability(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        payload = make_patch_op([
            {"op": "Replace", "path": "userName", "value": "alice-renamed@example.com"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "mutability"
        assert alice.email == "alice@example.com"

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

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_filtered_email_change_returns_400_mutability(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """Entra's documented mapping (`emails[type eq "work"].value`) goes
        through _set_email and must also reject the change."""
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        payload = make_patch_op([
            {
                "op": "Replace",
                "path": 'emails[type eq "work"].value',
                "value": "alice-new@example.com",
            },
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "mutability"
        assert alice.email == "alice@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_emails_array_change_returns_400_mutability(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """PATCH replacing the whole `emails` array with a different primary
        also flows through _set_email and must reject."""
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        payload = make_patch_op([
            {
                "op": "Replace",
                "path": "emails",
                "value": [
                    {"value": "alice-old@example.com", "type": "home"},
                    {"value": "alice-okta@example.com", "type": "work", "primary": True},
                ],
            },
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "mutability"
        assert alice.email == "alice@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_add_username_change_returns_400_mutability(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """`op=Add path=userName` collapses to Replace (RFC 7644 §3.5.2.1)
        and so hits the immutability guard."""
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        payload = make_patch_op([
            {"op": "Add", "path": "userName", "value": "alice-add@example.com"},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "mutability"
        assert alice.email == "alice@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_valueless_username_change_returns_400_mutability(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """Valueless replace dict containing userName: also rejected."""
        alice = make_mock_scim_user(email="alice@example.com")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception

        payload = make_patch_op([
            {"op": "Replace", "value": {"userName": "alice-vl@example.com"}},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "mutability"
        assert alice.email == "alice@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_valueless_emails_change_returns_400_mutability(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """Valueless replace containing an emails array with a different
        primary: rejected. The displayName co-update is moot in this case
        because the whole request fails."""
        alice = make_mock_scim_user(email="alice@example.com", display_name="Alice T")
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(
            alice, email="alice-multi@example.com", display_name="Alice M"
        )

        payload = make_patch_op([
            {
                "op": "Replace",
                "value": {
                    "displayName": "Alice M",
                    "emails": [
                        {"value": "alice-multi@example.com", "type": "work", "primary": True},
                    ],
                },
            },
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400
        assert resp.json()["scimType"] == "mutability"
        assert alice.email == "alice@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_valueless_replace_name_dict(
        self, MockSCIMUser, mock_serialize, mock_log, scim_client
    ):
        """Valueless replace with a `name` sub-object."""
        alice = make_mock_scim_user(
            email="alice@example.com",
            display_name="Alice Test",
            scim_data={"name": {"givenName": "Alice", "familyName": "Test"}},
        )
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_user(alice)

        payload = make_patch_op([
            {
                "op": "Replace",
                "value": {
                    "name": {"givenName": "Alicia", "familyName": "Wonderland"},
                },
            },
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert alice.scim_data["name"]["givenName"] == "Alicia"
        assert alice.scim_data["name"]["familyName"] == "Wonderland"
        assert alice.display_name == "Alicia Wonderland"


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

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_delete_owner_returns_403_and_logs_error(
        self, MockSCIMUser, mock_deactivate, mock_log, scim_client
    ):
        """An org owner cannot be deprovisioned via SCIM. The view must
        return 403 and write an error entry to the SCIM audit log."""
        from ee.authentication.scim.exceptions import SCIMDeactivationForbidden

        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_deactivate.side_effect = SCIMDeactivationForbidden(
            "Cannot deactivate 'alice@example.com' — they are an organisation owner."
        )

        resp = scim_client.delete(user_url(alice.id))
        assert resp.status_code == 403
        assert resp.json()["status"] == "403"

        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "user_deactivated"
        assert log_call[1]["status"] == "error"
        assert log_call[1]["response_status"] == 403


# ---------------------------------------------------------------------------
# Owner-deactivation guard — covers every SCIM path that triggers deactivate_scim_user
# ---------------------------------------------------------------------------


class TestOwnerDeactivationGuard:
    """Each entry point that can reach deactivate_scim_user (DELETE, PUT
    with active=false, PATCH with active=false) must surface a 403 with
    an audit log entry rather than letting the exception escape as a 500."""

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_put_owner_active_false_returns_403(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        from ee.authentication.scim.exceptions import SCIMDeactivationForbidden

        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_deactivate.side_effect = SCIMDeactivationForbidden("owner")

        payload = make_scim_user_payload(
            "alice@example.com", "alice-ext", active=False,
        )
        resp = scim_client.put(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 403
        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "user_deactivated"
        assert log_call[1]["status"] == "error"
        assert log_call[1]["response_status"] == 403

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_owner_active_false_returns_403(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        from ee.authentication.scim.exceptions import SCIMDeactivationForbidden

        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_deactivate.side_effect = SCIMDeactivationForbidden("owner")

        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": False},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 403
        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "user_deactivated"
        assert log_call[1]["status"] == "error"
        assert log_call[1]["response_status"] == 403

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_user")
    @patch(f"{_P}.deactivate_scim_user")
    @patch(f"{_P}.SCIMUser")
    def test_patch_owner_valueless_active_false_returns_403(
        self, MockSCIMUser, mock_deactivate, mock_serialize, mock_log, scim_client
    ):
        """The Entra-style valueless PATCH path must also trip the guard."""
        from ee.authentication.scim.exceptions import SCIMDeactivationForbidden

        alice = make_mock_scim_user(email="alice@example.com", active=True)
        MockSCIMUser.objects.select_related.return_value.get.return_value = alice
        MockSCIMUser.DoesNotExist = Exception
        mock_deactivate.side_effect = SCIMDeactivationForbidden("owner")

        payload = make_patch_op([
            {"op": "Replace", "value": {"active": False}},
        ])
        resp = scim_client.patch(
            user_url(alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 403


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
        assert "/service/v1/scim/v2/Users/" in location

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
