import pytest
from unittest.mock import MagicMock, patch, call, PropertyMock


class TestTransferOrganisationOwnershipMutation:
    """Tests for the TransferOrganisationOwnershipMutation GraphQL mutation."""

    def _get_mutation_class(self):
        from backend.graphene.mutations.organisation import (
            TransferOrganisationOwnershipMutation,
        )

        return TransferOrganisationOwnershipMutation

    def _make_info(self, user):
        info = MagicMock()
        info.context.user = user
        return info

    def _make_role(self, name, is_default=True, has_global_access=True):
        role = MagicMock()
        role.name = name
        role.is_default = is_default
        if not is_default:
            role.permissions = {"global_access": has_global_access}
        return role

    def _make_member(self, member_id, user, role, identity_key="test_key"):
        member = MagicMock()
        member.id = member_id
        member.user = user
        member.role = role
        member.identity_key = identity_key
        return member

    @patch("backend.graphene.mutations.organisation.send_ownership_transferred_email")
    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.Role")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_successful_transfer(
        self,
        MockOrganisation,
        MockOrgMember,
        MockRole,
        mock_role_has_global_access,
        mock_send_email,
    ):
        """Test successful ownership transfer between owner and admin."""
        mutation = self._get_mutation_class()

        # Setup
        org = MagicMock()
        org.id = "org-1"
        org.name = "TestOrg"
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        user.email = "owner@test.com"

        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member("member-1", user, owner_role)
        new_owner_user = MagicMock()
        new_owner_user.email = "admin@test.com"
        new_owner_member = self._make_member(
            "member-2", new_owner_user, admin_role, identity_key="new_owner_key"
        )

        MockOrgMember.objects.get.side_effect = [current_member, new_owner_member]
        mock_role_has_global_access.return_value = True

        owner_role_obj = MagicMock()
        admin_role_obj = MagicMock()
        MockRole.objects.get.side_effect = [owner_role_obj, admin_role_obj]

        info = self._make_info(user)

        # Execute
        with patch("backend.graphene.mutations.organisation.settings") as mock_settings:
            mock_settings.APP_HOST = "self-hosted"
            result = mutation.mutate(None, info, "org-1", "member-2")

        # Verify
        assert result.ok is True

        # New owner should get owner role
        assert new_owner_member.role == owner_role_obj
        new_owner_member.save.assert_called()

        # Org identity key should be updated
        assert org.identity_key == "new_owner_key"
        org.save.assert_called()

        # Current owner should be demoted to admin
        assert current_member.role == admin_role_obj
        current_member.save.assert_called()

        # Emails should be sent
        mock_send_email.assert_called_once_with(org, current_member, new_owner_member)

    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_non_owner_cannot_transfer(self, MockOrganisation, MockOrgMember):
        """Test that a non-owner member cannot initiate a transfer."""
        from graphql import GraphQLError

        mutation = self._get_mutation_class()

        org = MagicMock()
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        admin_role = self._make_role("Admin")
        current_member = self._make_member("member-1", user, admin_role)
        MockOrgMember.objects.get.return_value = current_member

        info = self._make_info(user)

        with pytest.raises(GraphQLError, match="Only the organisation owner"):
            mutation.mutate(None, info, "org-1", "member-2")

    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_cannot_transfer_to_self(self, MockOrganisation, MockOrgMember):
        """Test that an owner cannot transfer ownership to themselves."""
        from graphql import GraphQLError

        mutation = self._get_mutation_class()

        org = MagicMock()
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        current_member = self._make_member("member-1", user, owner_role)

        # Both calls return the same member (simulating transfer to self)
        MockOrgMember.objects.get.side_effect = [current_member, current_member]

        info = self._make_info(user)

        with pytest.raises(GraphQLError, match="cannot transfer ownership to yourself"):
            mutation.mutate(None, info, "org-1", "member-1")

    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_cannot_transfer_to_non_global_access_member(
        self, MockOrganisation, MockOrgMember, mock_role_has_global_access
    ):
        """Test that ownership cannot be transferred to a member without global access."""
        from graphql import GraphQLError

        mutation = self._get_mutation_class()

        org = MagicMock()
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        developer_role = self._make_role("Developer")

        current_member = self._make_member("member-1", user, owner_role)
        target_user = MagicMock()
        target_member = self._make_member("member-2", target_user, developer_role)

        MockOrgMember.objects.get.side_effect = [current_member, target_member]
        mock_role_has_global_access.return_value = False

        info = self._make_info(user)

        with pytest.raises(GraphQLError, match="must have global access"):
            mutation.mutate(None, info, "org-1", "member-2")

    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_cannot_transfer_to_member_with_null_identity_key(
        self, MockOrganisation, MockOrgMember, mock_role_has_global_access
    ):
        """Test that ownership cannot be transferred to a member with a NULL identity_key."""
        from graphql import GraphQLError

        mutation = self._get_mutation_class()

        org = MagicMock()
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member("member-1", user, owner_role)
        target_user = MagicMock()
        target_member = self._make_member(
            "member-2", target_user, admin_role, identity_key=None
        )

        MockOrgMember.objects.get.side_effect = [current_member, target_member]
        mock_role_has_global_access.return_value = True

        info = self._make_info(user)

        with pytest.raises(GraphQLError, match="does not have a valid identity key"):
            mutation.mutate(None, info, "org-1", "member-2")

    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_cannot_transfer_to_member_with_empty_identity_key(
        self, MockOrganisation, MockOrgMember, mock_role_has_global_access
    ):
        """Test that ownership cannot be transferred to a member with an empty identity_key."""
        from graphql import GraphQLError

        mutation = self._get_mutation_class()

        org = MagicMock()
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member("member-1", user, owner_role)
        target_user = MagicMock()
        target_member = self._make_member(
            "member-2", target_user, admin_role, identity_key=""
        )

        MockOrgMember.objects.get.side_effect = [current_member, target_member]
        mock_role_has_global_access.return_value = True

        info = self._make_info(user)

        with pytest.raises(GraphQLError, match="does not have a valid identity key"):
            mutation.mutate(None, info, "org-1", "member-2")

    @patch("backend.graphene.mutations.organisation.send_ownership_transferred_email")
    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.Role")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_stripe_email_updated_in_cloud_mode(
        self,
        MockOrganisation,
        MockOrgMember,
        MockRole,
        mock_role_has_global_access,
        mock_send_email,
    ):
        """Test that Stripe customer email is updated when running in cloud mode."""
        mutation = self._get_mutation_class()

        org = MagicMock()
        org.id = "org-1"
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member("member-1", user, owner_role)
        new_owner_user = MagicMock()
        new_owner_user.email = "newowner@test.com"
        new_owner_member = self._make_member("member-2", new_owner_user, admin_role)

        MockOrgMember.objects.get.side_effect = [current_member, new_owner_member]
        mock_role_has_global_access.return_value = True
        MockRole.objects.get.side_effect = [MagicMock(), MagicMock()]

        info = self._make_info(user)

        with patch("backend.graphene.mutations.organisation.settings") as mock_settings:
            mock_settings.APP_HOST = "cloud"
            with patch(
                "ee.billing.stripe.update_stripe_customer_email"
            ) as mock_stripe:
                result = mutation.mutate(None, info, "org-1", "member-2")

                mock_stripe.assert_called_once_with(org, "newowner@test.com")

        assert result.ok is True

    @patch("backend.graphene.mutations.organisation.send_ownership_transferred_email")
    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.Role")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_stripe_uses_custom_billing_email(
        self,
        MockOrganisation,
        MockOrgMember,
        MockRole,
        mock_role_has_global_access,
        mock_send_email,
    ):
        """Test that a custom billing email is used for Stripe when provided."""
        mutation = self._get_mutation_class()

        org = MagicMock()
        org.id = "org-1"
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member("member-1", user, owner_role)
        new_owner_user = MagicMock()
        new_owner_user.email = "newowner@test.com"
        new_owner_member = self._make_member("member-2", new_owner_user, admin_role)

        MockOrgMember.objects.get.side_effect = [current_member, new_owner_member]
        mock_role_has_global_access.return_value = True
        MockRole.objects.get.side_effect = [MagicMock(), MagicMock()]

        info = self._make_info(user)

        with patch("backend.graphene.mutations.organisation.settings") as mock_settings:
            mock_settings.APP_HOST = "cloud"
            with patch(
                "ee.billing.stripe.update_stripe_customer_email"
            ) as mock_stripe:
                result = mutation.mutate(
                    None, info, "org-1", "member-2", billing_email="billing@company.com"
                )

                mock_stripe.assert_called_once_with(org, "billing@company.com")

        assert result.ok is True

    @patch("backend.graphene.mutations.organisation.send_ownership_transferred_email")
    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.Role")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_stripe_not_called_in_self_hosted_mode(
        self,
        MockOrganisation,
        MockOrgMember,
        MockRole,
        mock_role_has_global_access,
        mock_send_email,
    ):
        """Test that Stripe is not updated when running in self-hosted mode."""
        mutation = self._get_mutation_class()

        org = MagicMock()
        org.id = "org-1"
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member("member-1", user, owner_role)
        new_owner_user = MagicMock()
        new_owner_member = self._make_member("member-2", new_owner_user, admin_role)

        MockOrgMember.objects.get.side_effect = [current_member, new_owner_member]
        mock_role_has_global_access.return_value = True
        MockRole.objects.get.side_effect = [MagicMock(), MagicMock()]

        info = self._make_info(user)

        with patch("backend.graphene.mutations.organisation.settings") as mock_settings:
            mock_settings.APP_HOST = "self-hosted"
            result = mutation.mutate(None, info, "org-1", "member-2")

        assert result.ok is True

    @patch("backend.graphene.mutations.organisation.send_ownership_transferred_email")
    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.Role")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_email_failure_does_not_break_transfer(
        self,
        MockOrganisation,
        MockOrgMember,
        MockRole,
        mock_role_has_global_access,
        mock_send_email,
    ):
        """Test that email sending failure doesn't prevent the transfer from completing."""
        mutation = self._get_mutation_class()

        org = MagicMock()
        org.id = "org-1"
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member("member-1", user, owner_role)
        new_owner_user = MagicMock()
        new_owner_member = self._make_member("member-2", new_owner_user, admin_role)

        MockOrgMember.objects.get.side_effect = [current_member, new_owner_member]
        mock_role_has_global_access.return_value = True
        MockRole.objects.get.side_effect = [MagicMock(), MagicMock()]

        # Email sending raises an exception
        mock_send_email.side_effect = Exception("SMTP error")

        info = self._make_info(user)

        with patch("backend.graphene.mutations.organisation.settings") as mock_settings:
            mock_settings.APP_HOST = "self-hosted"
            result = mutation.mutate(None, info, "org-1", "member-2")

        # Transfer should still succeed
        assert result.ok is True

    @patch("backend.graphene.mutations.organisation.send_ownership_transferred_email")
    @patch("backend.graphene.mutations.organisation.role_has_global_access")
    @patch("backend.graphene.mutations.organisation.Role")
    @patch("backend.graphene.mutations.organisation.OrganisationMember")
    @patch("backend.graphene.mutations.organisation.Organisation")
    def test_identity_key_updated_to_new_owner(
        self,
        MockOrganisation,
        MockOrgMember,
        MockRole,
        mock_role_has_global_access,
        mock_send_email,
    ):
        """Test that the organisation's identity_key is updated to the new owner's key."""
        mutation = self._get_mutation_class()

        org = MagicMock()
        org.id = "org-1"
        org.identity_key = "old_owner_key"
        MockOrganisation.objects.get.return_value = org

        user = MagicMock()
        owner_role = self._make_role("Owner")
        admin_role = self._make_role("Admin")

        current_member = self._make_member(
            "member-1", user, owner_role, identity_key="old_owner_key"
        )
        new_owner_user = MagicMock()
        new_owner_member = self._make_member(
            "member-2", new_owner_user, admin_role, identity_key="new_owner_key"
        )

        MockOrgMember.objects.get.side_effect = [current_member, new_owner_member]
        mock_role_has_global_access.return_value = True
        MockRole.objects.get.side_effect = [MagicMock(), MagicMock()]

        info = self._make_info(user)

        with patch("backend.graphene.mutations.organisation.settings") as mock_settings:
            mock_settings.APP_HOST = "self-hosted"
            result = mutation.mutate(None, info, "org-1", "member-2")

        assert org.identity_key == "new_owner_key"
        assert result.ok is True


