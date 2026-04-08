"""Integration tests for SCIM /Groups endpoints.

Covers: list, filter, create, get, replace (PUT), partial update (PATCH), delete.
Tests both Entra ID and Okta payload/patch formats where they diverge.
"""

import json

import pytest

from api.models import (
    SCIMEvent,
    SCIMGroup,
    SCIMUser,
    Team,
    TeamMembership,
)

from .conftest import (
    SCIM_CONTENT_TYPE,
    make_patch_op,
    make_scim_group_payload,
)

GROUPS_URL = "/scim/v2/Groups"


def group_url(scim_group_id):
    return f"{GROUPS_URL}/{scim_group_id}"


# ---------------------------------------------------------------------------
# List / Filter
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestListGroups:

    def test_list_empty(self, scim_client, scim_token):
        resp = scim_client.get(GROUPS_URL)
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalResults"] == 0
        assert data["Resources"] == []

    def test_list_returns_groups(self, scim_client, scim_group_engineering):
        resp = scim_client.get(GROUPS_URL)
        data = resp.json()
        assert data["totalResults"] == 1
        assert data["Resources"][0]["displayName"] == "Engineering"

    def test_list_includes_members(self, scim_client, scim_group_engineering):
        resp = scim_client.get(GROUPS_URL)
        members = resp.json()["Resources"][0]["members"]
        assert len(members) == 2

    def test_filter_by_display_name(
        self, scim_client, scim_group_engineering, organisation
    ):
        # Create a second group
        team2 = Team.objects.create(
            name="Marketing", organisation=organisation, is_scim_managed=True
        )
        SCIMGroup.objects.create(
            external_id="mkt-ext",
            organisation=organisation,
            team=team2,
            display_name="Marketing",
        )

        resp = scim_client.get(
            GROUPS_URL, {"filter": 'displayName eq "Engineering"'}
        )
        data = resp.json()
        assert data["totalResults"] == 1
        assert data["Resources"][0]["displayName"] == "Engineering"

    def test_filter_by_external_id(self, scim_client, scim_group_engineering):
        resp = scim_client.get(
            GROUPS_URL, {"filter": 'externalId eq "eng-ext-id"'}
        )
        data = resp.json()
        assert data["totalResults"] == 1

    def test_filter_no_match(self, scim_client, scim_group_engineering):
        resp = scim_client.get(
            GROUPS_URL, {"filter": 'displayName eq "Nonexistent"'}
        )
        assert resp.json()["totalResults"] == 0

    def test_pagination(self, scim_client, scim_group_engineering, organisation):
        team2 = Team.objects.create(
            name="Marketing", organisation=organisation, is_scim_managed=True
        )
        SCIMGroup.objects.create(
            external_id="mkt-ext",
            organisation=organisation,
            team=team2,
            display_name="Marketing",
        )

        resp = scim_client.get(GROUPS_URL, {"startIndex": 1, "count": 1})
        data = resp.json()
        assert data["totalResults"] == 2
        assert len(data["Resources"]) == 1


