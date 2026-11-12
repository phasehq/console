"""A network access policy does not expose the accounts it is attached to.
Attachments are read from the account side, where they are scoped to the
account's organisation."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from graphql import get_named_type

from api.models import CustomUser, NetworkAccessPolicy, OrganisationMember
from backend.schema import schema

ME = CustomUser(userId="user-me", email="me@example.com")
POLICY_FIELDS = schema.graphql_schema.type_map["NetworkAccessPolicyType"].fields


def _root_field(name):
    return schema.graphql_schema.query_type.fields[name]


def test_policy_type_exposes_only_listed_fields():
    assert set(POLICY_FIELDS) == {
        "id",
        "name",
        "allowedIps",
        "isGlobal",
        "createdAt",
        "createdBy",
        "updatedAt",
        "updatedBy",
    }


def test_policy_type_has_no_path_to_attached_accounts():
    """The only accounts reachable from a policy are its creator and last
    editor, so a link to an account can't be followed from the policy."""
    account_types = {"OrganisationMemberType", "ServiceAccountType"}

    to_accounts = {
        name
        for name, field in POLICY_FIELDS.items()
        if get_named_type(field.type).name in account_types
    }

    assert to_accounts == {"createdBy", "updatedBy"}


@pytest.mark.parametrize(
    "selection",
    [
        "members { email networkPolicies { name allowedIps } }",
        "serviceAccounts { name }",
        "organisationMembers { email }",
        "organisation { name }",
    ],
)
def test_relations_cannot_be_selected_on_a_policy(selection):
    query = '{ networkAccessPolicies(organisationId: "org-a") { id %s } }' % selection

    with patch.object(_root_field("networkAccessPolicies"), "resolve") as resolve:
        result = schema.execute(query, context_value=SimpleNamespace(user=ME))

    assert result.data is None
    assert "NetworkAccessPolicyType" in result.errors[0].message
    resolve.assert_not_called()


def test_policy_query_returns_the_policy_and_its_editors():
    editor = OrganisationMember(id="m-1", user=ME)
    policy = NetworkAccessPolicy(
        id="p-1",
        name="Office",
        allowed_ips="198.51.100.0/24",
        is_global=False,
        created_by=editor,
        updated_by=editor,
    )
    query = """{
      networkAccessPolicies(organisationId: "org-a") {
        id name allowedIps isGlobal
        createdBy { id self }
        updatedBy { id self }
      }
    }"""

    with patch.object(
        _root_field("networkAccessPolicies"), "resolve", return_value=[policy]
    ):
        result = schema.execute(query, context_value=SimpleNamespace(user=ME))

    assert result.errors is None
    assert result.data["networkAccessPolicies"] == [
        {
            "id": "p-1",
            "name": "Office",
            "allowedIps": "198.51.100.0/24",
            "isGlobal": False,
            "createdBy": {"id": "m-1", "self": True},
            "updatedBy": {"id": "m-1", "self": True},
        }
    ]