class TestSendOwnershipTransferredEmail:
    """Tests for the email notification functions."""

    @patch("api.emails.send_email")
    @patch("api.emails.get_org_member_name")
    def test_sends_email_to_both_owners(self, mock_get_name, mock_send_email):
        from api.emails import send_ownership_transferred_email

        mock_get_name.side_effect = ["Old Owner", "New Owner"]

        org = MagicMock()
        org.name = "TestOrg"

        old_owner = MagicMock()
        old_owner.user.email = "old@test.com"

        new_owner = MagicMock()
        new_owner.user.email = "new@test.com"

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://app.phase.dev"}):
            send_ownership_transferred_email(org, old_owner, new_owner)

        # Should send 2 emails
        assert mock_send_email.call_count == 2

        # First call: email to old owner
        old_owner_call = mock_send_email.call_args_list[0]
        assert old_owner_call[0][0] == "Ownership transferred - TestOrg on Phase"
        assert old_owner_call[0][1] == ["old@test.com"]
        assert old_owner_call[0][2] == "api/ownership_transferred_old_owner.html"
        assert old_owner_call[0][3]["old_owner_name"] == "Old Owner"
        assert old_owner_call[0][3]["new_owner_name"] == "New Owner"
        assert old_owner_call[0][3]["new_owner_email"] == "new@test.com"

        # Second call: email to new owner
        new_owner_call = mock_send_email.call_args_list[1]
        assert new_owner_call[0][0] == "You are now the owner of TestOrg on Phase"
        assert new_owner_call[0][1] == ["new@test.com"]
        assert new_owner_call[0][2] == "api/ownership_transferred_new_owner.html"
        assert new_owner_call[0][3]["new_owner_name"] == "New Owner"
        assert new_owner_call[0][3]["old_owner_name"] == "Old Owner"
        assert new_owner_call[0][3]["old_owner_email"] == "old@test.com"

    @patch("api.emails.send_email")
    @patch("api.emails.get_org_member_name")
    def test_email_context_includes_correct_links(self, mock_get_name, mock_send_email):
        from api.emails import send_ownership_transferred_email

        mock_get_name.side_effect = ["Owner", "Admin"]

        org = MagicMock()
        org.name = "MyOrg"

        old_owner = MagicMock()
        old_owner.user.email = "old@test.com"

        new_owner = MagicMock()
        new_owner.user.email = "new@test.com"

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://console.phase.dev"}):
            send_ownership_transferred_email(org, old_owner, new_owner)

        # Old owner email should have members page link
        old_ctx = mock_send_email.call_args_list[0][0][3]
        assert (
            old_ctx["members_page_link"]
            == "https://console.phase.dev/MyOrg/access/members"
        )

        # New owner email should have org home link
        new_ctx = mock_send_email.call_args_list[1][0][3]
        assert new_ctx["org_home_link"] == "https://console.phase.dev/MyOrg"


