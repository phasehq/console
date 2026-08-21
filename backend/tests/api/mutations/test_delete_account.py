"""Tests for permanent account deletion: readiness blockers, synchronous
lease revocation, and the DeleteAccountMutation execution order."""

import pytest
from unittest.mock import MagicMock, patch, ANY
from graphql import GraphQLError


def _make_user(email="alice@example.com"):
    user = MagicMock()
    user.userId = "uuid-user-1"
    user.email = email
    user.username = email
    user.full_name = "Alice Test"
    user.is_staff = False
    user.is_superuser = False
    return user


def _make_info(user):
    info = MagicMock()
    info.context.user = user
    return info


# ---------------------------------------------------------------------------
# Readiness blockers
# ---------------------------------------------------------------------------


@patch("backend.graphene.queries.account.SCIMUser")
@patch("backend.graphene.queries.account.OrganisationMember")
class TestAccountDeletionBlockers:
    def _compute(self, user):
        from backend.graphene.queries.account import compute_account_deletion_blockers

        return compute_account_deletion_blockers(user)

    def _membership(self, role_name, org_name="Acme"):
        membership = MagicMock()
        membership.role.name = role_name
        membership.organisation.id = f"org-{org_name}"
        membership.organisation.name = org_name
        return membership

    def _setup_memberships(self, mock_om, memberships, other_owner_count=0):
        def filter_side_effect(*args, **kwargs):
            result = MagicMock()
            if "organisation" in kwargs:
                # Other-owners count query
                result.exclude.return_value.count.return_value = other_owner_count
            else:
                result.select_related.return_value = memberships
            return result

        mock_om.objects.filter.side_effect = filter_side_effect

    def test_sole_owner_blocks(self, mock_om, mock_scim):
        user = _make_user()
        self._setup_memberships(
            mock_om, [self._membership("Owner")], other_owner_count=0
        )
        mock_scim.objects.filter.return_value.select_related.return_value = []

        blockers = self._compute(user)

        assert len(blockers) == 1
        assert blockers[0].kind == "sole_owner"
        assert blockers[0].organisation_name == "Acme"

    def test_co_owned_org_does_not_block(self, mock_om, mock_scim):
        user = _make_user()
        self._setup_memberships(
            mock_om, [self._membership("Owner")], other_owner_count=1
        )
        mock_scim.objects.filter.return_value.select_related.return_value = []

        blockers = self._compute(user)
        assert blockers == []

    def test_non_owner_roles_do_not_block(self, mock_om, mock_scim):
        user = _make_user()
        self._setup_memberships(
            mock_om,
            [self._membership("Developer"), self._membership("Admin", "Beta")],
        )
        mock_scim.objects.filter.return_value.select_related.return_value = []

        blockers = self._compute(user)
        assert blockers == []

    def test_active_scim_management_blocks(self, mock_om, mock_scim):
        user = _make_user()
        self._setup_memberships(mock_om, [self._membership("Developer")])
        scim_row = MagicMock()
        scim_row.organisation.id = "org-Acme"
        scim_row.organisation.name = "Acme"
        mock_scim.objects.filter.return_value.select_related.return_value = [scim_row]

        blockers = self._compute(user)
        assert len(blockers) == 1
        assert blockers[0].kind == "scim_managed"


# ---------------------------------------------------------------------------
# revoke_lease_now
# ---------------------------------------------------------------------------


class TestRevokeLeaseNow:
    def _lease(self, provider="aws"):
        lease = MagicMock()
        lease.id = "lease-1"
        lease.secret.provider = provider
        lease.cleanup_job_id = "job-1"
        return lease

    @patch("django_rq.get_scheduler")
    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_revokes_synchronously_and_cancels_job(self, mock_revoke, mock_scheduler):
        from backend.graphene.mutations.account import revoke_lease_now

        lease = self._lease()
        revoke_lease_now(lease)

        mock_revoke.assert_called_once_with("lease-1", manual=True)
        mock_scheduler.return_value.cancel.assert_called_once_with("job-1")

    @patch("django_rq.get_scheduler")
    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_already_revoked_is_idempotent(self, mock_revoke, mock_scheduler):
        from backend.graphene.mutations.account import revoke_lease_now
        from ee.integrations.secrets.dynamic.exceptions import LeaseAlreadyRevokedError

        mock_revoke.side_effect = LeaseAlreadyRevokedError("already revoked")
        revoke_lease_now(self._lease())  # must not raise
        mock_scheduler.return_value.cancel.assert_called_once()

    @patch("django_rq.get_scheduler")
    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_provider_failure_raises_graphql_error(self, mock_revoke, mock_scheduler):
        from backend.graphene.mutations.account import revoke_lease_now

        mock_revoke.side_effect = RuntimeError("aws down")
        with pytest.raises(GraphQLError):
            revoke_lease_now(self._lease())

    @patch("django_rq.get_scheduler")
    @patch("ee.integrations.secrets.dynamic.aws.utils.revoke_aws_dynamic_secret_lease")
    def test_unknown_provider_is_skipped(self, mock_revoke, mock_scheduler):
        from backend.graphene.mutations.account import revoke_lease_now

        revoke_lease_now(self._lease(provider="gcp"))
        mock_revoke.assert_not_called()
        mock_scheduler.return_value.cancel.assert_not_called()


