"""Tests for SCIM /Groups endpoints — fully mocked, no database.

Covers: list, filter, create, get, replace (PUT), partial update (PATCH), delete.
"""

import json
import uuid
from unittest.mock import MagicMock, patch, call

import pytest
from django.db import IntegrityError

from .conftest import (
    SCIM_CONTENT_TYPE,
    make_mock_organisation,
    make_mock_scim_group,
    make_mock_scim_user,
    make_mock_team,
    make_patch_op,
    make_scim_group_payload,
)

GROUPS_URL = "/scim/v2/Groups"

# Patch targets — where names are looked up in views/groups.py
_P = "ee.authentication.scim.views.groups"


def group_url(scim_group_id):
    return f"{GROUPS_URL}/{scim_group_id}"


def _serialized_group(scim_group=None, members=None, **overrides):
    """Return a fake serialized SCIM group dict."""
    sg = scim_group or make_mock_scim_group()
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "id": str(overrides.get("id", sg.id)),
        "externalId": overrides.get("external_id", sg.external_id),
        "displayName": overrides.get("display_name", sg.display_name),
        "members": members if members is not None else [],
        "meta": {
            "resourceType": "Group",
            "created": "2025-01-01T00:00:00+00:00",
            "lastModified": "2025-01-01T00:00:00+00:00",
            "location": f"https://testserver/service/scim/v2/Groups/{sg.id}",
        },
    }


# ---------------------------------------------------------------------------
# List / Filter
# ---------------------------------------------------------------------------