class TestUpdateStripeCustomerEmail:
    """Tests for the update_stripe_customer_email function in ee/billing/stripe.py."""

    @patch("ee.billing.stripe.stripe")
    @patch("ee.billing.stripe.settings")
    def test_updates_stripe_customer_email(self, mock_settings, mock_stripe):
        from ee.billing.stripe import update_stripe_customer_email

        mock_settings.STRIPE = {"secret_key": "sk_test_123"}

        org = MagicMock()
        org.stripe_customer_id = "cus_123"

        update_stripe_customer_email(org, "new@test.com")

        mock_stripe.Customer.modify.assert_called_once_with(
            "cus_123", email="new@test.com"
        )

    @patch("ee.billing.stripe.stripe")
    @patch("ee.billing.stripe.settings")
    def test_skips_when_no_stripe_customer(self, mock_settings, mock_stripe):
        from ee.billing.stripe import update_stripe_customer_email

        mock_settings.STRIPE = {"secret_key": "sk_test_123"}

        org = MagicMock()
        org.stripe_customer_id = None

        update_stripe_customer_email(org, "new@test.com")

        mock_stripe.Customer.modify.assert_not_called()

    @patch("ee.billing.stripe.notify_slack")
    @patch("ee.billing.stripe.stripe")
    @patch("ee.billing.stripe.settings")
    def test_handles_stripe_api_error_gracefully(
        self, mock_settings, mock_stripe, mock_notify
    ):
        from ee.billing.stripe import update_stripe_customer_email

        mock_settings.STRIPE = {"secret_key": "sk_test_123"}
        mock_stripe.Customer.modify.side_effect = Exception("Stripe API error")

        org = MagicMock()
        org.stripe_customer_id = "cus_123"
        org.id = "org-1"

        # Should not raise
        update_stripe_customer_email(org, "new@test.com")

        mock_notify.assert_called_once()

    @patch("ee.billing.stripe.stripe")
    @patch("ee.billing.stripe.settings")
    def test_sets_stripe_api_key(self, mock_settings, mock_stripe):
        from ee.billing.stripe import update_stripe_customer_email

        mock_settings.STRIPE = {"secret_key": "sk_test_secret"}

        org = MagicMock()
        org.stripe_customer_id = "cus_123"

        update_stripe_customer_email(org, "new@test.com")

        assert mock_stripe.api_key == "sk_test_secret"
