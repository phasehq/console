"""Tests for scheduling and restoring organisation deletion."""

from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from django.utils import timezone
from graphql import GraphQLError

from api.models import OrganisationMember
from api.utils.organisation_deletion import GRACE_PERIOD

MODULE = "backend.graphene.mutations.organisation"


def _info():
    info = MagicMock()
    info.context.user = MagicMock(userId="user-1")
    return info


def _org(deleted_at=None):
    org = MagicMock()
    org.id = "org-1"
    org.name = "Acme"
    org.deleted_at = deleted_at
    return org


def _member(managed_key="owner"):
    member = MagicMock()
    member.role.is_default = True
    member.role.managed_key = managed_key
    return member


@pytest.fixture
def mocks():
    with patch(f"{MODULE}.OrganisationMember") as member_model, patch(
        f"{MODULE}.Organisation"
    ) as org_model, patch(f"{MODULE}.transaction") as transaction, patch(
        f"{MODULE}.log_audit_event"
    ) as audit, patch(
        f"{MODULE}.get_actor_info_from_graphql",
        return_value=("user", "member-1", {}),
    ), patch(
        f"{MODULE}.get_resolver_request_meta", return_value=("1.2.3.4", "UA")
    ), patch(
        f"{MODULE}.enqueue_deletion_requested"
    ) as enqueue_requested, patch(
        f"{MODULE}.enqueue_organisation_restored"
    ) as enqueue_restored:
        member_model.DoesNotExist = OrganisationMember.DoesNotExist
        member_model.objects.select_related.return_value.get.return_value = _member()
        yield MagicMock(
            member_model=member_model,
            org_model=org_model,
            transaction=transaction,
            audit=audit,
            enqueue_requested=enqueue_requested,
            enqueue_restored=enqueue_restored,
        )


def _use_org(mocks, org):
    mocks.org_model.objects.select_for_update.return_value.get.return_value = org


def _run_on_commit(mocks):
    callback = mocks.transaction.on_commit.call_args[0][0]
    callback()


def _delete(organisation_id="org-1"):
    from backend.graphene.mutations.organisation import DeleteOrganisationMutation

    return DeleteOrganisationMutation.mutate(None, _info(), organisation_id)


def _restore(organisation_id="org-1"):
    from backend.graphene.mutations.organisation import RestoreOrganisationMutation

    return RestoreOrganisationMutation.mutate(None, _info(), organisation_id)


class TestDeleteOrganisation:
    def test_locks_org_and_enqueues_cleanup(self, mocks):
        org = _org()
        _use_org(mocks, org)

        result = _delete()

        assert result.organisation is org
        assert org.deleted_at is not None
        assert timezone.now() - org.deleted_at < timedelta(seconds=5)
        org.save.assert_called_once_with(update_fields=["deleted_at", "updated_at"])

        audit_kwargs = mocks.audit.call_args.kwargs
        assert audit_kwargs["event_type"] == "D"
        assert audit_kwargs["resource_type"] == "org"
        assert audit_kwargs["resource_id"] == "org-1"

        mocks.enqueue_requested.assert_not_called()
        _run_on_commit(mocks)
        mocks.enqueue_requested.assert_called_once_with("org-1")

    def test_non_owner_is_rejected(self, mocks):
        mocks.member_model.objects.select_related.return_value.get.return_value = (
            _member(managed_key="admin")
        )
        org = _org()
        _use_org(mocks, org)

        with pytest.raises(GraphQLError, match="Only the organisation owner"):
            _delete()

        org.save.assert_not_called()

    def test_non_member_is_rejected(self, mocks):
        mocks.member_model.objects.select_related.return_value.get.side_effect = (
            OrganisationMember.DoesNotExist
        )

        with pytest.raises(GraphQLError, match="don't have access"):
            _delete()

        mocks.org_model.objects.select_for_update.assert_not_called()

    def test_pending_invoices_block_deletion(self, mocks):
        member = _member()
        mocks.member_model.objects.select_related.return_value.get.return_value = member

        with patch(f"{MODULE}.has_pending_invoices", return_value=True) as check:
            with pytest.raises(
                GraphQLError, match="You have pending invoices"
            ) as error:
                _delete()

        check.assert_called_once_with(member.organisation)
        assert error.value.extensions == {"code": "PENDING_INVOICES"}
        mocks.org_model.objects.select_for_update.assert_not_called()

    def test_deletion_is_refused_when_invoices_cant_be_checked(self, mocks):
        with patch(
            f"{MODULE}.has_pending_invoices", side_effect=Exception("Stripe is down")
        ):
            with pytest.raises(GraphQLError, match="Could not check"):
                _delete()

        mocks.org_model.objects.select_for_update.assert_not_called()

    def test_already_scheduled_is_rejected(self, mocks):
        org = _org(deleted_at=timezone.now() - timedelta(days=1))
        _use_org(mocks, org)

        with pytest.raises(GraphQLError, match="already scheduled"):
            _delete()

        org.save.assert_not_called()
        mocks.transaction.on_commit.assert_not_called()


class TestRestoreOrganisation:
    def test_unlocks_org_and_enqueues_resume(self, mocks):
        org = _org(deleted_at=timezone.now() - GRACE_PERIOD / 2)
        _use_org(mocks, org)

        result = _restore()

        assert result.organisation is org
        assert org.deleted_at is None
        org.save.assert_called_once_with(update_fields=["deleted_at", "updated_at"])
        assert mocks.audit.call_args.kwargs["event_type"] == "U"

        _run_on_commit(mocks)
        mocks.enqueue_restored.assert_called_once_with("org-1")

    def test_not_scheduled_is_rejected(self, mocks):
        _use_org(mocks, _org())

        with pytest.raises(GraphQLError, match="not scheduled for deletion"):
            _restore()

    def test_rejected_once_grace_period_has_ended(self, mocks):
        org = _org(deleted_at=timezone.now() - GRACE_PERIOD - timedelta(minutes=1))
        _use_org(mocks, org)

        with pytest.raises(GraphQLError, match="can no longer be restored"):
            _restore()

        org.save.assert_not_called()

    def test_non_owner_is_rejected(self, mocks):
        mocks.member_model.objects.select_related.return_value.get.return_value = (
            _member(managed_key="developer")
        )

        with pytest.raises(GraphQLError, match="Only the organisation owner"):
            _restore()

    def test_restore_bypasses_the_deletion_lock(self):
        from backend.graphene.mutations.organisation import (
            DeleteOrganisationMutation,
            RestoreOrganisationMutation,
        )

        assert RestoreOrganisationMutation.bypass_org_deletion_lock is True
        assert not getattr(
            DeleteOrganisationMutation, "bypass_org_deletion_lock", False
        )
