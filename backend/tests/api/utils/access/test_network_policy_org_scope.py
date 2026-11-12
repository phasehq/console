"""A network access policy attached to an account is only disclosed and
enforced when it belongs to the account's own organisation. Covers the REST
permission, the GraphQL middleware and the account type resolvers.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from api.models import Organisation
from api.utils.access.middleware import IsIPAllowed
from backend.graphene.middleware import IPRestrictedError, IPWhitelistMiddleware
from backend.graphene.types import OrganisationMemberType, ServiceAccountType

CLIENT_IP = "198.18.0.5"
ORG = SimpleNamespace(id="org-a", name="org-a", plan=Organisation.PRO_PLAN)
OTHER_ORG = SimpleNamespace(id="org-b", name="org-b", plan=Organisation.PRO_PLAN)


class _Policy:
    def __init__(self, organisation, allowed_ips):
        self.organisation = organisation
        self.organisation_id = organisation.id
        self.allowed_ips = allowed_ips

    def get_ip_list(self):
        return [ip.strip() for ip in self.allowed_ips.split(",") if ip.strip()]


class _AttachedPolicies:
    """Stands in for an account's `network_policies` related manager."""

    def __init__(self, *policies):
        self._policies = list(policies)

    def all(self):
        return list(self._policies)

    def filter(self, organisation=None, organisation_id=None):
        if organisation is not None:
            organisation_id = organisation.id
        return [p for p in self._policies if p.organisation_id == organisation_id]


OWN_BLOCKING = _Policy(ORG, "203.0.113.7")
OWN_ALLOWING = _Policy(ORG, "198.18.0.0/15")
FOREIGN_BLOCKING = _Policy(OTHER_ORG, "203.0.113.7")
FOREIGN_ALLOWING = _Policy(OTHER_ORG, "198.18.0.0/15")


def _account(*policies):
    return SimpleNamespace(
        organisation=ORG,
        organisation_id=ORG.id,
        network_policies=_AttachedPolicies(*policies),
    )


# ──────────────────────────────────────────────────────────────────────
# REST: IsIPAllowed
# ──────────────────────────────────────────────────────────────────────


def _rest_allowed(account_key, account):
    request = SimpleNamespace(auth={account_key: account})
    with patch("api.utils.access.middleware.get_client_ip", return_value=CLIENT_IP):
        return IsIPAllowed().has_permission(request, MagicMock())


@pytest.mark.parametrize("account_key", ["org_member", "service_account"])
def test_rest_ignores_policy_owned_by_another_organisation(account_key):
    assert _rest_allowed(account_key, _account(FOREIGN_BLOCKING)) is True


@pytest.mark.parametrize("account_key", ["org_member", "service_account"])
def test_rest_enforces_policy_owned_by_the_organisation(account_key):
    assert _rest_allowed(account_key, _account(OWN_BLOCKING)) is False
    assert _rest_allowed(account_key, _account(OWN_ALLOWING)) is True


@pytest.mark.parametrize("account_key", ["org_member", "service_account"])
def test_rest_foreign_policy_cannot_widen_an_own_restriction(account_key):
    account = _account(OWN_BLOCKING, FOREIGN_ALLOWING)

    assert _rest_allowed(account_key, account) is False


# ──────────────────────────────────────────────────────────────────────
# GraphQL: IPWhitelistMiddleware
# ──────────────────────────────────────────────────────────────────────


def _graphql_resolve(member):
    info = MagicMock()
    info.context.user.is_authenticated = True
    with patch("backend.graphene.middleware.Organisation") as organisation, patch(
        "backend.graphene.middleware.OrganisationMember"
    ) as organisation_member, patch(
        "backend.graphene.middleware.get_client_ip", return_value=CLIENT_IP
    ):
        organisation.objects.get.return_value = ORG
        organisation.FREE_PLAN = Organisation.FREE_PLAN
        organisation.ENTERPRISE_PLAN = Organisation.ENTERPRISE_PLAN
        organisation_member.objects.get.return_value = member
        return IPWhitelistMiddleware().resolve(
            lambda root, info, **kwargs: "resolved",
            None,
            info,
            organisation_id=ORG.id,
        )


def test_graphql_ignores_policy_owned_by_another_organisation():
    assert _graphql_resolve(_account(FOREIGN_BLOCKING)) == "resolved"


def test_graphql_enforces_policy_owned_by_the_organisation():
    assert _graphql_resolve(_account(OWN_ALLOWING)) == "resolved"
    with pytest.raises(IPRestrictedError):
        _graphql_resolve(_account(OWN_BLOCKING))


def test_graphql_foreign_policy_cannot_widen_an_own_restriction():
    with pytest.raises(IPRestrictedError):
        _graphql_resolve(_account(OWN_BLOCKING, FOREIGN_ALLOWING))


# ──────────────────────────────────────────────────────────────────────
# Account type resolvers
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("account_type", [OrganisationMemberType, ServiceAccountType])
def test_account_resolver_hides_policy_owned_by_another_organisation(account_type):
    account = _account(OWN_BLOCKING, FOREIGN_BLOCKING)

    with patch("backend.graphene.types.NetworkAccessPolicy") as policy_model:
        policy_model.objects.filter.return_value = []  # no global policies
        resolved = account_type.resolve_network_policies(account, MagicMock())

    assert resolved == [OWN_BLOCKING]
