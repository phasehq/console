"""Tests for SCIM provisioning utility functions — fully mocked, no database.

Covers: provision_scim_user, deactivate_scim_user, reactivate_scim_user.
"""

from unittest.mock import MagicMock, call, patch

import pytest
from django.utils import timezone

from .conftest import make_mock_org_member, make_mock_organisation, make_mock_scim_user, make_mock_user

# Patch targets — where names are looked up in utils.py
_P = "ee.authentication.scim.utils"


# ---------------------------------------------------------------------------
# provision_scim_user
# ---------------------------------------------------------------------------


class TestProvisionScimUser:

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_creates_new_user_and_org_member(
        self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser
    ):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        role = MagicMock(name="Developer")
        MockRole.objects.get.return_value = role
        MockCustomUser.objects.filter.return_value.first.return_value = None
        MockOrgMember.objects.filter.return_value.first.return_value = None

        new_user = make_mock_user(email="new@example.com")
        MockCustomUser.objects.create.return_value = new_user

        new_member = make_mock_org_member(user=new_user, organisation=org)
        MockOrgMember.objects.create.return_value = new_member

        scim_user = MagicMock()
        MockSCIMUser.objects.create.return_value = scim_user

        result = provision_scim_user(org, "ext-1", "new@example.com", "New User")

        assert result is scim_user
        MockCustomUser.objects.create.assert_called_once_with(
            username="new@example.com", email="new@example.com"
        )
        MockOrgMember.objects.create.assert_called_once()
        MockSCIMUser.objects.create.assert_called_once()

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_new_user_has_unusable_password(
        self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser
    ):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        MockRole.objects.get.return_value = MagicMock()
        MockCustomUser.objects.filter.return_value.first.return_value = None
        MockOrgMember.objects.filter.return_value.first.return_value = None

        new_user = make_mock_user()
        MockCustomUser.objects.create.return_value = new_user
        MockOrgMember.objects.create.return_value = make_mock_org_member()
        MockSCIMUser.objects.create.return_value = MagicMock()

        provision_scim_user(org, "ext", "test@example.com", "Test")

        new_user.set_unusable_password.assert_called_once()
        new_user.save.assert_called_once()

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_new_user_has_empty_crypto_material(
        self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser
    ):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        MockRole.objects.get.return_value = MagicMock()
        MockCustomUser.objects.filter.return_value.first.return_value = None
        MockOrgMember.objects.filter.return_value.first.return_value = None

        MockCustomUser.objects.create.return_value = make_mock_user()
        MockOrgMember.objects.create.return_value = make_mock_org_member()
        MockSCIMUser.objects.create.return_value = MagicMock()

        provision_scim_user(org, "ext", "test@example.com", "Test")

        create_kwargs = MockOrgMember.objects.create.call_args
        assert create_kwargs[1]["identity_key"] == ""
        assert create_kwargs[1]["wrapped_keyring"] == ""
        assert create_kwargs[1]["wrapped_recovery"] == ""

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_email_normalized_to_lowercase(
        self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser
    ):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        MockRole.objects.get.return_value = MagicMock()
        MockCustomUser.objects.filter.return_value.first.return_value = None
        MockOrgMember.objects.filter.return_value.first.return_value = None
        MockCustomUser.objects.create.return_value = make_mock_user()
        MockOrgMember.objects.create.return_value = make_mock_org_member()
        MockSCIMUser.objects.create.return_value = MagicMock()

        provision_scim_user(org, "ext", "UPPER@EXAMPLE.COM", "Test")

        create_kwargs = MockSCIMUser.objects.create.call_args
        assert create_kwargs[1]["email"] == "upper@example.com"

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_links_existing_custom_user(
        self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser
    ):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        MockRole.objects.get.return_value = MagicMock()

        existing_user = make_mock_user(email="existing@example.com")
        MockCustomUser.objects.filter.return_value.first.return_value = existing_user
        MockOrgMember.objects.filter.return_value.first.return_value = None
        MockOrgMember.objects.create.return_value = make_mock_org_member(user=existing_user)
        MockSCIMUser.objects.create.return_value = MagicMock()

        provision_scim_user(org, "ext", "existing@example.com", "Existing")

        MockCustomUser.objects.create.assert_not_called()
        scim_create_kwargs = MockSCIMUser.objects.create.call_args[1]
        assert scim_create_kwargs["user"] is existing_user

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_reactivates_soft_deleted_org_member(
        self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser
    ):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        MockRole.objects.get.return_value = MagicMock()

        existing_user = make_mock_user(email="softdel@example.com")
        MockCustomUser.objects.filter.return_value.first.return_value = existing_user

        soft_deleted_member = make_mock_org_member(
            user=existing_user, organisation=org, deleted_at=timezone.now()
        )
        MockOrgMember.objects.filter.return_value.first.return_value = soft_deleted_member
        MockSCIMUser.objects.create.return_value = MagicMock()

        provision_scim_user(org, "ext", "softdel@example.com", "Soft Del")

        assert soft_deleted_member.deleted_at is None
        soft_deleted_member.save.assert_called_once_with(update_fields=["deleted_at"])
        MockOrgMember.objects.create.assert_not_called()

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_stores_scim_data(self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        MockRole.objects.get.return_value = MagicMock()
        MockCustomUser.objects.filter.return_value.first.return_value = None
        MockOrgMember.objects.filter.return_value.first.return_value = None
        MockCustomUser.objects.create.return_value = make_mock_user()
        MockOrgMember.objects.create.return_value = make_mock_org_member()
        MockSCIMUser.objects.create.return_value = MagicMock()

        scim_data = {"userName": "data@example.com", "custom": "field"}
        provision_scim_user(org, "ext", "data@example.com", "Data", scim_data=scim_data)

        create_kwargs = MockSCIMUser.objects.create.call_args[1]
        assert create_kwargs["scim_data"] is scim_data

    @patch(f"{_P}.SCIMUser")
    @patch(f"{_P}.OrganisationMember")
    @patch(f"{_P}.CustomUser")
    @patch(f"{_P}.Role")
    def test_default_role_is_developer(
        self, MockRole, MockCustomUser, MockOrgMember, MockSCIMUser
    ):
        from ee.authentication.scim.utils import provision_scim_user

        org = make_mock_organisation()
        dev_role = MagicMock(name="Developer")
        MockRole.objects.get.return_value = dev_role
        MockCustomUser.objects.filter.return_value.first.return_value = None
        MockOrgMember.objects.filter.return_value.first.return_value = None
        MockCustomUser.objects.create.return_value = make_mock_user()
        MockOrgMember.objects.create.return_value = make_mock_org_member()
        MockSCIMUser.objects.create.return_value = MagicMock()

        provision_scim_user(org, "ext", "test@example.com", "Test")

        MockRole.objects.get.assert_called_once_with(organisation=org, name__iexact="developer")
        create_kwargs = MockOrgMember.objects.create.call_args[1]
        assert create_kwargs["role"] is dev_role


# ---------------------------------------------------------------------------
# deactivate_scim_user
# ---------------------------------------------------------------------------


class TestDeactivateScimUser:

    def _empty_qs(self):
        """Return a MagicMock that behaves like an empty queryset (iterable + .delete())."""
        qs = MagicMock()
        qs.__iter__ = MagicMock(return_value=iter([]))
        return qs

    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.TeamMembership")
    def test_sets_active_false(self, MockTM, mock_revoke):
        from ee.authentication.scim.utils import deactivate_scim_user

        scim_user = make_mock_scim_user(active=True)
        MockTM.objects.filter.return_value.select_related.return_value = self._empty_qs()

        deactivate_scim_user(scim_user)

        assert scim_user.active is False
        scim_user.save.assert_called_with(update_fields=["active"])

    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.TeamMembership")
    def test_soft_deletes_org_member(self, MockTM, mock_revoke):
        from ee.authentication.scim.utils import deactivate_scim_user

        scim_user = make_mock_scim_user()
        MockTM.objects.filter.return_value.select_related.return_value = self._empty_qs()

        deactivate_scim_user(scim_user)

        assert scim_user.org_member.deleted_at is not None
        scim_user.org_member.save.assert_called()

    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.TeamMembership")
    def test_wipes_crypto_material(self, MockTM, mock_revoke):
        from ee.authentication.scim.utils import deactivate_scim_user

        scim_user = make_mock_scim_user()
        scim_user.org_member.identity_key = "some-key"
        scim_user.org_member.wrapped_keyring = "some-keyring"
        scim_user.org_member.wrapped_recovery = "some-recovery"
        MockTM.objects.filter.return_value.select_related.return_value = self._empty_qs()

        deactivate_scim_user(scim_user)

        assert scim_user.org_member.identity_key == ""
        assert scim_user.org_member.wrapped_keyring == ""
        assert scim_user.org_member.wrapped_recovery == ""

    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.TeamMembership")
    def test_revokes_keys_and_deletes_team_memberships(self, MockTM, mock_revoke):
        from ee.authentication.scim.utils import deactivate_scim_user

        scim_user = make_mock_scim_user()
        team1 = MagicMock(name="Team1")
        tm1 = MagicMock(team=team1)
        team2 = MagicMock(name="Team2")
        tm2 = MagicMock(team=team2)

        qs = MagicMock()
        qs.__iter__ = MagicMock(return_value=iter([tm1, tm2]))
        MockTM.objects.filter.return_value.select_related.return_value = qs

        deactivate_scim_user(scim_user)

        mock_revoke.assert_any_call(team1, member=scim_user.org_member)
        mock_revoke.assert_any_call(team2, member=scim_user.org_member)
        assert mock_revoke.call_count == 2
        qs.delete.assert_called_once()

    @patch(f"{_P}.revoke_team_environment_keys")
    @patch(f"{_P}.TeamMembership")
    def test_no_org_member_is_safe(self, MockTM, mock_revoke):
        """If org_member is None, deactivation should still set active=False."""
        from ee.authentication.scim.utils import deactivate_scim_user

        scim_user = make_mock_scim_user()
        scim_user.org_member = None

        deactivate_scim_user(scim_user)

        assert scim_user.active is False
        MockTM.objects.filter.assert_not_called()


# ---------------------------------------------------------------------------
# reactivate_scim_user
# ---------------------------------------------------------------------------


class TestReactivateScimUser:

    def test_sets_active_true(self):
        from ee.authentication.scim.utils import reactivate_scim_user

        scim_user = make_mock_scim_user(active=False)
        scim_user.org_member.deleted_at = "2025-01-01"

        reactivate_scim_user(scim_user)

        assert scim_user.active is True
        scim_user.save.assert_called_with(update_fields=["active"])

    def test_clears_deleted_at(self):
        from ee.authentication.scim.utils import reactivate_scim_user

        scim_user = make_mock_scim_user(active=False)
        scim_user.org_member.deleted_at = "2025-01-01"

        reactivate_scim_user(scim_user)

        assert scim_user.org_member.deleted_at is None
        scim_user.org_member.save.assert_called_with(update_fields=["deleted_at"])

    def test_no_op_if_org_member_not_deleted(self):
        from ee.authentication.scim.utils import reactivate_scim_user

        scim_user = make_mock_scim_user(active=False)
        scim_user.org_member.deleted_at = None

        reactivate_scim_user(scim_user)

        assert scim_user.active is True
        # org_member.save should NOT be called because deleted_at was already None
        scim_user.org_member.save.assert_not_called()

    def test_no_org_member_is_safe(self):
        from ee.authentication.scim.utils import reactivate_scim_user

        scim_user = make_mock_scim_user(active=False)
        scim_user.org_member = None

        reactivate_scim_user(scim_user)

        assert scim_user.active is True