class TestListGroups:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_list_empty(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        qs = MagicMock()
        qs.count.return_value = 0
        qs.__getitem__ = MagicMock(return_value=[])
        MockSCIMGroup.objects.filter.return_value.order_by.return_value = qs

        resp = scim_client.get(GROUPS_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalResults"] == 0
        assert data["Resources"] == []

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_list_returns_groups(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        qs = MagicMock()
        qs.count.return_value = 1
        qs.__getitem__ = MagicMock(return_value=[eng])
        MockSCIMGroup.objects.filter.return_value.order_by.return_value = qs

        mock_serialize.return_value = _serialized_group(eng)

        resp = scim_client.get(GROUPS_URL)
        data = resp.json()
        assert data["totalResults"] == 1
        assert data["Resources"][0]["displayName"] == "Engineering"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_list_includes_members(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        qs = MagicMock()
        qs.count.return_value = 1
        qs.__getitem__ = MagicMock(return_value=[eng])
        MockSCIMGroup.objects.filter.return_value.order_by.return_value = qs

        members = [
            {"value": "user-1", "display": "Alice"},
            {"value": "user-2", "display": "Bob"},
        ]
        mock_serialize.return_value = _serialized_group(eng, members=members)

        resp = scim_client.get(GROUPS_URL)
        data = resp.json()
        assert len(data["Resources"][0]["members"]) == 2

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.scim_filter_to_queryset")
    @patch(f"{_P}.SCIMGroup")
    def test_filter_by_display_name(
        self, MockSCIMGroup, mock_filter_qs, mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        qs = MagicMock()
        MockSCIMGroup.objects.filter.return_value.order_by.return_value = qs

        filtered_qs = MagicMock()
        filtered_qs.count.return_value = 1
        filtered_qs.__getitem__ = MagicMock(return_value=[eng])
        mock_filter_qs.return_value = filtered_qs

        mock_serialize.return_value = _serialized_group(eng)

        resp = scim_client.get(GROUPS_URL, {"filter": 'displayName eq "Engineering"'})
        data = resp.json()
        assert data["totalResults"] == 1
        assert data["Resources"][0]["displayName"] == "Engineering"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_pagination(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        qs = MagicMock()
        qs.count.return_value = 2
        qs.__getitem__ = MagicMock(return_value=[eng])
        MockSCIMGroup.objects.filter.return_value.order_by.return_value = qs

        mock_serialize.return_value = _serialized_group(eng)

        resp = scim_client.get(GROUPS_URL, {"startIndex": 1, "count": 1})
        data = resp.json()
        assert data["totalResults"] == 2
        assert data["itemsPerPage"] == 1


# ---------------------------------------------------------------------------
# Create (POST)
# ---------------------------------------------------------------------------


class TestCreateGroup:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    @patch(f"{_P}.Team")
    def test_create_group(
        self, MockTeam, MockSCIMGroup, MockSCIMUser, mock_add_member,
        mock_serialize, mock_log, scim_client
    ):
        team = make_mock_team(name="Design")
        MockTeam.objects.create.return_value = team

        scim_group = make_mock_scim_group(display_name="Design", external_id="design-ext-id")
        MockSCIMGroup.objects.create.return_value = scim_group
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(scim_group)

        payload = make_scim_group_payload("Design", "design-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["displayName"] == "Design"
        MockTeam.objects.create.assert_called_once()
        create_kwargs = MockTeam.objects.create.call_args[1]
        assert create_kwargs["is_scim_managed"] is True

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    @patch(f"{_P}.Team")
    def test_create_group_with_description(
        self, MockTeam, MockSCIMGroup, MockSCIMUser, mock_add_member,
        mock_serialize, mock_log, scim_client
    ):
        team = make_mock_team(name="QA Team")
        MockTeam.objects.create.return_value = team

        scim_group = make_mock_scim_group(display_name="QA Team")
        MockSCIMGroup.objects.create.return_value = scim_group
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(scim_group)

        payload = make_scim_group_payload("QA Team", "qa-ext-id", description="Quality Assurance")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        create_kwargs = MockTeam.objects.create.call_args[1]
        assert create_kwargs["description"] == "Quality Assurance"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    @patch(f"{_P}.Team")
    def test_create_group_with_initial_members(
        self, MockTeam, MockSCIMGroup, MockSCIMUser, mock_add_member,
        mock_serialize, mock_log, scim_client
    ):
        team = make_mock_team(name="NewTeam")
        MockTeam.objects.create.return_value = team

        scim_group = make_mock_scim_group(display_name="NewTeam")
        MockSCIMGroup.objects.create.return_value = scim_group
        MockSCIMGroup.DoesNotExist = Exception

        alice = make_mock_scim_user(email="alice@example.com", id="alice-id")
        bob = make_mock_scim_user(email="bob@example.com", id="bob-id")
        MockSCIMUser.objects.filter.return_value.first.side_effect = [alice, bob]

        mock_serialize.return_value = _serialized_group(scim_group)

        payload = make_scim_group_payload(
            "NewTeam", "new-ext-id",
            members=[{"value": "alice-id"}, {"value": "bob-id"}],
        )
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        assert mock_add_member.call_count == 2

    @patch(f"{_P}.log_scim_event")
    def test_create_group_missing_display_name_returns_400(self, mock_log, scim_client):
        payload = {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            "externalId": "x",
        }
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMGroup")
    @patch(f"{_P}.Team")
    def test_create_duplicate_external_id_returns_409(
        self, MockTeam, MockSCIMGroup, mock_log, scim_client
    ):
        team = make_mock_team()
        MockTeam.objects.create.return_value = team
        MockSCIMGroup.objects.create.side_effect = IntegrityError("duplicate key")
        MockSCIMGroup.DoesNotExist = Exception

        payload = make_scim_group_payload("Another", "eng-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 409
        # Team should be cleaned up
        team.delete.assert_called_once()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    @patch(f"{_P}.Team")
    def test_create_group_logs_event(
        self, MockTeam, MockSCIMGroup, MockSCIMUser, mock_add_member,
        mock_serialize, mock_log, scim_client
    ):
        MockTeam.objects.create.return_value = make_mock_team()
        scim_group = make_mock_scim_group(display_name="Logged Group")
        MockSCIMGroup.objects.create.return_value = scim_group
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(scim_group)

        payload = make_scim_group_payload("Logged Group", "log-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        mock_log.assert_called()
        log_call = mock_log.call_args_list[-1]
        assert log_call[0][1] == "group_created"
        assert log_call[1]["response_status"] == 201

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    @patch(f"{_P}.Team")
    def test_create_group_truncates_long_name(
        self, MockTeam, MockSCIMGroup, MockSCIMUser, mock_add_member,
        mock_serialize, mock_log, scim_client
    ):
        team = make_mock_team()
        MockTeam.objects.create.return_value = team
        scim_group = make_mock_scim_group()
        MockSCIMGroup.objects.create.return_value = scim_group
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(scim_group)

        long_name = "A" * 100
        payload = make_scim_group_payload(long_name, "long-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        create_kwargs = MockTeam.objects.create.call_args[1]
        assert len(create_kwargs["name"]) == 64


# ---------------------------------------------------------------------------
# Get (GET /:id)
# ---------------------------------------------------------------------------


class TestGetGroup:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_get_existing_group(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering", id="eng-id")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        members = [
            {"value": "u1", "display": "Alice"},
            {"value": "u2", "display": "Bob"},
        ]
        mock_serialize.return_value = _serialized_group(eng, members=members)

        resp = scim_client.get(group_url("eng-id"))
        assert resp.status_code == 200
        data = resp.json()
        assert data["displayName"] == "Engineering"
        assert len(data["members"]) == 2

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMGroup")
    def test_get_nonexistent_group(self, MockSCIMGroup, mock_log, scim_client):
        MockSCIMGroup.DoesNotExist = Exception
        MockSCIMGroup.objects.select_related.return_value.get.side_effect = Exception("not found")

        resp = scim_client.get(group_url("nonexistent-id"))
        assert resp.status_code == 404

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_get_group_members_have_correct_format(
        self, MockSCIMGroup, mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        members = [
            {"value": "u1", "display": "Alice"},
            {"value": "u2", "display": "Bob"},
        ]
        mock_serialize.return_value = _serialized_group(eng, members=members)

        resp = scim_client.get(group_url(eng.id))
        for m in resp.json()["members"]:
            assert "value" in m
            assert "display" in m


# ---------------------------------------------------------------------------
# Replace (PUT)
# ---------------------------------------------------------------------------


class TestReplaceGroup:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.TeamMembership")
    @patch(f"{_P}.SCIMGroup")
    def test_rename_group_via_put(
        self, MockSCIMGroup, MockTM, MockSCIMUser, mock_add, mock_remove,
        mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering", external_id="eng-ext-id")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        # No membership changes (empty current, empty incoming)
        MockTM.objects.filter.return_value.select_related.return_value = []
        mock_serialize.return_value = _serialized_group(eng, display_name="Engineering v2")

        payload = make_scim_group_payload("Engineering v2", "eng-ext-id", members=[])
        resp = scim_client.put(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert eng.display_name == "Engineering v2"
        eng.team.save.assert_called()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.TeamMembership")
    @patch(f"{_P}.SCIMGroup")
    def test_put_membership_diff_adds_new_members(
        self, MockSCIMGroup, MockTM, MockSCIMUser, mock_add, mock_remove,
        mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        # Current: alice. Incoming: alice + carol
        alice = make_mock_scim_user(email="alice@example.com", id="alice-id")
        carol = make_mock_scim_user(email="carol@example.com", id="carol-id")

        # Current memberships — one membership pointing to alice
        alice_tm = MagicMock()
        alice_tm.org_member = alice.org_member
        MockTM.objects.filter.return_value.select_related.return_value = [alice_tm]

        # When querying SCIMUser for current membership mapping, return alice
        # When querying for the new member to add, return carol
        def scim_user_filter_side_effect(**kwargs):
            qs = MagicMock()
            if kwargs.get("org_member") == alice.org_member:
                qs.first.return_value = alice
            elif kwargs.get("id") == "carol-id":
                qs.first.return_value = carol
            elif kwargs.get("id") == "alice-id":
                qs.first.return_value = alice
            else:
                qs.first.return_value = None
            return qs

        MockSCIMUser.objects.filter.side_effect = scim_user_filter_side_effect

        mock_serialize.return_value = _serialized_group(eng)

        payload = make_scim_group_payload(
            "Engineering", "eng-ext-id",
            members=[{"value": "alice-id"}, {"value": "carol-id"}],
        )
        resp = scim_client.put(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        # carol should be added
        mock_add.assert_called()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.TeamMembership")
    @patch(f"{_P}.SCIMGroup")
    def test_put_membership_diff_removes_departed_members(
        self, MockSCIMGroup, MockTM, MockSCIMUser, mock_add, mock_remove,
        mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        alice = make_mock_scim_user(email="alice@example.com", id="alice-id")
        bob = make_mock_scim_user(email="bob@example.com", id="bob-id")

        alice_tm = MagicMock()
        alice_tm.org_member = alice.org_member
        bob_tm = MagicMock()
        bob_tm.org_member = bob.org_member
        MockTM.objects.filter.return_value.select_related.return_value = [alice_tm, bob_tm]

        def scim_user_filter_side_effect(**kwargs):
            qs = MagicMock()
            if kwargs.get("org_member") == alice.org_member:
                qs.first.return_value = alice
            elif kwargs.get("org_member") == bob.org_member:
                qs.first.return_value = bob
            elif kwargs.get("id") == "alice-id":
                qs.first.return_value = alice
            elif kwargs.get("id") == "bob-id":
                qs.first.return_value = bob
            else:
                qs.first.return_value = None
            return qs

        MockSCIMUser.objects.filter.side_effect = scim_user_filter_side_effect
        mock_serialize.return_value = _serialized_group(eng)

        # Only keep alice
        payload = make_scim_group_payload(
            "Engineering", "eng-ext-id",
            members=[{"value": "alice-id"}],
        )
        resp = scim_client.put(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        # Bob should be removed
        mock_remove.assert_called()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.TeamMembership")
    @patch(f"{_P}.SCIMGroup")
    def test_put_empty_members_removes_all(
        self, MockSCIMGroup, MockTM, MockSCIMUser, mock_add, mock_remove,
        mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        alice = make_mock_scim_user(email="alice@example.com", id="alice-id")
        bob = make_mock_scim_user(email="bob@example.com", id="bob-id")

        alice_tm = MagicMock()
        alice_tm.org_member = alice.org_member
        bob_tm = MagicMock()
        bob_tm.org_member = bob.org_member
        MockTM.objects.filter.return_value.select_related.return_value = [alice_tm, bob_tm]

        def scim_user_filter_side_effect(**kwargs):
            qs = MagicMock()
            if kwargs.get("org_member") == alice.org_member:
                qs.first.return_value = alice
            elif kwargs.get("org_member") == bob.org_member:
                qs.first.return_value = bob
            elif kwargs.get("id") == "alice-id":
                qs.first.return_value = alice
            elif kwargs.get("id") == "bob-id":
                qs.first.return_value = bob
            else:
                qs.first.return_value = None
            return qs

        MockSCIMUser.objects.filter.side_effect = scim_user_filter_side_effect
        mock_serialize.return_value = _serialized_group(eng, members=[])

        payload = make_scim_group_payload("Engineering", "eng-ext-id", members=[])
        resp = scim_client.put(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        # Both alice and bob should be removed
        assert mock_remove.call_count == 2


# ---------------------------------------------------------------------------
# Partial update (PATCH)
# ---------------------------------------------------------------------------


class TestPatchGroup:

    # -- Add members --

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    def test_add_member_entra_style(
        self, MockSCIMGroup, MockSCIMUser, mock_add_member, mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        dave = make_mock_scim_user(email="dave@example.com", id="dave-id")
        MockSCIMUser.objects.filter.return_value.first.return_value = dave

        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Add", "path": "members", "value": [{"value": "dave-id"}]}
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_add_member.assert_called_once()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    def test_add_member_logs_event(
        self, MockSCIMGroup, MockSCIMUser, mock_add_member, mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        eve = make_mock_scim_user(email="eve@example.com", id="eve-id")
        MockSCIMUser.objects.filter.return_value.first.return_value = eve
        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Add", "path": "members", "value": [{"value": "eve-id"}]}
        ])
        scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        # Should have at least one member_added log call
        member_added_calls = [
            c for c in mock_log.call_args_list if c[0][1] == "member_added"
        ]
        assert len(member_added_calls) >= 1
        assert member_added_calls[0][1]["detail"]["member_email"] == "eve@example.com"

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._add_member_to_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    def test_add_member_idempotent(
        self, MockSCIMGroup, MockSCIMUser, mock_add_member, mock_serialize, mock_log, scim_client
    ):
        """Adding a member should call _add_member_to_team (which handles dedup internally)."""
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        alice = make_mock_scim_user(email="alice@example.com", id="alice-id")
        MockSCIMUser.objects.filter.return_value.first.return_value = alice
        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Add", "path": "members", "value": [{"value": "alice-id"}]}
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_add_member.assert_called_once()

    # -- Remove members (Entra ID format) --

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}.parse_patch_path_filter")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    def test_remove_member_entra_bracket_notation(
        self, MockSCIMGroup, MockSCIMUser, mock_parse_filter, mock_remove,
        mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        bob = make_mock_scim_user(email="bob@example.com", id="bob-id")
        MockSCIMUser.objects.filter.return_value.first.return_value = bob
        mock_parse_filter.return_value = "bob-id"
        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Remove", "path": f'members[value eq "bob-id"]'}
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_remove.assert_called_once()

    # -- Remove members (Okta format) --

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    def test_remove_member_okta_value_array(
        self, MockSCIMGroup, MockSCIMUser, mock_remove, mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        bob = make_mock_scim_user(email="bob@example.com", id="bob-id")
        MockSCIMUser.objects.filter.return_value.first.return_value = bob
        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Remove", "path": "members", "value": [{"value": "bob-id"}]}
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_remove.assert_called()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    def test_remove_member_logs_event(
        self, MockSCIMGroup, MockSCIMUser, mock_remove, mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        bob = make_mock_scim_user(email="bob@example.com", id="bob-id")
        MockSCIMUser.objects.filter.return_value.first.return_value = bob
        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Remove", "path": "members", "value": [{"value": "bob-id"}]}
        ])
        scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        member_removed_calls = [
            c for c in mock_log.call_args_list if c[0][1] == "member_removed"
        ]
        assert len(member_removed_calls) >= 1

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}._remove_member_from_team")
    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.SCIMGroup")
    def test_remove_nonexistent_member_is_noop(
        self, MockSCIMGroup, MockSCIMUser, mock_remove, mock_serialize, mock_log, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        MockSCIMUser.objects.filter.return_value.first.return_value = None
        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Remove", "path": "members", "value": [{"value": "nonexistent-id"}]}
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        mock_remove.assert_not_called()

    # -- Rename group --

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_rename_via_patch_replace(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(eng, display_name="Platform")

        payload = make_patch_op([
            {"op": "Replace", "path": "displayName", "value": "Platform"},
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert eng.display_name == "Platform"
        eng.team.save.assert_called()

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_rename_via_patch_add(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(eng, display_name="Infrastructure")

        payload = make_patch_op([
            {"op": "Add", "path": "displayName", "value": "Infrastructure"},
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert eng.display_name == "Infrastructure"

    # -- Update description --

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_update_description_via_patch(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(eng)

        payload = make_patch_op([
            {"op": "Replace", "path": "description", "value": "The engineering team"},
        ])
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        eng.team.save.assert_called()

    # -- No operations --

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMGroup")
    def test_patch_no_operations_returns_400(self, MockSCIMGroup, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        payload = {
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            "Operations": [],
        }
        resp = scim_client.patch(
            group_url(eng.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Delete (DELETE)
# ---------------------------------------------------------------------------


class TestDeleteGroup:

    @patch(f"{_P}.ServiceAccountToken")
    @patch(f"{_P}.ServiceAccount")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.SCIMGroup")
    def test_delete_returns_204(self, MockSCIMGroup, mock_revoke, mock_log, MockSA, MockSAToken, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        resp = scim_client.delete(group_url(eng.id))
        assert resp.status_code == 204

    @patch(f"{_P}.ServiceAccountToken")
    @patch(f"{_P}.ServiceAccount")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.SCIMGroup")
    def test_delete_soft_deletes_team(self, MockSCIMGroup, mock_revoke, mock_log, MockSA, MockSAToken, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        scim_client.delete(group_url(eng.id))
        assert eng.team.deleted_at is not None
        eng.team.save.assert_called()

    @patch(f"{_P}.ServiceAccountToken")
    @patch(f"{_P}.ServiceAccount")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.SCIMGroup")
    def test_delete_removes_scim_group_record(self, MockSCIMGroup, mock_revoke, mock_log, MockSA, MockSAToken, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        scim_client.delete(group_url(eng.id))
        eng.delete.assert_called_once()

    @patch(f"{_P}.ServiceAccountToken")
    @patch(f"{_P}.ServiceAccount")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.SCIMGroup")
    def test_delete_logs_event(self, MockSCIMGroup, mock_revoke, mock_log, MockSA, MockSAToken, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        scim_client.delete(group_url(eng.id))
        mock_log.assert_called()
        log_call = mock_log.call_args_list[0]
        assert log_call[0][1] == "group_deleted"
        assert log_call[1]["response_status"] == 204

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.SCIMGroup")
    def test_delete_nonexistent_returns_404(self, MockSCIMGroup, mock_log, scim_client):
        MockSCIMGroup.DoesNotExist = Exception
        MockSCIMGroup.objects.select_related.return_value.get.side_effect = Exception("not found")

        resp = scim_client.delete(group_url("nonexistent-id"))
        assert resp.status_code == 404

    @patch(f"{_P}.ServiceAccountToken")
    @patch(f"{_P}.ServiceAccount")
    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.SCIMGroup")
    def test_delete_revokes_team_environment_keys(
        self, MockSCIMGroup, mock_revoke, mock_log, MockSA, MockSAToken, scim_client
    ):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception

        scim_client.delete(group_url(eng.id))
        mock_revoke.assert_called_once_with(eng.team)


# ---------------------------------------------------------------------------
# Response format
# ---------------------------------------------------------------------------


class TestGroupResponseFormat:

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_response_contains_schemas(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(eng)

        resp = scim_client.get(group_url(eng.id))
        data = resp.json()
        assert "urn:ietf:params:scim:schemas:core:2.0:Group" in data["schemas"]

    @patch(f"{_P}.log_scim_event")
    @patch(f"{_P}.serialize_scim_group")
    @patch(f"{_P}.SCIMGroup")
    def test_response_meta_location_format(self, MockSCIMGroup, mock_serialize, mock_log, scim_client):
        eng = make_mock_scim_group(display_name="Engineering")
        MockSCIMGroup.objects.select_related.return_value.get.return_value = eng
        MockSCIMGroup.DoesNotExist = Exception
        mock_serialize.return_value = _serialized_group(eng)

        resp = scim_client.get(group_url(eng.id))
        location = resp.json()["meta"]["location"]
        assert "/service/scim/v2/Groups/" in location
