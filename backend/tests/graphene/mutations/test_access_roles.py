from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


VALID_POLICY = {
    "permissions": {"Roles": ["read"]},
    "app_permissions": {"Secrets": ["read"]},
    "global_access": False,
}


def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


@pytest.mark.parametrize(
    ("managed_key", "name"),
    [
        ("owner", "Owner"),
        ("admin", "Admin"),
        ("manager", "Manager"),
        ("developer", "Developer"),
        ("service", "Service"),
    ],
)
@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.Role")
def test_update_rejects_every_default_role_before_mutation(
    mock_role_model, _mock_permission, managed_key, name
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    role = MagicMock()
    role.name = name
    role.description = "managed"
    role.color = "#000000"
    role.permissions = {}
    role.is_default = True
    role.managed_key = managed_key
    role.organisation.plan = "PR"
    mock_role_model.objects.get.return_value = role

    with pytest.raises(GraphQLError, match="Default roles cannot be modified"):
        UpdateCustomRoleMutation.mutate(
            None,
            _info(),
            id=f"role-{managed_key}",
            name="Attacker controlled",
            description="changed",
            color="#ffffff",
            permissions=VALID_POLICY,
        )

    assert role.name == name
    assert role.permissions == {}
    role.save.assert_not_called()
    mock_role_model.objects.filter.assert_not_called()


@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.Role")
def test_update_rejects_custom_global_access_injection(
    mock_role_model, _mock_permission
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    role = MagicMock()
    role.name = "Auditor"
    role.description = "Read-only"
    role.color = "#000000"
    role.permissions = VALID_POLICY
    role.is_default = False
    role.managed_key = None
    role.organisation.plan = "PR"
    mock_role_model.objects.get.return_value = role

    injected = {**VALID_POLICY, "global_access": True}
    with pytest.raises(GraphQLError, match="global_access is reserved"):
        UpdateCustomRoleMutation.mutate(
            None,
            _info(),
            id="custom-role",
            name="Auditor",
            description="Read-only",
            color="#000000",
            permissions=injected,
        )

    role.save.assert_not_called()


@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.Organisation")
@patch("backend.graphene.mutations.access.Role")
def test_create_rejects_custom_global_access_injection(
    mock_role_model, mock_organisation_model, _mock_permission
):
    from backend.graphene.mutations.access import CreateCustomRoleMutation

    org = MagicMock(plan="PR")
    mock_organisation_model.objects.get.return_value = org

    with pytest.raises(GraphQLError, match="global_access is reserved"):
        CreateCustomRoleMutation.mutate(
            None,
            _info(),
            name="Injected",
            description="",
            color="",
            permissions={**VALID_POLICY, "global_access": True},
            organisation_id="org-1",
        )

    mock_role_model.objects.create.assert_not_called()


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
@patch("backend.graphene.mutations.access.Role")
def test_custom_role_update_happy_path_is_preserved(
    mock_role_model, _mock_permission, _mock_meta, _mock_actor, _mock_audit
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    role = MagicMock()
    role.id = "custom-role"
    role.name = "Auditor"
    role.description = "Old"
    role.color = "#000000"
    role.permissions = {}
    role.is_default = False
    role.managed_key = None
    role.organisation.plan = "PR"
    mock_role_model.objects.get.return_value = role
    (
        mock_role_model.objects.filter.return_value.exclude.return_value.exists.return_value
    ) = False

    result = UpdateCustomRoleMutation.mutate(
        None,
        _info(),
        id=role.id,
        name="Auditor 2",
        description="Updated",
        color="#123456",
        permissions={
            "permissions": {"Roles": ["read"]},
            "appPermissions": {"Secrets": ["read"]},
            "global_access": False,
        },
    )

    assert result.role is role
    assert role.name == "Auditor 2"
    assert role.permissions == VALID_POLICY
    role.save.assert_called_once_with()
