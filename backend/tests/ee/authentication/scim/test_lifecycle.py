"""End-to-end lifecycle tests for SCIM provisioning.

These tests simulate complete IdP provisioning flows — the same multi-step
sequences that Entra ID and Okta perform in production — and verify the
cumulative state after each step.
"""

import json

import pytest

from api.models import (
    CustomUser,
    Organisation,
    OrganisationMember,
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
    make_scim_user_payload,
)

USERS_URL = "/scim/v2/Users"
GROUPS_URL = "/scim/v2/Groups"


# ---------------------------------------------------------------------------
# Scenario 9.1: Full user lifecycle
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestFullUserLifecycle:
    """
    1. Provision user
    2. Push group containing user
    3. (SSO login + key ceremony simulated)
    4. Remove user from group
    5. Verify user still in org but not in team
    6. Unassign user → deactivated
    """

    def test_full_lifecycle(self, scim_client, scim_token, developer_role, organisation):
        # 1. Provision user
        user_payload = make_scim_user_payload(
            "lifecycle@example.com", "lifecycle-ext"
        )
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(user_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        scim_user_id = resp.json()["id"]

        scim_user = SCIMUser.objects.get(id=scim_user_id)
        assert scim_user.active is True
        assert scim_user.org_member.identity_key == ""  # Pending

        # 2. Push group containing this user
        group_payload = make_scim_group_payload(
            "Lifecycle Team",
            "lifecycle-grp-ext",
            members=[{"value": scim_user_id}],
        )
        resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(group_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        scim_group_id = resp.json()["id"]
        scim_group = SCIMGroup.objects.get(id=scim_group_id)
        assert scim_group.team.memberships.count() == 1

        # 3. Simulate SSO login + key ceremony (set identity_key)
        scim_user.org_member.identity_key = "real-identity-key"
        scim_user.org_member.wrapped_keyring = "real-keyring"
        scim_user.org_member.wrapped_recovery = "real-recovery"
        scim_user.org_member.save()

        # 4. Remove user from group (Entra ID style)
        remove_payload = make_patch_op([
            {"op": "Remove", "path": f'members[value eq "{scim_user_id}"]'}
        ])
        resp = scim_client.patch(
            f"{GROUPS_URL}/{scim_group_id}",
            data=json.dumps(remove_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        # 5. Verify: user still in org, not in team
        scim_user.refresh_from_db()
        assert scim_user.active is True
        scim_user.org_member.refresh_from_db()
        assert scim_user.org_member.deleted_at is None
        assert not TeamMembership.objects.filter(
            org_member=scim_user.org_member
        ).exists()

        # 6. Unassign user (Entra PATCH active=false)
        deactivate_payload = make_patch_op([
            {"op": "Replace", "path": "active", "value": "False"}
        ])
        resp = scim_client.patch(
            f"{USERS_URL}/{scim_user_id}",
            data=json.dumps(deactivate_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        # Verify final state
        scim_user.refresh_from_db()
        assert scim_user.active is False
        scim_user.org_member.refresh_from_db()
        assert scim_user.org_member.deleted_at is not None
        assert scim_user.org_member.identity_key == ""
        assert scim_user.org_member.wrapped_keyring == ""

        # Verify audit trail
        events = SCIMEvent.objects.filter(
            organisation=organisation
        ).order_by("timestamp")
        event_types = [e.event_type for e in events]
        assert "user_created" in event_types
        assert "group_created" in event_types
        assert "member_removed" in event_types
        assert "user_deactivated" in event_types


# ---------------------------------------------------------------------------
# Scenario 9.2: Deactivate → reactivate with different group membership
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDeactivateReactivateDifferentGroups:
    """
    1. User in Group A and Group B
    2. Deactivate user → memberships cleared
    3. Remove user from Group B in IdP (while deactivated)
    4. Reactivate user
    5. IdP re-pushes: user added to Group A only
    6. Verify: user in Team A, NOT in Team B
    """

    def test_reactivation_with_different_groups(
        self, scim_client, scim_token, developer_role, organisation
    ):
        # Setup: provision user
        user_payload = make_scim_user_payload("regroup@example.com", "regroup-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(user_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_user_id = resp.json()["id"]

        # Create Group A and Group B with user
        for name, ext_id in [("Group A", "grp-a-ext"), ("Group B", "grp-b-ext")]:
            resp = scim_client.post(
                GROUPS_URL,
                data=json.dumps(
                    make_scim_group_payload(name, ext_id, members=[{"value": scim_user_id}])
                ),
                content_type=SCIM_CONTENT_TYPE,
            )
            assert resp.status_code == 201

        scim_user = SCIMUser.objects.get(id=scim_user_id)
        assert TeamMembership.objects.filter(org_member=scim_user.org_member).count() == 2

        # Deactivate user (Okta PUT style)
        deactivate_payload = make_scim_user_payload(
            "regroup@example.com", "regroup-ext", active=False
        )
        resp = scim_client.put(
            f"{USERS_URL}/{scim_user_id}",
            data=json.dumps(deactivate_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        # All team memberships should be cleared
        assert TeamMembership.objects.filter(org_member=scim_user.org_member).count() == 0

        # Reactivate user
        reactivate_payload = make_scim_user_payload(
            "regroup@example.com", "regroup-ext", active=True
        )
        resp = scim_client.put(
            f"{USERS_URL}/{scim_user_id}",
            data=json.dumps(reactivate_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200
        scim_user.refresh_from_db()
        assert scim_user.active is True

        # Still no team memberships (IdP hasn't re-pushed yet)
        assert TeamMembership.objects.filter(org_member=scim_user.org_member).count() == 0

        # IdP re-pushes Group A only (simulating user was removed from B while deactivated)
        group_a = SCIMGroup.objects.get(external_id="grp-a-ext")
        add_payload = make_patch_op([
            {"op": "Add", "path": "members", "value": [{"value": scim_user_id}]}
        ])
        resp = scim_client.patch(
            f"{GROUPS_URL}/{group_a.id}",
            data=json.dumps(add_payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        # Verify: in Group A's team, NOT in Group B's team
        group_b = SCIMGroup.objects.get(external_id="grp-b-ext")
        assert TeamMembership.objects.filter(
            team=group_a.team, org_member=scim_user.org_member
        ).exists()
        assert not TeamMembership.objects.filter(
            team=group_b.team, org_member=scim_user.org_member
        ).exists()


# ---------------------------------------------------------------------------
# Scenario 9.3: Entra ID group removal triggers user deprovisioning
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestEntraGroupRemovalThenUserDeactivation:
    """
    Entra ID's deprovisioning sequence:
    1. PATCH /Groups/:id — remove member from group
    2. PATCH /Users/:id — deactivate user (arrives ~10-30s later)
    """

    def test_entra_deprovisioning_sequence(
        self, scim_client, scim_token, developer_role, organisation
    ):
        # Provision user and group
        user_resp = scim_client.post(
            USERS_URL,
            data=json.dumps(
                make_scim_user_payload("entra-flow@example.com", "entra-flow-ext")
            ),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_user_id = user_resp.json()["id"]

        group_resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(
                make_scim_group_payload(
                    "Entra Team", "entra-team-ext",
                    members=[{"value": scim_user_id}],
                )
            ),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_group_id = group_resp.json()["id"]

        # Step 1: Entra removes user from group
        resp = scim_client.patch(
            f"{GROUPS_URL}/{scim_group_id}",
            data=json.dumps(make_patch_op([
                {"op": "Remove", "path": f'members[value eq "{scim_user_id}"]'}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        # User still active but not in team
        scim_user = SCIMUser.objects.get(id=scim_user_id)
        assert scim_user.active is True
        assert not TeamMembership.objects.filter(
            org_member=scim_user.org_member
        ).exists()

        # Step 2: Entra deactivates user (arrives later)
        resp = scim_client.patch(
            f"{USERS_URL}/{scim_user_id}",
            data=json.dumps(make_patch_op([
                {"op": "Replace", "path": "active", "value": "False"}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        # Verify final state
        scim_user.refresh_from_db()
        assert scim_user.active is False
        scim_user.org_member.refresh_from_db()
        assert scim_user.org_member.deleted_at is not None

        # Verify event sequence
        events = list(
            SCIMEvent.objects.filter(organisation=organisation)
            .order_by("timestamp")
            .values_list("event_type", flat=True)
        )
        assert "member_removed" in events
        assert "user_deactivated" in events
        # member_removed should come before user_deactivated
        assert events.index("member_removed") < events.index("user_deactivated")


# ---------------------------------------------------------------------------
# Scenario: Multiple groups, single user — membership isolation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMultiGroupMembership:
    """Removing a user from one group should not affect their membership in other groups."""

    def test_remove_from_one_group_preserves_other(
        self, scim_client, scim_token, developer_role, organisation
    ):
        # Provision user
        user_resp = scim_client.post(
            USERS_URL,
            data=json.dumps(make_scim_user_payload("multi@example.com", "multi-ext")),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_user_id = user_resp.json()["id"]

        # Create two groups with the same user
        group_ids = []
        for name, ext_id in [("Team Alpha", "alpha-ext"), ("Team Beta", "beta-ext")]:
            resp = scim_client.post(
                GROUPS_URL,
                data=json.dumps(
                    make_scim_group_payload(name, ext_id, members=[{"value": scim_user_id}])
                ),
                content_type=SCIM_CONTENT_TYPE,
            )
            group_ids.append(resp.json()["id"])

        scim_user = SCIMUser.objects.get(id=scim_user_id)
        assert TeamMembership.objects.filter(org_member=scim_user.org_member).count() == 2

        # Remove from Team Alpha only
        resp = scim_client.patch(
            f"{GROUPS_URL}/{group_ids[0]}",
            data=json.dumps(make_patch_op([
                {"op": "Remove", "path": f'members[value eq "{scim_user_id}"]'}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        # Verify: removed from Alpha, still in Beta
        assert TeamMembership.objects.filter(org_member=scim_user.org_member).count() == 1
        beta_group = SCIMGroup.objects.get(id=group_ids[1])
        assert TeamMembership.objects.filter(
            team=beta_group.team, org_member=scim_user.org_member
        ).exists()


# ---------------------------------------------------------------------------
# Scenario: Provision user → link to existing account → verify preservation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestProvisionExistingAccount:
    """When SCIM provisions a user whose email already exists as a CustomUser,
    the existing account should be linked without data loss."""

    def test_existing_user_linked_preserves_data(
        self, scim_client, scim_token, developer_role, organisation
    ):
        # Pre-existing user (e.g. signed up manually before SCIM)
        existing_user = CustomUser.objects.create(
            username="veteran@example.com", email="veteran@example.com"
        )
        existing_user.set_password("some-password")
        existing_user.save()

        # SCIM provisions this email
        payload = make_scim_user_payload("veteran@example.com", "veteran-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201

        # Verify link to existing user
        scim_user = SCIMUser.objects.get(id=resp.json()["id"])
        assert str(scim_user.user.userId) == str(existing_user.userId)
        # Existing password should still be set
        existing_user.refresh_from_db()
        assert existing_user.has_usable_password() is True
        # No duplicate CustomUser
        assert CustomUser.objects.filter(email="veteran@example.com").count() == 1


# ---------------------------------------------------------------------------
# Scenario: Group created empty, members added later
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGroupCreatedEmptyThenPopulated:
    """IdPs sometimes create the group first, then add members in subsequent PATCH calls."""

    def test_empty_group_then_add_members(
        self, scim_client, scim_token, developer_role, organisation
    ):
        # Create user
        user_resp = scim_client.post(
            USERS_URL,
            data=json.dumps(make_scim_user_payload("latejoin@example.com", "latejoin-ext")),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_user_id = user_resp.json()["id"]

        # Create empty group
        group_resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(make_scim_group_payload("Empty First", "empty-ext")),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert group_resp.status_code == 201
        scim_group_id = group_resp.json()["id"]
        assert group_resp.json()["members"] == []

        # Add member via PATCH
        resp = scim_client.patch(
            f"{GROUPS_URL}/{scim_group_id}",
            data=json.dumps(make_patch_op([
                {"op": "Add", "path": "members", "value": [{"value": scim_user_id}]}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 200

        scim_group = SCIMGroup.objects.get(id=scim_group_id)
        assert scim_group.team.memberships.count() == 1


# ---------------------------------------------------------------------------
# Scenario: Cross-org isolation
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCrossOrgIsolation:
    """SCIM operations on one org should not affect another org's data."""

    def test_cannot_access_other_org_users(
        self, scim_client, scim_token, developer_role, organisation
    ):
        # Create a user in our org
        payload = make_scim_user_payload("ouruser@example.com", "our-ext")
        resp = scim_client.post(
            USERS_URL,
            data=json.dumps(payload),
            content_type=SCIM_CONTENT_TYPE,
        )
        assert resp.status_code == 201
        our_user_id = resp.json()["id"]

        # Create another org and a user in it (directly in DB)
        from api.models import Role

        other_org = Organisation.objects.create(
            name="OtherOrg", identity_key="other-key", plan="EN", scim_enabled=True
        )
        other_role = Role.objects.create(
            name="Developer", organisation=other_org, is_default=True, permissions={}
        )
        other_user = CustomUser.objects.create(
            username="other@example.com", email="other@example.com"
        )
        other_om = OrganisationMember.objects.create(
            user=other_user,
            organisation=other_org,
            role=other_role,
            identity_key="",
            wrapped_keyring="",
            wrapped_recovery="",
        )
        other_scim_user = SCIMUser.objects.create(
            external_id="other-ext",
            organisation=other_org,
            user=other_user,
            org_member=other_om,
            email="other@example.com",
            display_name="Other User",
            active=True,
        )

        # Our token should not see the other org's user
        resp = scim_client.get(f"{USERS_URL}/{other_scim_user.id}")
        assert resp.status_code == 404

        # List should only show our user
        resp = scim_client.get(USERS_URL)
        assert resp.json()["totalResults"] == 1
        assert resp.json()["Resources"][0]["id"] == our_user_id


# ---------------------------------------------------------------------------
# Scenario: Audit trail completeness
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAuditTrailCompleteness:
    """Every state-changing SCIM operation should produce at least one SCIMEvent."""

    def test_all_operations_logged(
        self, scim_client, scim_token, developer_role, organisation
    ):
        SCIMEvent.objects.filter(organisation=organisation).delete()

        # Create user
        user_resp = scim_client.post(
            USERS_URL,
            data=json.dumps(make_scim_user_payload("audit@example.com", "audit-ext")),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_user_id = user_resp.json()["id"]

        # Create empty group, then add member via PATCH (to generate member_added event)
        group_resp = scim_client.post(
            GROUPS_URL,
            data=json.dumps(make_scim_group_payload("Audit Team", "audit-grp-ext")),
            content_type=SCIM_CONTENT_TYPE,
        )
        scim_group_id = group_resp.json()["id"]

        # Add member via PATCH (generates member_added event)
        scim_client.patch(
            f"{GROUPS_URL}/{scim_group_id}",
            data=json.dumps(make_patch_op([
                {"op": "Add", "path": "members", "value": [{"value": scim_user_id}]}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )

        # Update user (PUT)
        scim_client.put(
            f"{USERS_URL}/{scim_user_id}",
            data=json.dumps(make_scim_user_payload(
                "audit@example.com", "audit-ext", display_name="Audit Updated"
            )),
            content_type=SCIM_CONTENT_TYPE,
        )

        # Rename group
        scim_client.patch(
            f"{GROUPS_URL}/{scim_group_id}",
            data=json.dumps(make_patch_op([
                {"op": "Replace", "path": "displayName", "value": "Audit Team v2"}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )

        # Remove user from group
        scim_client.patch(
            f"{GROUPS_URL}/{scim_group_id}",
            data=json.dumps(make_patch_op([
                {"op": "Remove", "path": f'members[value eq "{scim_user_id}"]'}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )

        # Deactivate user
        scim_client.patch(
            f"{USERS_URL}/{scim_user_id}",
            data=json.dumps(make_patch_op([
                {"op": "Replace", "path": "active", "value": "False"}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )

        # Reactivate user
        scim_client.patch(
            f"{USERS_URL}/{scim_user_id}",
            data=json.dumps(make_patch_op([
                {"op": "Replace", "path": "active", "value": "True"}
            ])),
            content_type=SCIM_CONTENT_TYPE,
        )

        # Delete group
        scim_client.delete(f"{GROUPS_URL}/{scim_group_id}")

        # Delete user
        scim_client.delete(f"{USERS_URL}/{scim_user_id}")

        # Verify all event types were logged
        event_types = set(
            SCIMEvent.objects.filter(organisation=organisation)
            .values_list("event_type", flat=True)
        )
        expected = {
            "user_created",
            "user_updated",
            "user_deactivated",
            "user_reactivated",
            "group_created",
            "group_updated",
            "group_deleted",
            "member_added",
            "member_removed",
        }
        assert expected.issubset(event_types), f"Missing events: {expected - event_types}"

        # Verify all events have required fields
        for event in SCIMEvent.objects.filter(organisation=organisation):
            assert event.scim_token is not None
            assert event.event_type != ""
            assert event.resource_type in ("user", "group")
            assert event.request_method != ""
