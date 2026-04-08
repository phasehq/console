"""Tests for SCIM provisioning utility functions.

Covers: provision_scim_user, deactivate_scim_user, reactivate_scim_user.
"""

import pytest
from django.utils import timezone

from api.models import (
    CustomUser,
    OrganisationMember,
    SCIMUser,
    Team,
    TeamMembership,
)
from ee.authentication.scim.utils import (
    deactivate_scim_user,
    provision_scim_user,
    reactivate_scim_user,
)


# ---------------------------------------------------------------------------
# provision_scim_user
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestProvisionScimUser:

    def test_creates_new_user_and_org_member(self, organisation, developer_role):
        scim_user = provision_scim_user(
            organisation=organisation,
            external_id="new-ext-1",
            email="newuser@example.com",
            display_name="New User",
        )
        assert scim_user.email == "newuser@example.com"
        assert scim_user.active is True
        assert scim_user.user is not None
        assert scim_user.org_member is not None
        assert scim_user.org_member.role.name == "Developer"

    def test_new_user_has_unusable_password(self, organisation, developer_role):
        scim_user = provision_scim_user(
            organisation=organisation,
            external_id="pwd-ext",
            email="nopwd@example.com",
            display_name="No Pwd",
        )
        assert scim_user.user.has_usable_password() is False

    def test_new_user_has_empty_crypto_material(self, organisation, developer_role):
        scim_user = provision_scim_user(
            organisation=organisation,
            external_id="crypto-ext",
            email="crypto@example.com",
            display_name="Crypto Test",
        )
        assert scim_user.org_member.identity_key == ""
        assert scim_user.org_member.wrapped_keyring == ""
        assert scim_user.org_member.wrapped_recovery == ""

    def test_email_normalized_to_lowercase(self, organisation, developer_role):
        scim_user = provision_scim_user(
            organisation=organisation,
            external_id="case-ext",
            email="UPPER@EXAMPLE.COM",
            display_name="Case Test",
        )
        assert scim_user.email == "upper@example.com"

    def test_links_existing_custom_user(self, organisation, developer_role):
        existing_user = CustomUser.objects.create(
            username="existing@example.com",
            email="existing@example.com",
        )
        scim_user = provision_scim_user(
            organisation=organisation,
            external_id="existing-ext",
            email="existing@example.com",
            display_name="Existing",
        )
        assert str(scim_user.user.userId) == str(existing_user.userId)
        # Should not create a duplicate CustomUser
        assert CustomUser.objects.filter(email="existing@example.com").count() == 1

    def test_reactivates_soft_deleted_org_member(self, organisation, developer_role):
        user = CustomUser.objects.create(
            username="softdel@example.com", email="softdel@example.com"
        )
        org_member = OrganisationMember.objects.create(
            user=user,
            organisation=organisation,
            role=developer_role,
            identity_key="old-key",
            wrapped_keyring="old-keyring",
            wrapped_recovery="old-recovery",
            deleted_at=timezone.now(),
        )
        scim_user = provision_scim_user(
            organisation=organisation,
            external_id="softdel-ext",
            email="softdel@example.com",
            display_name="Soft Deleted",
        )
        assert str(scim_user.org_member.id) == str(org_member.id)
        org_member.refresh_from_db()
        assert org_member.deleted_at is None

    def test_stores_scim_data(self, organisation, developer_role):
        scim_data = {"userName": "data@example.com", "custom": "field"}
        scim_user = provision_scim_user(
            organisation=organisation,
            external_id="data-ext",
            email="data@example.com",
            display_name="Data Test",
            scim_data=scim_data,
        )
        assert scim_user.scim_data == scim_data


# ---------------------------------------------------------------------------
# deactivate_scim_user
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDeactivateScimUser:

    def test_sets_active_false(self, scim_user_alice):
        deactivate_scim_user(scim_user_alice)
        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is False

    def test_soft_deletes_org_member(self, scim_user_alice):
        deactivate_scim_user(scim_user_alice)
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is not None

    def test_wipes_crypto_material(self, scim_user_alice):
        scim_user_alice.org_member.identity_key = "some-key"
        scim_user_alice.org_member.wrapped_keyring = "some-keyring"
        scim_user_alice.org_member.wrapped_recovery = "some-recovery"
        scim_user_alice.org_member.save()

        deactivate_scim_user(scim_user_alice)
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.identity_key == ""
        assert scim_user_alice.org_member.wrapped_keyring == ""
        assert scim_user_alice.org_member.wrapped_recovery == ""

    def test_deletes_team_memberships(self, scim_user_alice, scim_group_engineering):
        assert TeamMembership.objects.filter(
            org_member=scim_user_alice.org_member
        ).exists()

        deactivate_scim_user(scim_user_alice)

        assert not TeamMembership.objects.filter(
            org_member=scim_user_alice.org_member
        ).exists()

    def test_does_not_delete_custom_user(self, scim_user_alice):
        user_id = scim_user_alice.user.userId
        deactivate_scim_user(scim_user_alice)
        assert CustomUser.objects.filter(userId=user_id).exists()

    def test_does_not_affect_other_members_team_membership(
        self, scim_user_alice, scim_user_bob, scim_group_engineering
    ):
        """Deactivating Alice should not remove Bob from the team."""
        deactivate_scim_user(scim_user_alice)
        assert TeamMembership.objects.filter(
            team=scim_group_engineering.team,
            org_member=scim_user_bob.org_member,
        ).exists()


# ---------------------------------------------------------------------------
# reactivate_scim_user
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReactivateScimUser:

    def test_sets_active_true(self, scim_user_alice):
        deactivate_scim_user(scim_user_alice)
        reactivate_scim_user(scim_user_alice)
        scim_user_alice.refresh_from_db()
        assert scim_user_alice.active is True

    def test_clears_deleted_at(self, scim_user_alice):
        deactivate_scim_user(scim_user_alice)
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is not None

        reactivate_scim_user(scim_user_alice)
        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.deleted_at is None

    def test_does_not_restore_team_memberships(
        self, scim_user_alice, scim_group_engineering
    ):
        """After deactivation clears team memberships, reactivation should NOT restore them.
        The IdP's group push will re-add the user to the correct teams."""
        deactivate_scim_user(scim_user_alice)
        assert not TeamMembership.objects.filter(
            org_member=scim_user_alice.org_member
        ).exists()

        reactivate_scim_user(scim_user_alice)
        # Still no team memberships — IdP must re-push
        assert not TeamMembership.objects.filter(
            org_member=scim_user_alice.org_member
        ).exists()

    def test_crypto_material_stays_empty(self, scim_user_alice):
        """Reactivation should not restore crypto material — user must redo key ceremony."""
        scim_user_alice.org_member.identity_key = "old-key"
        scim_user_alice.org_member.save()

        deactivate_scim_user(scim_user_alice)
        reactivate_scim_user(scim_user_alice)

        scim_user_alice.org_member.refresh_from_db()
        assert scim_user_alice.org_member.identity_key == ""
