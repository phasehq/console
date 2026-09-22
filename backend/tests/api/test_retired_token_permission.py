import copy
from unittest.mock import MagicMock, patch

import pytest

from api.utils.access.roles import (
    OWNER_ROLE_KEY,
    RETIRED_APP_PERMISSIONS,
    VALID_APP_PERMISSIONS,
    default_roles,
    normalize_custom_role_permissions,
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


def test_tokens_is_retired_not_valid():
    assert "Tokens" in RETIRED_APP_PERMISSIONS
    assert "Tokens" not in VALID_APP_PERMISSIONS
    assert not RETIRED_APP_PERMISSIONS & set(VALID_APP_PERMISSIONS)


def test_unnormalized_legacy_policy_is_rejected():
    error = validate_custom_role_permissions(LEGACY_POLICY)
    assert "Unknown app permission class: 'Tokens'" in error


def test_normalize_drops_tokens_and_result_validates():
    normalized = normalize_custom_role_permissions(LEGACY_POLICY)

    assert normalized == {
        "permissions": {"Roles": ["read"]},
        "app_permissions": {"Secrets": ["read"]},
    }
    assert validate_custom_role_permissions(normalized) is None


def test_normalize_does_not_mutate_input():
    payload = copy.deepcopy(LEGACY_POLICY)

    normalize_custom_role_permissions(payload)

    assert payload == LEGACY_POLICY


def test_normalize_handles_camel_case_payload():
    payload = {
        "permissions": {"Roles": ["read"]},
        "appPermissions": dict(LEGACY_POLICY["app_permissions"]),
        "global_access": False,
    }

    normalized = normalize_custom_role_permissions(payload)

    assert normalized == {
        "permissions": {"Roles": ["read"]},
        "app_permissions": {"Secrets": ["read"]},
        "global_access": False,
    }
    assert "Tokens" in payload["appPermissions"]
    assert (
        validate_custom_role_permissions(normalized, allow_false_global_access=True)
        is None
    )


def test_unknown_app_permission_is_still_rejected():
    payload = {
        "permissions": {},
        "app_permissions": {"Tokens": ["read"], "Bogus": ["read"]},
    }

    normalized = normalize_custom_role_permissions(payload)

    assert normalized["app_permissions"] == {"Bogus": ["read"]}
    error = validate_custom_role_permissions(normalized)
    assert "Unknown app permission class: 'Bogus'" in error


def test_org_level_tokens_key_is_not_tolerated():
    payload = {"permissions": {"Tokens": ["read"]}, "app_permissions": {}}

    normalized = normalize_custom_role_permissions(payload)

    error = validate_custom_role_permissions(normalized)
    assert "Unknown org permission class: 'Tokens'" in error


@pytest.mark.parametrize("app_permissions", [None, ["Tokens"], "Tokens"])
def test_normalize_leaves_malformed_app_permissions_for_the_validator(app_permissions):
    payload = {"permissions": {}, "app_permissions": app_permissions}

    assert normalize_custom_role_permissions(payload) == payload


@pytest.mark.parametrize("payload", [None, "Tokens", ["Tokens"]])
def test_normalize_passes_through_non_dict_payload(payload):
    assert normalize_custom_role_permissions(payload) == payload


def test_stale_stored_tokens_key_grants_nothing_else():
    from api.utils.access.permissions import role_has_permission

    role = MagicMock(is_default=False, managed_key=None, permissions=LEGACY_POLICY)

    assert role_has_permission(role, "read", "Secrets", True)
    assert not role_has_permission(role, "read", "Tokens", False)
    assert not role_has_permission(role, "create", "Secrets", True)


@patch("backend.graphene.mutations.access.log_audit_event")
@patch(
    "backend.graphene.mutations.access.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.access.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Role")
def test_update_mutation_accepts_legacy_policy_and_drops_tokens(
    mock_role_model, mock_member_model, _mock_permission, _mock_meta, _mock_actor, _mock_audit
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    mock_member_model.objects.get.return_value = _owner_member()
    role = MagicMock()
    role.id = "custom-role"
    role.name = "Auditor"
    role.description = "Old"
    role.color = "#000000"
    role.permissions = LEGACY_POLICY
    role.is_default = False
    role.managed_key = None
    role.organisation.plan = "PR"
    mock_role_model.objects.get.return_value = role
    mock_role_model.objects.select_for_update.return_value.get.return_value = role
    (
        mock_role_model.objects.filter.return_value.exclude.return_value.exists.return_value
    ) = False

    with patch("backend.graphene.mutations.access.transaction"):
        UpdateCustomRoleMutation.mutate(
            None,
            MagicMock(),
            id=role.id,
            name="Auditor",
            description="Old",
            color="#000000",
            permissions={**copy.deepcopy(LEGACY_POLICY), "global_access": False},
        )

    assert role.permissions == {
        "permissions": {"Roles": ["read"]},
        "app_permissions": {"Secrets": ["read"]},
        "global_access": False,
    }
    role.save.assert_called_once_with()


@patch("backend.graphene.mutations.access.log_audit_event")
@patch(
    "backend.graphene.mutations.access.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.access.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Organisation")
@patch("backend.graphene.mutations.access.Role")
def test_create_mutation_accepts_legacy_policy_and_drops_tokens(
    mock_role_model,
    mock_organisation_model,
    mock_member_model,
    _mock_permission,
    _mock_meta,
    _mock_actor,
    _mock_audit,
):
    from backend.graphene.mutations.access import CreateCustomRoleMutation

    mock_organisation_model.objects.get.return_value = MagicMock(plan="PR")
    mock_organisation_model.FREE_PLAN = "FR"
    mock_member_model.objects.get.return_value = _owner_member()
    mock_role_model.objects.filter.return_value.exists.return_value = False

    CreateCustomRoleMutation.mutate(
        None,
        MagicMock(),
        name="Terraformed",
        description="",
        color="",
        permissions=copy.deepcopy(LEGACY_POLICY),
        organisation_id="org-1",
    )

    stored = mock_role_model.objects.create.call_args.kwargs["permissions"]
    assert stored == {
        "permissions": {"Roles": ["read"]},
        "app_permissions": {"Secrets": ["read"]},
    }
