import copy
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from api.utils.access.roles import (
    OWNER_ROLE_KEY,
    VALID_APP_PERMISSIONS,
    VALID_ORG_PERMISSIONS,
    default_roles,
    normalize_custom_role_permissions,
    prune_retired_permissions,
    validate_custom_role_permissions,
)


EXPECTED_VERSIONS = {
    "Owner": 3,
    "Admin": 3,
    "Manager": 3,
    "Developer": 2,
    "Service": 2,
}

def _owner_member():
    # Global access exempts the grant ceiling, keeping these tests about normalisation
    member = MagicMock()
    member.role.is_default = True
    member.role.managed_key = OWNER_ROLE_KEY
    member.role.permissions = {}
    return member


LEGACY_POLICY = {
    "permissions": {"Roles": ["read"]},
    "app_permissions": {
        "Secrets": ["read"],
        "Tokens": ["create", "read", "update", "delete"],
    },
}


def test_covers_every_default_role():
    assert set(default_roles) == set(EXPECTED_VERSIONS)


@pytest.mark.parametrize("role_name", sorted(EXPECTED_VERSIONS))
def test_default_role_has_no_tokens_permission(role_name):
    policy = default_roles[role_name]
    assert "Tokens" not in policy["app_permissions"]
    assert "Tokens" not in policy["permissions"]


@pytest.mark.parametrize(("role_name", "version"), sorted(EXPECTED_VERSIONS.items()))
def test_default_role_version_is_bumped(role_name, version):
    assert default_roles[role_name]["meta"]["version"] == version


PRUNED_POLICY = {
    "permissions": {"Roles": ["read"]},
    "app_permissions": {"Secrets": ["read"]},
}


def _legacy_role():
    return MagicMock(is_default=False, managed_key=None, permissions=LEGACY_POLICY)


def test_tokens_is_outside_the_permission_universe():
    assert "Tokens" not in VALID_APP_PERMISSIONS
    assert "Tokens" not in VALID_ORG_PERMISSIONS


def test_legacy_policy_is_rejected_on_write():
    normalized = normalize_custom_role_permissions(LEGACY_POLICY)

    assert normalized == LEGACY_POLICY
    error = validate_custom_role_permissions(normalized)
    assert "Unknown app permission class: 'Tokens'" in error


def test_prune_drops_retired_keys_in_both_scopes():
    policy = {
        "permissions": {"Roles": ["read"], "Tokens": ["read"]},
        "app_permissions": {"Secrets": ["read"], "Tokens": ["read"]},
        "global_access": False,
    }

    assert prune_retired_permissions(policy) == {
        "permissions": {"Roles": ["read"]},
        "app_permissions": {"Secrets": ["read"]},
        "global_access": False,
    }


def test_prune_does_not_mutate_input():
    payload = copy.deepcopy(LEGACY_POLICY)

    prune_retired_permissions(payload)

    assert payload == LEGACY_POLICY


@pytest.mark.parametrize(
    "payload",
    [None, "Tokens", ["Tokens"], {"permissions": None, "app_permissions": ["Tokens"]}],
)
def test_prune_passes_through_malformed_shapes(payload):
    assert prune_retired_permissions(payload) == payload


def test_normalize_handles_camel_case_payload():
    payload = {
        "permissions": {"Roles": ["read"]},
        "appPermissions": {"Secrets": ["read"]},
        "global_access": False,
    }

    normalized = normalize_custom_role_permissions(payload)

    assert normalized == {**PRUNED_POLICY, "global_access": False}
    assert "appPermissions" in payload
    assert (
        validate_custom_role_permissions(normalized, allow_false_global_access=True)
        is None
    )


def test_unknown_app_permission_is_rejected():
    payload = {"permissions": {}, "app_permissions": {"Bogus": ["read"]}}

    error = validate_custom_role_permissions(normalize_custom_role_permissions(payload))
    assert "Unknown app permission class: 'Bogus'" in error


def test_org_level_tokens_key_is_rejected():
    payload = {"permissions": {"Tokens": ["read"]}, "app_permissions": {}}

    error = validate_custom_role_permissions(normalize_custom_role_permissions(payload))
    assert "Unknown org permission class: 'Tokens'" in error


@pytest.mark.parametrize("payload", [None, "Tokens", ["Tokens"]])
def test_normalize_passes_through_non_dict_payload(payload):
    assert normalize_custom_role_permissions(payload) == payload


def test_stale_stored_tokens_key_grants_nothing_else():
    from api.utils.access.permissions import role_has_permission

    role = _legacy_role()

    assert role_has_permission(role, "read", "Secrets", True)
    assert not role_has_permission(role, "read", "Tokens", False)
    assert not role_has_permission(role, "create", "Secrets", True)


def test_rest_read_omits_retired_keys():
    from api.views.roles import _get_role_permissions

    assert _get_role_permissions(_legacy_role()) == PRUNED_POLICY


def test_graphql_read_omits_retired_keys():
    from backend.graphene.types import RoleType

    assert RoleType.resolve_permissions(_legacy_role(), None) == PRUNED_POLICY


def test_effective_policy_omits_retired_keys():
    from api.utils.access.permissions import get_role_effective_policy

    assert get_role_effective_policy(_legacy_role()) == (
        {"Roles": ["read"]},
        {"Secrets": ["read"]},
        False,
    )


@patch("backend.graphene.mutations.access.log_audit_event")
@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Role")
def test_update_mutation_rejects_legacy_policy(
    mock_role_model, mock_member_model, _mock_permission, _mock_audit
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    mock_member_model.objects.get.return_value = _owner_member()
    role = _legacy_role()
    role.id = "custom-role"
    role.organisation.plan = "PR"
    mock_role_model.objects.get.return_value = role
    mock_role_model.objects.select_for_update.return_value.get.return_value = role

    with patch("backend.graphene.mutations.access.transaction"), pytest.raises(
        GraphQLError, match="Unknown app permission class: 'Tokens'"
    ):
        UpdateCustomRoleMutation.mutate(
            None,
            MagicMock(),
            id=role.id,
            name="Auditor",
            description="Old",
            color="#000000",
            permissions={**copy.deepcopy(LEGACY_POLICY), "global_access": False},
        )

    role.save.assert_not_called()


@patch("backend.graphene.mutations.access.log_audit_event")
@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Organisation")
@patch("backend.graphene.mutations.access.Role")
def test_create_mutation_rejects_legacy_policy(
    mock_role_model, mock_organisation_model, mock_member_model, _mock_permission, _mock_audit
):
    from backend.graphene.mutations.access import CreateCustomRoleMutation

    mock_organisation_model.objects.get.return_value = MagicMock(plan="PR")
    mock_organisation_model.FREE_PLAN = "FR"
    mock_member_model.objects.get.return_value = _owner_member()
    mock_role_model.objects.filter.return_value.exists.return_value = False

    with pytest.raises(GraphQLError, match="Unknown app permission class: 'Tokens'"):
        CreateCustomRoleMutation.mutate(
            None,
            MagicMock(),
            name="Terraformed",
            description="",
            color="",
            permissions=copy.deepcopy(LEGACY_POLICY),
            organisation_id="org-1",
        )

    mock_role_model.objects.create.assert_not_called()
