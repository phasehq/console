"""Member records carry no wrapped key material: other members only need a
member's identity_key. A caller reads their own wrapped keyring from the
organisation object."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from api.models import (
    CustomUser,
    Organisation,
    OrganisationMember,
    OrganisationMemberInvite,
)
from backend.schema import schema

ME = CustomUser(userId="user-me", email="me@example.com")
PEER = CustomUser(userId="user-peer", email="peer@example.com")


def _member(member_id, user):
    return OrganisationMember(
        id=member_id,
        user=user,
        identity_key=f"pub-{member_id}",
        wrapped_keyring=f"keyring-{member_id}",
        wrapped_recovery=f"recovery-{member_id}",
    )


def _root_field(name):
    return schema.graphql_schema.query_type.fields[name]


def _execute(query, root_field, value, user=ME):
    """Run `query` through the schema, with `root_field` resolving to `value`."""
    with patch.object(_root_field(root_field), "resolve", return_value=value):
        result = schema.execute(query, context_value=SimpleNamespace(user=user))

    assert result.errors is None
    return result.data


def test_member_type_exposes_no_wrapped_key_material():
    fields = schema.graphql_schema.type_map["OrganisationMemberType"].fields

    assert "wrappedKeyring" not in fields
    assert "wrappedRecovery" not in fields
    assert "identityKey" in fields


@pytest.mark.parametrize(
    "root_field, query",
    [
        (
            "organisationMembers",
            '{ organisationMembers(organisationId: "org") { id wrappedKeyring } }',
        ),
        (
            "validateInvite",
            '{ validateInvite(inviteId: "invite") { invitedBy { wrappedKeyring } } }',
        ),
    ],
)
def test_wrapped_keyring_cannot_be_selected_on_a_member(root_field, query):
    with patch.object(_root_field(root_field), "resolve") as resolve:
        result = schema.execute(query, context_value=SimpleNamespace(user=ME))

    assert result.data is None
    assert "wrappedKeyring" in result.errors[0].message
    resolve.assert_not_called()


def test_members_query_returns_identity_keys():
    data = _execute(
        '{ organisationMembers(organisationId: "org") { id self identityKey } }',
        "organisationMembers",
        [_member("m-me", ME), _member("m-peer", PEER)],
    )

    assert data["organisationMembers"] == [
        {"id": "m-me", "self": True, "identityKey": "pub-m-me"},
        {"id": "m-peer", "self": False, "identityKey": "pub-m-peer"},
    ]


def test_member_nested_under_another_type_returns_identity_key():
    invite = OrganisationMemberInvite(id="invite", invited_by=_member("m-peer", PEER))

    data = _execute(
        '{ validateInvite(inviteId: "invite") { invitedBy { identityKey } } }',
        "validateInvite",
        invite,
    )

    assert data["validateInvite"]["invitedBy"] == {"identityKey": "pub-m-peer"}


def test_caller_reads_their_own_keyring_from_the_organisation():
    org = Organisation(id="org", name="Org")
    own = _member("m-me", ME)

    with patch.object(OrganisationMember.objects, "get", return_value=own) as get:
        data = _execute(
            "{ organisations { keyring recovery } }", "organisations", [org]
        )

    assert data["organisations"] == [
        {"keyring": "keyring-m-me", "recovery": "recovery-m-me"}
    ]
    # The lookup is for the caller's own membership of that organisation
    get.assert_called_once_with(user=ME, organisation=org, deleted_at=None)
