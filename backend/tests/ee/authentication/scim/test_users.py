"""Integration tests for SCIM /Users endpoints.

Covers: list, filter, create, get, replace (PUT), partial update (PATCH), delete.
Tests both Entra ID and Okta payload formats where they diverge.
"""

import json

import pytest

from api.models import (
    CustomUser,
    OrganisationMember,
    SCIMEvent,
    SCIMUser,
    TeamMembership,
)

from .conftest import (
    SCIM_CONTENT_TYPE,
    make_patch_op,
    make_scim_user_payload,
)

USERS_URL = "/scim/v2/Users"


def user_url(scim_user_id):
    return f"{USERS_URL}/{scim_user_id}"


# ---------------------------------------------------------------------------
# List / Filter
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestListUsers:

    def test_list_empty(self, scim_client, scim_token):
        resp = scim_client.get(USERS_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalResults"] == 0
        assert data["Resources"] == []

    def test_list_returns_provisioned_users(self, scim_client, scim_user_alice, scim_user_bob):
        resp = scim_client.get(USERS_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalResults"] == 2
        emails = {r["userName"] for r in data["Resources"]}
        assert emails == {"alice@example.com", "bob@example.com"}

    def test_list_pagination_count(self, scim_client, scim_user_alice, scim_user_bob):
        """count parameter limits the number of returned resources."""
        resp = scim_client.get(USERS_URL, {"startIndex": 1, "count": 1})
        data = resp.json()
        assert data["totalResults"] == 2
        assert len(data["Resources"]) == 1
        assert data["startIndex"] == 1
        assert data["itemsPerPage"] == 1

    def test_filter_by_username(self, scim_client, scim_user_alice, scim_user_bob):
        resp = scim_client.get(
            USERS_URL, {"filter": 'userName eq "alice@example.com"'}
        )
        data = resp.json()
        assert data["totalResults"] == 1
        assert data["Resources"][0]["userName"] == "alice@example.com"

    def test_filter_by_external_id(self, scim_client, scim_user_alice):
        resp = scim_client.get(
            USERS_URL, {"filter": 'externalId eq "alice-ext-id"'}
        )
        data = resp.json()
        assert data["totalResults"] == 1
        assert data["Resources"][0]["externalId"] == "alice-ext-id"

    def test_filter_case_insensitive_email(self, scim_client, scim_user_alice):
        resp = scim_client.get(
            USERS_URL, {"filter": 'userName eq "ALICE@EXAMPLE.COM"'}
        )
        data = resp.json()
        assert data["totalResults"] == 1

    def test_filter_no_match(self, scim_client, scim_user_alice):
        resp = scim_client.get(
            USERS_URL, {"filter": 'userName eq "nobody@example.com"'}
        )
        data = resp.json()
        assert data["totalResults"] == 0


# ---------------------------------------------------------------------------
# Create (POST)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCreateUser:

    def test_create_new_user(self, scim_client, scim_token, developer_role):
        payload = make_scim_user_payload("carol@example.com", "carol-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        data = resp.json()

        assert data["userName"] == "carol@example.com"
        assert data["externalId"] == "carol-ext-id"
        assert data["active"] is True
        assert "meta" in data
        assert "/scim/v2/Users/" in data["meta"]["location"]

        # Verify DB state
        scim_user = SCIMUser.objects.get(id=data["id"])
        assert scim_user.email == "carol@example.com"
        assert scim_user.active is True
        assert scim_user.user is not None
        assert scim_user.org_member is not None
        assert scim_user.org_member.deleted_at is None

    def test_create_user_links_existing_custom_user(
        self, scim_client, scim_token, developer_role, db
    ):
        """If a CustomUser with the same email already exists, link to it."""
        existing = CustomUser.objects.create(
            username="existing@example.com", email="existing@example.com"
        )
        payload = make_scim_user_payload("existing@example.com", "existing-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        scim_user = SCIMUser.objects.get(id=resp.json()["id"])
        assert str(scim_user.user.userId) == str(existing.userId)

    def test_create_user_no_identity_key(self, scim_client, scim_token, developer_role):
        """SCIM-provisioned users should have empty identity_key (pending setup)."""
        payload = make_scim_user_payload("pending@example.com", "pending-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_user = SCIMUser.objects.get(id=resp.json()["id"])
        assert scim_user.org_member.identity_key == ""

    def test_create_user_default_developer_role(
        self, scim_client, scim_token, developer_role
    ):
        payload = make_scim_user_payload("dev@example.com", "dev-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_user = SCIMUser.objects.get(id=resp.json()["id"])
        assert scim_user.org_member.role.name == "Developer"

    def test_create_duplicate_external_id_returns_409(
        self, scim_client, scim_user_alice
    ):
        payload = make_scim_user_payload("different@example.com", "alice-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 409
        assert "uniqueness" in resp.json().get("scimType", "")

    def test_create_duplicate_email_returns_409(self, scim_client, scim_user_alice):
        payload = make_scim_user_payload("alice@example.com", "new-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 409

    def test_create_missing_username_returns_400(self, scim_client, scim_token):
        payload = {"schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"], "externalId": "x"}
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400

    def test_create_missing_external_id_returns_400(self, scim_client, scim_token):
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

    def test_create_user_with_active_false(
        self, scim_client, scim_token, developer_role
    ):
        """Creating a user with active=false should provision then immediately deactivate."""
        payload = make_scim_user_payload(
            "inactive@example.com", "inactive-ext-id", active=False
        )
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        scim_user = SCIMUser.objects.get(id=resp.json()["id"])
        assert scim_user.active is False
        assert scim_user.org_member.deleted_at is not None

    def test_create_user_logs_event(self, scim_client, scim_token, developer_role):
        payload = make_scim_user_payload("logged@example.com", "logged-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        event = SCIMEvent.objects.filter(event_type="user_created", status="success").first()
        assert event is not None
        assert event.resource_name == "logged@example.com"
        assert event.response_status == 201

    @pytest.mark.django_db(transaction=True)
    def test_create_duplicate_logs_error_event(self, scim_client, scim_user_alice):
        payload = make_scim_user_payload("alice@example.com", "alice-ext-id")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 409
        event = SCIMEvent.objects.filter(event_type="user_created", status="error").first()
        assert event is not None
        assert event.response_status == 409

    def test_create_user_display_name_from_name_parts(
        self, scim_client, scim_token, developer_role
    ):
        """If displayName is missing, build it from givenName + familyName."""
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
        assert resp.json()["displayName"] == "Jane Doe"

    def test_create_user_email_from_emails_array(
        self, scim_client, scim_token, developer_role
    ):
        """If userName is empty, fall back to emails array."""
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
        assert resp.json()["userName"] == "fallback@example.com"


# ---------------------------------------------------------------------------
# Get (GET /:id)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGetUser:

    def test_get_existing_user(self, scim_client, scim_user_alice):
        resp = scim_client.get(user_url(scim_user_alice.id))
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == str(scim_user_alice.id)
        assert data["userName"] == "alice@example.com"
        assert data["active"] is True
        assert "/scim/v2/Users/" in data["meta"]["location"]

    def test_get_nonexistent_user(self, scim_client, scim_token):
        resp = scim_client.get(user_url("nonexistent-id"))
        assert resp.status_code == 404

    def test_get_user_includes_name(self, scim_client, scim_user_alice):
        resp = scim_client.get(user_url(scim_user_alice.id))
        data = resp.json()
        assert "name" in data
        assert data["name"]["givenName"] == "Alice"

    def test_get_user_includes_emails(self, scim_client, scim_user_alice):
        resp = scim_client.get(user_url(scim_user_alice.id))
        data = resp.json()
        assert len(data["emails"]) == 1
        assert data["emails"][0]["value"] == "alice@example.com"
        assert data["emails"][0]["primary"] is True


# ---------------------------------------------------------------------------
# Replace (PUT — Okta's primary method)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReplaceUser:

    def test_update_display_name_via_put(self, scim_client, scim_user_alice):
        payload = make_scim_user_payload(
            "alice@example.com",
            "alice-ext-id",
            display_name="Alice Updated",
            given_name="Alice",
            family_name="Updated",
        )
        resp = scim_client.put(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["displayName"] == "Alice Updated"

        scim_user_alice.refresh_from_db()
        assert scim_user_alice.display_name == "Alice Updated"

    def test_deactivate_via_put_okta_style(self, scim_client, scim_user_alice):
        """Okta sends PUT with active:false to deactivate users."""
        payload = make_scim_user_payload(
            "alice@example.com", "alice-ext-id", active=False
        )
        resp = scim_client.put(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False

        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is False
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is not None

    def test_deactivate_via_put_logs_correct_event_type(
        self, scim_client, scim_user_alice
    ):
        """PUT deactivation must log 'user_deactivated', not 'user_updated'."""
        payload = make_scim_user_payload(
            "alice@example.com", "alice-ext-id", active=False
        )
        scim_client.put(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        event = SCIMEvent.objects.filter(
            resource_id=str(scim_user_alice.id)
        ).order_by("-timestamp").first()
        assert event.event_type == "user_deactivated"

    def test_reactivate_via_put(self, scim_client, scim_user_alice):
        """PUT with active:true should reactivate a deactivated user."""
        # First deactivate
        from ee.authentication.scim.utils import deactivate_scim_user

        deactivate_scim_user(scim_user_alice)
        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is False

        # Reactivate via PUT
        payload = make_scim_user_payload(
            "alice@example.com", "alice-ext-id", active=True
        )
        resp = scim_client.put(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is True

        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is True
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is None

    def test_reactivate_via_put_logs_correct_event_type(self, scim_client, scim_user_alice):
        from ee.authentication.scim.utils import deactivate_scim_user

        deactivate_scim_user(scim_user_alice)
        payload = make_scim_user_payload("alice@example.com", "alice-ext-id", active=True)
        scim_client.put(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        event = SCIMEvent.objects.filter(
            resource_id=str(scim_user_alice.id), event_type="user_reactivated"
        ).first()
        assert event is not None

    def test_update_email_via_put(self, scim_client, scim_user_alice):
        payload = make_scim_user_payload(
            "alice-new@example.com", "alice-ext-id"
        )
        resp = scim_client.put(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_user_alice.refresh_from_db()
        assert scim_user_alice.email == "alice-new@example.com"
        scim_user_alice.user.refresh_from_db()
        assert scim_user_alice.user.email == "alice-new@example.com"


# ---------------------------------------------------------------------------
# Partial update (PATCH — Entra ID's primary method)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPatchUser:

    def test_deactivate_via_patch_entra_style(self, scim_client, scim_user_alice):
        """Entra ID sends PATCH with Replace active=False."""
        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "False"},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False

        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is False

    def test_deactivate_via_patch_bool_value(self, scim_client, scim_user_alice):
        """Some IdPs send boolean false instead of string 'False'."""
        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": False},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False

    def test_deactivate_via_patch_valueless_replace(self, scim_client, scim_user_alice):
        """Some IdPs send replace without path, with value as a dict."""
        payload = make_patch_op([
            {"op": "Replace", "value": {"active": False}},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False

    def test_deactivate_via_patch_valueless_string_active(self, scim_client, scim_user_alice):
        """Valueless replace with string 'false'."""
        payload = make_patch_op([
            {"op": "Replace", "value": {"active": "false"}},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False

    def test_reactivate_via_patch(self, scim_client, scim_user_alice):
        from ee.authentication.scim.utils import deactivate_scim_user

        deactivate_scim_user(scim_user_alice)

        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "True"},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is True

        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is True
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is None

    def test_patch_username(self, scim_client, scim_user_alice):
        payload = make_patch_op([
            {"op": "Replace", "path": "userName", "value": "alice-renamed@example.com"},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_user_alice.refresh_from_db()
        assert scim_user_alice.email == "alice-renamed@example.com"

    def test_patch_display_name(self, scim_client, scim_user_alice):
        payload = make_patch_op([
            {"op": "Replace", "path": "displayName", "value": "Alice Wonderland"},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_user_alice.refresh_from_db()
        assert scim_user_alice.display_name == "Alice Wonderland"

    def test_patch_name_given_name(self, scim_client, scim_user_alice):
        payload = make_patch_op([
            {"op": "Replace", "path": "name.givenName", "value": "Alicia"},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_user_alice.refresh_from_db()
        assert "Alicia" in scim_user_alice.display_name

    def test_patch_name_family_name(self, scim_client, scim_user_alice):
        payload = make_patch_op([
            {"op": "Replace", "path": "name.familyName", "value": "Wonderland"},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_user_alice.refresh_from_db()
        assert "Wonderland" in scim_user_alice.display_name

    def test_patch_deactivate_logs_correct_event_type(
        self, scim_client, scim_user_alice
    ):
        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "False"},
        ])
        scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        event = SCIMEvent.objects.filter(
            resource_id=str(scim_user_alice.id), event_type="user_deactivated"
        ).first()
        assert event is not None

    def test_patch_no_operations_returns_400(self, scim_client, scim_user_alice):
        payload = {
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            "Operations": [],
        }
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400

    def test_patch_entra_multi_op(self, scim_client, scim_user_alice):
        """Entra often sends multiple operations in a single PATCH (e.g. active + title)."""
        payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "False"},
            {"op": "Add", "path": "title", "value": "Engineer"},
        ])
        resp = scim_client.patch(
            user_url(scim_user_alice.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert resp.json()["active"] is False


# ---------------------------------------------------------------------------
# Delete (DELETE — hard-delete from some IdPs)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDeleteUser:

    def test_delete_returns_204(self, scim_client, scim_user_alice):
        resp = scim_client.delete(user_url(scim_user_alice.id))
        assert resp.status_code == 204

    def test_delete_deactivates_user(self, scim_client, scim_user_alice):
        scim_client.delete(user_url(scim_user_alice.id))
        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is False
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is not None

    def test_delete_already_inactive_is_idempotent(self, scim_client, scim_user_alice):
        from ee.authentication.scim.utils import deactivate_scim_user

        deactivate_scim_user(scim_user_alice)
        resp = scim_client.delete(user_url(scim_user_alice.id))
        assert resp.status_code == 204

    def test_delete_logs_event(self, scim_client, scim_user_alice):
        scim_client.delete(user_url(scim_user_alice.id))
        event = SCIMEvent.objects.filter(
            event_type="user_deactivated",
            resource_id=str(scim_user_alice.id),
        ).first()
        assert event is not None
        assert event.response_status == 204

    def test_delete_nonexistent_returns_404(self, scim_client, scim_token):
        resp = scim_client.delete(user_url("nonexistent-id"))
        assert resp.status_code == 404

    def test_delete_clears_team_memberships(
        self, scim_client, scim_user_alice, scim_group_engineering
    ):
        """Deleting a user should revoke keys and remove all team memberships."""
        assert TeamMembership.objects.filter(
            org_member=scim_user_alice.org_member
        ).exists()

        scim_client.delete(user_url(scim_user_alice.id))

        assert not TeamMembership.objects.filter(
            org_member=scim_user_alice.org_member
        ).exists()

    def test_delete_wipes_crypto_material(self, scim_client, scim_user_alice):
        # Give the user some crypto material first
        scim_user_alice.org_member.identity_key = "test-key"
        scim_user_alice.org_member.wrapped_keyring = "test-keyring"
        scim_user_alice.org_member.wrapped_recovery = "test-recovery"
        scim_user_alice.org_member.save()

        scim_client.delete(user_url(scim_user_alice.id))

        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.identity_key == ""
        assert scim_user_alice.org_member.wrapped_keyring == ""
        assert scim_user_alice.org_member.wrapped_recovery == ""


# ---------------------------------------------------------------------------
# SCIM response format validation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestUserResponseFormat:

    def test_response_contains_schemas(self, scim_client, scim_user_alice):
        resp = scim_client.get(user_url(scim_user_alice.id))
        data = resp.json()
        assert "schemas" in data
        assert "urn:ietf:params:scim:schemas:core:2.0:User" in data["schemas"]

    def test_response_meta_location_format(self, scim_client, scim_user_alice):
        resp = scim_client.get(user_url(scim_user_alice.id))
        location = resp.json()["meta"]["location"]
        assert location.startswith("https://")
        assert "/service/scim/v2/Users/" in location

    def test_list_response_format(self, scim_client, scim_user_alice):
        resp = scim_client.get(USERS_URL)
        data = resp.json()
        assert "urn:ietf:params:scim:api:messages:2.0:ListResponse" in data["schemas"]
        assert "totalResults" in data
        assert "startIndex" in data
        assert "itemsPerPage" in data
        assert "Resources" in data

    def test_error_response_format(self, scim_client, scim_token):
        resp = scim_client.get(user_url("nonexistent"))
        data = resp.json()
        assert "urn:ietf:params:scim:api:messages:2.0:Error" in data["schemas"]
        assert "status" in data
        assert "detail" in data
