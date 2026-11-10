"""updateAccountNetworkAccessPolicies must only attach policies owned by the
organisation being modified, and reject the whole request (before any write)
when an id does not resolve there.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from backend.graphene.mutations.access import (
    AccountTypeEnum,
    UpdateAccountNetworkAccessPolicies,
)

M = "backend.graphene.mutations.access"
ORG, OTHER_ORG = "org-a", "org-b"
REJECTED = "do not belong to this organisation"


def _policy(policy_id, organisation_id):
    return SimpleNamespace(id=policy_id, organisation_id=organisation_id)


OWN_1, OWN_2 = _policy("pol-own-1", ORG), _policy("pol-own-2", ORG)
FOREIGN = _policy("pol-foreign", OTHER_ORG)
STORE = [OWN_1, OWN_2, FOREIGN]


def _filter_policies(id__in, organisation_id=None):
    return [
        p
        for p in STORE
        if p.id in id__in and organisation_id in (None, p.organisation_id)
    ]


@pytest.fixture
def mocks():
    with ExitStack() as stack:
        m = SimpleNamespace()
        for name in (
            "Organisation",
            "OrganisationMember",
            "ServiceAccount",
            "NetworkAccessPolicy",
            "TeamMembership",
            "log_audit_event",
        ):
            setattr(m, name, stack.enter_context(patch(f"{M}.{name}")))
        stack.enter_context(patch(f"{M}.user_has_permission", return_value=True))
        stack.enter_context(
            patch(
                f"{M}.get_actor_info_from_graphql",
                return_value=("user", "member-1", {}),
            )
        )
        stack.enter_context(
            patch(
                f"{M}.get_resolver_request_meta",
                return_value=("127.0.0.1", "pytest"),
            )
        )
        m.NetworkAccessPolicy.objects.filter.side_effect = _filter_policies
        m.member, m.service_account = MagicMock(), MagicMock(team=None)
        caller = MagicMock()
        m.OrganisationMember.objects.get.side_effect = lambda **kwargs: (
            m.member if "id" in kwargs else caller
        )
        m.ServiceAccount.objects.get.return_value = m.service_account
        yield m


def _user(policy_ids):
    return SimpleNamespace(
        account_type=AccountTypeEnum.USER, account_id="member-2", policy_ids=policy_ids
    )


def _service(policy_ids):
    return SimpleNamespace(
        account_type=AccountTypeEnum.SERVICE, account_id="sa-1", policy_ids=policy_ids
    )


def _assign(*account_inputs):
    return UpdateAccountNetworkAccessPolicies.mutate(
        None, MagicMock(), account_inputs=list(account_inputs), organisation_id=ORG
    )


def test_rejects_policy_from_another_organisation(mocks):
    with pytest.raises(GraphQLError, match=REJECTED):
        _assign(_user([FOREIGN.id]))

    mocks.member.network_policies.set.assert_not_called()
    mocks.log_audit_event.assert_not_called()


def test_rejects_foreign_policy_mixed_with_own_policies(mocks):
    with pytest.raises(GraphQLError, match=REJECTED):
        _assign(_service([OWN_1.id, FOREIGN.id]))

    mocks.service_account.network_policies.set.assert_not_called()


def test_rejects_unknown_policy_id(mocks):
    with pytest.raises(GraphQLError, match=REJECTED):
        _assign(_user(["does-not-exist"]))

    mocks.member.network_policies.set.assert_not_called()


def test_rejected_request_changes_no_account(mocks):
    """A valid earlier input must not be applied when a later one is rejected."""
    with pytest.raises(GraphQLError, match=REJECTED):
        _assign(_user([OWN_1.id]), _service([FOREIGN.id]))

    mocks.member.network_policies.set.assert_not_called()
    mocks.service_account.network_policies.set.assert_not_called()
    mocks.log_audit_event.assert_not_called()


def test_assigns_policies_owned_by_the_organisation(mocks):
    result = _assign(_user([OWN_1.id, OWN_2.id]), _service([OWN_2.id]))

    assert result.ok is True
    (member_policies,) = mocks.member.network_policies.set.call_args.args
    assert sorted(p.id for p in member_policies) == [OWN_1.id, OWN_2.id]
    mocks.service_account.network_policies.set.assert_called_once_with([OWN_2])
    assert mocks.log_audit_event.call_count == 2


def test_repeated_policy_id_is_not_rejected(mocks):
    _assign(_user([OWN_1.id, OWN_1.id]))

    mocks.member.network_policies.set.assert_called_once_with([OWN_1])


@pytest.mark.parametrize("policy_ids", [[], None])
def test_empty_policy_ids_clear_the_assignment(mocks, policy_ids):
    _assign(_user(policy_ids))

    mocks.member.network_policies.set.assert_called_once_with([])