# ---------------------------------------------------------------------------
# DeleteAccountMutation
# ---------------------------------------------------------------------------


@patch("backend.graphene.mutations.account.logout")
@patch(
    "backend.graphene.mutations.account.get_resolver_request_meta",
    return_value=("1.2.3.4", "UA"),
)
@patch("backend.graphene.mutations.account.log_audit_event")
@patch("backend.graphene.mutations.account.NetworkAccessPolicy")
@patch("backend.graphene.mutations.account.ServiceAccountToken")
@patch("backend.graphene.mutations.account.ServiceToken")
@patch("backend.graphene.mutations.account.OrganisationMember")
@patch("backend.graphene.mutations.account.DynamicSecretLease")
@patch("backend.graphene.mutations.account.revoke_lease_now")
@patch("backend.graphene.mutations.account.transaction")
@patch("backend.graphene.mutations.account.require_fresh_session_graphql")
@patch("backend.graphene.mutations.account.compute_account_deletion_blockers")
class TestDeleteAccountMutation:
    def _mutate(self, info):
        from backend.graphene.mutations.account import DeleteAccountMutation

        return DeleteAccountMutation.mutate(None, info)

    def _setup(
        self,
        mock_blockers,
        mock_lease_model,
        mock_om,
        leases=None,
        memberships=None,
        blockers=None,
    ):
        mock_blockers.return_value = blockers or []
        mock_lease_model.objects.filter.return_value.select_related.return_value = (
            leases or []
        )
        mock_om.objects.filter.return_value.select_related.return_value = (
            memberships or []
        )

    def test_blocker_aborts_before_any_work(
        self,
        mock_blockers,
        mock_fresh,
        mock_transaction,
        mock_revoke,
        mock_lease_model,
        mock_om,
        mock_st,
        mock_sat,
        mock_nap,
        mock_audit,
        mock_meta,
        mock_logout,
    ):
        blocker = MagicMock()
        blocker.kind = "sole_owner"
        self._setup(mock_blockers, mock_lease_model, mock_om, blockers=[blocker])
        user = _make_user()

        with pytest.raises(GraphQLError, match="sole_owner"):
            self._mutate(_make_info(user))

        user.delete.assert_not_called()
        mock_revoke.assert_not_called()

    def test_stale_session_aborts(
        self,
        mock_blockers,
        mock_fresh,
        mock_transaction,
        mock_revoke,
        mock_lease_model,
        mock_om,
        mock_st,
        mock_sat,
        mock_nap,
        mock_audit,
        mock_meta,
        mock_logout,
    ):
        mock_fresh.side_effect = GraphQLError("reauth_required")
        user = _make_user()

        with pytest.raises(GraphQLError, match="reauth_required"):
            self._mutate(_make_info(user))

        user.delete.assert_not_called()
        mock_blockers.assert_not_called()

    def test_lease_revocation_failure_aborts_before_delete(
        self,
        mock_blockers,
        mock_fresh,
        mock_transaction,
        mock_revoke,
        mock_lease_model,
        mock_om,
        mock_st,
        mock_sat,
        mock_nap,
        mock_audit,
        mock_meta,
        mock_logout,
    ):
        lease = MagicMock()
        self._setup(mock_blockers, mock_lease_model, mock_om, leases=[lease])
        mock_revoke.side_effect = GraphQLError("Failed to revoke")
        user = _make_user()

        with pytest.raises(GraphQLError, match="Failed to revoke"):
            self._mutate(_make_info(user))

        user.delete.assert_not_called()

    def test_staff_accounts_refused(
        self,
        mock_blockers,
        mock_fresh,
        mock_transaction,
        mock_revoke,
        mock_lease_model,
        mock_om,
        mock_st,
        mock_sat,
        mock_nap,
        mock_audit,
        mock_meta,
        mock_logout,
    ):
        self._setup(mock_blockers, mock_lease_model, mock_om)
        user = _make_user()
        user.is_staff = True

        with pytest.raises(GraphQLError):
            self._mutate(_make_info(user))
        user.delete.assert_not_called()

    @patch("api.emails.send_account_deleted_email")
    @patch("ee.billing.stripe.update_stripe_subscription_seats")
    @patch("backend.graphene.mutations.account.settings")
    def test_happy_path_executes_in_order(
        self,
        mock_settings,
        mock_seats,
        mock_email,
        mock_blockers,
        mock_fresh,
        mock_transaction,
        mock_revoke,
        mock_lease_model,
        mock_om,
        mock_st,
        mock_sat,
        mock_nap,
        mock_audit,
        mock_meta,
        mock_logout,
    ):
        mock_settings.APP_HOST = "cloud"
        # Execute on_commit callbacks immediately
        mock_transaction.on_commit.side_effect = lambda cb: cb()

        lease = MagicMock()
        membership = MagicMock()
        membership.id = "member-1"
        membership.organisation.name = "Acme"
        self._setup(
            mock_blockers,
            mock_lease_model,
            mock_om,
            leases=[lease],
            memberships=[membership],
        )
        user = _make_user()

        result = self._mutate(_make_info(user))

        assert result.ok is True
        mock_revoke.assert_called_once_with(lease)
        # FK-nulling belt-and-braces alongside migration 0137
        mock_st.objects.filter.return_value.update.assert_called_once_with(
            created_by=None
        )
        mock_sat.objects.filter.return_value.update.assert_called_once_with(
            created_by=None
        )
        assert mock_nap.objects.filter.return_value.update.call_count == 2
        # Audit tombstone per org
        mock_audit.assert_called_once_with(
            organisation=membership.organisation,
            event_type=ANY,
            resource_type=ANY,
            resource_id="member-1",
            actor_type="user",
            actor_id="member-1",
            actor_metadata=ANY,
            resource_metadata=ANY,
            description="User permanently deleted their account",
            ip_address="1.2.3.4",
            user_agent="UA",
        )
        user.delete.assert_called_once()
        mock_seats.assert_called_once_with(membership.organisation)
        mock_email.assert_called_once_with("alice@example.com", "Alice Test")
        mock_logout.assert_called_once()

    @patch("api.emails.send_account_deleted_email")
    @patch("ee.billing.stripe.update_stripe_subscription_seats")
    @patch("backend.graphene.mutations.account.settings")
    def test_self_hosted_skips_stripe(
        self,
        mock_settings,
        mock_seats,
        mock_email,
        mock_blockers,
        mock_fresh,
        mock_transaction,
        mock_revoke,
        mock_lease_model,
        mock_om,
        mock_st,
        mock_sat,
        mock_nap,
        mock_audit,
        mock_meta,
        mock_logout,
    ):
        mock_settings.APP_HOST = "self"
        mock_transaction.on_commit.side_effect = lambda cb: cb()
        self._setup(mock_blockers, mock_lease_model, mock_om)
        user = _make_user()

        result = self._mutate(_make_info(user))

        assert result.ok is True
        mock_seats.assert_not_called()
        mock_email.assert_called_once()


# ---------------------------------------------------------------------------
# Tokens left creatorless by the SET_NULL cascade
# ---------------------------------------------------------------------------


class TestServiceAccountTokenCreatorInvariant:
    """Account deletion nulls ServiceAccountToken.created_by via SET_NULL —
    the model's soft delete (save -> clean) must still work afterwards."""

    def _token(self):
        from api.models import ServiceAccountToken

        return ServiceAccountToken(
            created_by=None, created_by_service_account=None
        )

    def test_new_token_requires_a_creator(self):
        from django.core.exceptions import ValidationError

        token = self._token()
        assert token._state.adding
        with pytest.raises(ValidationError):
            token.clean()

    def test_existing_creatorless_token_passes_clean(self):
        token = self._token()
        token._state.adding = False  # as if loaded from the DB
        token.clean()