# ---------------------------------------------------------------------------
# Create (POST)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCreateGroup:

    def test_create_group(self, scim_client, scim_token, developer_role):
        payload = make_scim_group_payload("Design", "design-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["displayName"] == "Design"
        assert data["externalId"] == "design-ext-id"
        assert "/scim/v2/Groups/" in data["meta"]["location"]

        # Verify Team created
        scim_group = SCIMGroup.objects.get(id=data["id"])
        assert scim_group.team is not None
        assert scim_group.team.is_scim_managed is True
        assert scim_group.team.name == "Design"

    def test_create_group_with_description(self, scim_client, scim_token, developer_role):
        payload = make_scim_group_payload(
            "QA Team", "qa-ext-id", description="Quality Assurance"
        )
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        scim_group = SCIMGroup.objects.get(id=resp.json()["id"])
        assert scim_group.team.description == "Quality Assurance"

    def test_create_group_with_initial_members(
        self, scim_client, scim_user_alice, scim_user_bob
    ):
        payload = make_scim_group_payload(
            "NewTeam",
            "new-ext-id",
            members=[
                {"value": str(scim_user_alice.id)},
                {"value": str(scim_user_bob.id)},
            ],
        )
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        scim_group = SCIMGroup.objects.get(id=resp.json()["id"])
        assert scim_group.team.memberships.count() == 2

    def test_create_group_missing_display_name_returns_400(
        self, scim_client, scim_token
    ):
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

    @pytest.mark.django_db(transaction=True)
    def test_create_duplicate_external_id_returns_409(
        self, scim_client, scim_group_engineering
    ):
        payload = make_scim_group_payload("Another", "eng-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 409

    def test_create_group_logs_event(self, scim_client, scim_token, developer_role):
        payload = make_scim_group_payload("Logged Group", "log-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        event = SCIMEvent.objects.filter(
            event_type="group_created", status="success"
        ).first()
        assert event is not None
        assert event.resource_name == "Logged Group"
        assert event.response_status == 201

    def test_create_group_truncates_long_name(
        self, scim_client, scim_token, developer_role
    ):
        long_name = "A" * 100
        payload = make_scim_group_payload(long_name, "long-ext-id")
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        scim_group = SCIMGroup.objects.get(id=resp.json()["id"])
        assert len(scim_group.team.name) == 64


# ---------------------------------------------------------------------------
# Get (GET /:id)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGetGroup:

    def test_get_existing_group(self, scim_client, scim_group_engineering):
        resp = scim_client.get(group_url(scim_group_engineering.id))
        assert resp.status_code == 200
        data = resp.json()
        assert data["displayName"] == "Engineering"
        assert len(data["members"]) == 2

    def test_get_nonexistent_group(self, scim_client, scim_token):
        resp = scim_client.get(group_url("nonexistent-id"))
        assert resp.status_code == 404

    def test_get_group_members_have_correct_format(
        self, scim_client, scim_group_engineering
    ):
        resp = scim_client.get(group_url(scim_group_engineering.id))
        members = resp.json()["members"]
        for m in members:
            assert "value" in m
            assert "display" in m


# ---------------------------------------------------------------------------
# Replace (PUT — Okta's primary method for group updates)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReplaceGroup:

    def test_rename_group_via_put(self, scim_client, scim_group_engineering):
        payload = make_scim_group_payload(
            "Engineering v2",
            "eng-ext-id",
            members=[
                {"value": str(m["value"])}
                for m in scim_client.get(
                    group_url(scim_group_engineering.id)
                ).json()["members"]
            ],
        )
        resp = scim_client.put(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_group_engineering.refresh_from_db()
        assert scim_group_engineering.display_name == "Engineering v2"
        scim_group_engineering.team.refresh_from_db()
        assert scim_group_engineering.team.name == "Engineering v2"

    def test_put_membership_diff_adds_new_members(
        self,
        scim_client,
        scim_group_engineering,
        scim_user_alice,
        scim_user_bob,
        organisation,
        developer_role,
    ):
        """PUT with a new member in the list should add them."""
        # Create a third user
        from api.models import CustomUser, OrganisationMember

        user_carol = CustomUser.objects.create(
            username="carol@example.com", email="carol@example.com"
        )
        om_carol = OrganisationMember.objects.create(
            user=user_carol,
            organisation=organisation,
            role=developer_role,
            identity_key="",
            wrapped_keyring="",
            wrapped_recovery="",
        )
        scim_carol = SCIMUser.objects.create(
            external_id="carol-ext",
            organisation=organisation,
            user=user_carol,
            org_member=om_carol,
            email="carol@example.com",
            display_name="Carol Test",
            active=True,
        )

        payload = make_scim_group_payload(
            "Engineering",
            "eng-ext-id",
            members=[
                {"value": str(scim_user_alice.id)},
                {"value": str(scim_user_bob.id)},
                {"value": str(scim_carol.id)},
            ],
        )
        resp = scim_client.put(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert scim_group_engineering.team.memberships.count() == 3

    def test_put_membership_diff_removes_departed_members(
        self, scim_client, scim_group_engineering, scim_user_alice, scim_user_bob
    ):
        """PUT without a current member should remove them."""
        payload = make_scim_group_payload(
            "Engineering",
            "eng-ext-id",
            members=[{"value": str(scim_user_alice.id)}],
        )
        resp = scim_client.put(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert scim_group_engineering.team.memberships.count() == 1
        assert not TeamMembership.objects.filter(
            team=scim_group_engineering.team,
            org_member=scim_user_bob.org_member,
        ).exists()

    def test_put_empty_members_removes_all(
        self, scim_client, scim_group_engineering
    ):
        payload = make_scim_group_payload("Engineering", "eng-ext-id", members=[])
        resp = scim_client.put(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert scim_group_engineering.team.memberships.count() == 0


# ---------------------------------------------------------------------------
# Partial update (PATCH — Entra ID's primary method for groups)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestPatchGroup:

    # -- Add members --

    def test_add_member_entra_style(
        self,
        scim_client,
        scim_group_engineering,
        organisation,
        developer_role,
    ):
        """Entra ID sends PATCH Add members with value array."""
        from api.models import CustomUser, OrganisationMember

        user_dave = CustomUser.objects.create(
            username="dave@example.com", email="dave@example.com"
        )
        om_dave = OrganisationMember.objects.create(
            user=user_dave,
            organisation=organisation,
            role=developer_role,
            identity_key="",
            wrapped_keyring="",
            wrapped_recovery="",
        )
        scim_dave = SCIMUser.objects.create(
            external_id="dave-ext",
            organisation=organisation,
            user=user_dave,
            org_member=om_dave,
            email="dave@example.com",
            display_name="Dave Test",
            active=True,
        )

        payload = make_patch_op([
            {
                "op": "Add",
                "path": "members",
                "value": [{"value": str(scim_dave.id)}],
            }
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert scim_group_engineering.team.memberships.count() == 3
        assert TeamMembership.objects.filter(
            team=scim_group_engineering.team, org_member=om_dave
        ).exists()

    def test_add_member_logs_event(
        self,
        scim_client,
        scim_group_engineering,
        organisation,
        developer_role,
    ):
        from api.models import CustomUser, OrganisationMember

        user_eve = CustomUser.objects.create(
            username="eve@example.com", email="eve@example.com"
        )
        om_eve = OrganisationMember.objects.create(
            user=user_eve,
            organisation=organisation,
            role=developer_role,
            identity_key="",
            wrapped_keyring="",
            wrapped_recovery="",
        )
        scim_eve = SCIMUser.objects.create(
            external_id="eve-ext",
            organisation=organisation,
            user=user_eve,
            org_member=om_eve,
            email="eve@example.com",
            display_name="Eve Test",
            active=True,
        )

        payload = make_patch_op([
            {"op": "Add", "path": "members", "value": [{"value": str(scim_eve.id)}]}
        ])
        scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        event = SCIMEvent.objects.filter(event_type="member_added").first()
        assert event is not None
        assert event.detail["member_email"] == "eve@example.com"

    def test_add_member_idempotent(
        self, scim_client, scim_group_engineering, scim_user_alice
    ):
        """Adding an already-present member should not create duplicates."""
        payload = make_patch_op([
            {
                "op": "Add",
                "path": "members",
                "value": [{"value": str(scim_user_alice.id)}],
            }
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        # Still only 2 memberships (alice and bob), not 3
        assert scim_group_engineering.team.memberships.count() == 2

    # -- Remove members (Entra ID format) --

    def test_remove_member_entra_bracket_notation(
        self, scim_client, scim_group_engineering, scim_user_bob
    ):
        """Entra ID sends: op=Remove, path='members[value eq "id"]'."""
        payload = make_patch_op([
            {
                "op": "Remove",
                "path": f'members[value eq "{scim_user_bob.id}"]',
            }
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert not TeamMembership.objects.filter(
            team=scim_group_engineering.team,
            org_member=scim_user_bob.org_member,
        ).exists()
        # Alice should still be there
        assert scim_group_engineering.team.memberships.count() == 1

    # -- Remove members (Okta format) --

    def test_remove_member_okta_value_array(
        self, scim_client, scim_group_engineering, scim_user_bob
    ):
        """Okta sends: op=Remove, path='members', value=[{"value": "id"}]."""
        payload = make_patch_op([
            {
                "op": "Remove",
                "path": "members",
                "value": [{"value": str(scim_user_bob.id)}],
            }
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert not TeamMembership.objects.filter(
            team=scim_group_engineering.team,
            org_member=scim_user_bob.org_member,
        ).exists()

    def test_remove_member_logs_event(
        self, scim_client, scim_group_engineering, scim_user_bob
    ):
        payload = make_patch_op([
            {
                "op": "Remove",
                "path": f'members[value eq "{scim_user_bob.id}"]',
            }
        ])
        scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        event = SCIMEvent.objects.filter(event_type="member_removed").first()
        assert event is not None
        assert event.detail["member_email"] == "bob@example.com"

    def test_remove_nonexistent_member_is_noop(
        self, scim_client, scim_group_engineering
    ):
        """Removing a member that's not in the group should not error."""
        payload = make_patch_op([
            {
                "op": "Remove",
                "path": 'members[value eq "nonexistent-id"]',
            }
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert scim_group_engineering.team.memberships.count() == 2

    # -- Rename group --

    def test_rename_via_patch_replace(self, scim_client, scim_group_engineering):
        payload = make_patch_op([
            {"op": "Replace", "path": "displayName", "value": "Platform"},
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_group_engineering.refresh_from_db()
        assert scim_group_engineering.display_name == "Platform"
        scim_group_engineering.team.refresh_from_db()
        assert scim_group_engineering.team.name == "Platform"

    def test_rename_via_patch_add(self, scim_client, scim_group_engineering):
        """Some IdPs use 'Add' op for displayName updates."""
        payload = make_patch_op([
            {"op": "Add", "path": "displayName", "value": "Infrastructure"},
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_group_engineering.team.refresh_from_db()
        assert scim_group_engineering.team.name == "Infrastructure"

    # -- Update description --

    def test_update_description_via_patch(self, scim_client, scim_group_engineering):
        payload = make_patch_op([
            {"op": "Replace", "path": "description", "value": "The engineering team"},
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_group_engineering.team.refresh_from_db()
        assert scim_group_engineering.team.description == "The engineering team"

    # -- No operations --

    def test_patch_no_operations_returns_400(self, scim_client, scim_group_engineering):
        payload = {
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
            "Operations": [],
        }
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 400

    # -- Remove last member --

    def test_remove_all_members_leaves_empty_team(
        self, scim_client, scim_group_engineering, scim_user_alice, scim_user_bob
    ):
        payload = make_patch_op([
            {
                "op": "Remove",
                "path": f'members[value eq "{scim_user_alice.id}"]',
            },
            {
                "op": "Remove",
                "path": f'members[value eq "{scim_user_bob.id}"]',
            },
        ])
        resp = scim_client.patch(
            group_url(scim_group_engineering.id),
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        assert scim_group_engineering.team.memberships.count() == 0
        # Team still exists
        scim_group_engineering.team.refresh_from_db()
        assert scim_group_engineering.team.deleted_at is None


# ---------------------------------------------------------------------------
# Delete (DELETE)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDeleteGroup:

    def test_delete_returns_204(self, scim_client, scim_group_engineering):
        resp = scim_client.delete(group_url(scim_group_engineering.id))
        assert resp.status_code == 204

    def test_delete_soft_deletes_team(self, scim_client, scim_group_engineering):
        team = scim_group_engineering.team
        scim_client.delete(group_url(scim_group_engineering.id))
        team.refresh_from_db()
        assert team.deleted_at is not None

    def test_delete_removes_scim_group_record(
        self, scim_client, scim_group_engineering
    ):
        group_id = scim_group_engineering.id
        scim_client.delete(group_url(group_id))
        assert not SCIMGroup.objects.filter(id=group_id).exists()

    def test_delete_does_not_affect_member_org_membership(
        self, scim_client, scim_group_engineering, scim_user_alice
    ):
        """Deleting a group should not deactivate the member's org membership."""
        scim_client.delete(group_url(scim_group_engineering.id))
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is None

    def test_delete_logs_event(self, scim_client, scim_group_engineering):
        scim_client.delete(group_url(scim_group_engineering.id))
        event = SCIMEvent.objects.filter(event_type="group_deleted").first()
        assert event is not None
        assert event.resource_name == "Engineering"
        assert event.response_status == 204

    def test_delete_nonexistent_returns_404(self, scim_client, scim_token):
        resp = scim_client.delete(group_url("nonexistent-id"))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Response format
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGroupResponseFormat:

    def test_response_contains_schemas(self, scim_client, scim_group_engineering):
        resp = scim_client.get(group_url(scim_group_engineering.id))
        data = resp.json()
        assert "urn:ietf:params:scim:schemas:core:2.0:Group" in data["schemas"]

    def test_response_meta_location_format(self, scim_client, scim_group_engineering):
        resp = scim_client.get(group_url(scim_group_engineering.id))
        location = resp.json()["meta"]["location"]
        assert location.startswith("https://")
        assert "/service/scim/v2/Groups/" in location
