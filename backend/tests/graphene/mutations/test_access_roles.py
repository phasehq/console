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


def _actor_member(managed_key=None, permissions=None):
    """Org member whose role drives the grant ceiling — a managed default
    role (resolved via template) or a custom role with stored JSON."""
    member = MagicMock()
    member.role.is_default = managed_key is not None
    member.role.managed_key = managed_key
    member.role.permissions = permissions if permissions is not None else {}
    return member


def _custom_role(permissions, name="SSO Admin"):
    role = MagicMock()
    role.id = "custom-role"
    role.name = name
    role.description = "Old"
    role.color = "#000000"
    role.permissions = permissions
    role.is_default = False
    role.managed_key = None
    role.organisation.plan = "PR"
    return role


@pytest.fixture(autouse=True)
def _no_db_transaction():
    # The update mutation locks the role row; these tests have no DB.
    with patch("backend.graphene.mutations.access.transaction") as mock_transaction:
        yield mock_transaction


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
    mock_role_model.objects.select_for_update.return_value.get.return_value = role

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
    mock_role_model.objects.select_for_update.return_value.get.return_value = role

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
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Role")
def test_custom_role_update_happy_path_is_preserved(
    mock_role_model, mock_member_model, _mock_permission, _mock_meta, _mock_actor, _mock_audit
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    # Manager actor — the payload is within their grant ceiling
    mock_member_model.objects.get.return_value = _actor_member("manager")

    role = MagicMock()
    role.id = "custom-role"
    role.name = "Auditor"
    role.description = "Old"
    role.color = "#000000"
    role.permissions = {}
    role.is_default = False
    role.managed_key = None
    role.organisation.plan = "PR"
    mock_role_model.objects.select_for_update.return_value.get.return_value = role
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


@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Organisation")
@patch("backend.graphene.mutations.access.Role")
def test_create_rejects_permissions_above_actor_ceiling(
    mock_role_model, mock_org_model, mock_member_model, _mock_permission
):
    from backend.graphene.mutations.access import CreateCustomRoleMutation

    mock_org_model.objects.get.return_value = MagicMock(plan="PR")
    mock_member_model.objects.get.return_value = _actor_member("manager")

    # Manager's template has SSO: []
    with pytest.raises(GraphQLError, match="permissions:SSO:create"):
        CreateCustomRoleMutation.mutate(
            None,
            _info(),
            name="Escalator",
            description="",
            color="",
            permissions={"permissions": {"SSO": ["create"]}, "app_permissions": {}},
            organisation_id="org-1",
        )

    mock_role_model.objects.create.assert_not_called()


@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Role")
def test_update_rejects_permissions_above_actor_ceiling(
    mock_role_model, mock_member_model, _mock_permission
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    role = MagicMock()
    role.is_default = False
    role.managed_key = None
    role.permissions = VALID_POLICY
    role.organisation.plan = "PR"
    mock_role_model.objects.select_for_update.return_value.get.return_value = role
    mock_member_model.objects.get.return_value = _actor_member("manager")

    with pytest.raises(GraphQLError, match="cannot grant permissions"):
        UpdateCustomRoleMutation.mutate(
            None,
            _info(),
            id="custom-role",
            name="Escalator",
            description="",
            color="",
            permissions={"permissions": {"SCIM": ["read"]}, "app_permissions": {}},
        )

    role.save.assert_not_called()


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
def test_create_within_actor_ceiling_succeeds(
    mock_role_model,
    mock_org_model,
    mock_member_model,
    _mock_permission,
    _mock_meta,
    _mock_actor,
    _mock_audit,
):
    from backend.graphene.mutations.access import CreateCustomRoleMutation

    mock_org_model.objects.get.return_value = MagicMock(plan="PR")
    mock_member_model.objects.get.return_value = _actor_member("manager")
    mock_role_model.objects.filter.return_value.exists.return_value = False

    CreateCustomRoleMutation.mutate(
        None,
        _info(),
        name="TeamLead",
        description="",
        color="",
        permissions={
            "permissions": {"Members": ["read"]},
            "app_permissions": {"Secrets": ["read"]},
        },
        organisation_id="org-1",
    )

    mock_role_model.objects.create.assert_called_once()


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
def test_global_access_actor_exempt_from_ceiling(
    mock_role_model,
    mock_org_model,
    mock_member_model,
    _mock_permission,
    _mock_meta,
    _mock_actor,
    _mock_audit,
):
    from backend.graphene.mutations.access import CreateCustomRoleMutation

    mock_org_model.objects.get.return_value = MagicMock(plan="PR")
    # Admin lacks Organisation:delete in its own template but has
    # global_access — the delegation escape hatch
    mock_member_model.objects.get.return_value = _actor_member("admin")
    mock_role_model.objects.filter.return_value.exists.return_value = False

    CreateCustomRoleMutation.mutate(
        None,
        _info(),
        name="OrgManager",
        description="",
        color="",
        permissions={"permissions": {"Organisation": ["delete"]}, "app_permissions": {}},
        organisation_id="org-1",
    )

    mock_role_model.objects.create.assert_called_once()


@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Organisation")
@patch("backend.graphene.mutations.access.Role")
def test_custom_role_actor_ceiling_uses_stored_json(
    mock_role_model, mock_org_model, mock_member_model, _mock_permission
):
    from backend.graphene.mutations.access import CreateCustomRoleMutation

    mock_org_model.objects.get.return_value = MagicMock(plan="PR")
    mock_member_model.objects.get.return_value = _actor_member(
        permissions={
            "permissions": {"Roles": ["create", "read"]},
            "app_permissions": {},
        }
    )

    with pytest.raises(GraphQLError, match="permissions:Members:read"):
        CreateCustomRoleMutation.mutate(
            None,
            _info(),
            name="Escalator",
            description="",
            color="",
            permissions={"permissions": {"Members": ["read"]}, "app_permissions": {}},
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
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Role")
def test_update_allows_de_escalating_role_above_actor_ceiling(
    mock_role_model, mock_member_model, _mock_permission, _mock_meta, _mock_actor, _mock_audit
):
    from api.utils.access.permissions import role_grant_violations
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    # Only additions are ceilinged, so a Manager can strip permissions
    # they don't hold from a grandfathered role
    actor = _actor_member("manager")
    mock_member_model.objects.get.return_value = actor
    above_ceiling = {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
    assert role_grant_violations(actor.role, above_ceiling)

    role = MagicMock()
    role.id = "custom-role"
    role.name = "SSO Admin"
    role.description = "Old"
    role.color = "#000000"
    role.permissions = above_ceiling
    role.is_default = False
    role.managed_key = None
    role.organisation.plan = "PR"
    mock_role_model.objects.select_for_update.return_value.get.return_value = role
    (
        mock_role_model.objects.filter.return_value.exclude.return_value.exists.return_value
    ) = False

    within_ceiling = {"permissions": {"Members": ["read"]}, "app_permissions": {}}
    UpdateCustomRoleMutation.mutate(
        None,
        _info(),
        id=role.id,
        name="Member Reader",
        description="Updated",
        color="#123456",
        permissions=within_ceiling,
    )

    assert role.permissions == within_ceiling
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
@patch("backend.graphene.mutations.access.Role")
def test_update_global_access_actor_exempt_from_ceiling(
    mock_role_model, mock_member_model, _mock_permission, _mock_meta, _mock_actor, _mock_audit
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    # Admin lacks Organisation:delete in its own template but has global_access
    mock_member_model.objects.get.return_value = _actor_member("admin")

    role = MagicMock()
    role.id = "custom-role"
    role.name = "Auditor"
    role.description = "Old"
    role.color = "#000000"
    role.permissions = VALID_POLICY
    role.is_default = False
    role.managed_key = None
    role.organisation.plan = "PR"
    mock_role_model.objects.select_for_update.return_value.get.return_value = role
    (
        mock_role_model.objects.filter.return_value.exclude.return_value.exists.return_value
    ) = False

    org_delete = {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}}
    UpdateCustomRoleMutation.mutate(
        None,
        _info(),
        id=role.id,
        name="OrgManager",
        description="Updated",
        color="#123456",
        permissions=org_delete,
    )

    assert role.permissions == org_delete
    role.save.assert_called_once_with()


SSO_CREATE = {"permissions": {"SSO": ["create"]}, "app_permissions": {}}


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
def test_update_rename_keeps_grandfathered_permissions(
    mock_role_model,
    mock_member_model,
    _mock_permission,
    _mock_meta,
    _mock_actor,
    _mock_audit,
    _no_db_transaction,
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    # Manager below the role's ceiling renames it, resubmitting the policy verbatim
    mock_member_model.objects.get.return_value = _actor_member("manager")
    role = _custom_role(SSO_CREATE)
    mock_role_model.objects.select_for_update.return_value.get.return_value = role
    (
        mock_role_model.objects.filter.return_value.exclude.return_value.exists.return_value
    ) = False

    UpdateCustomRoleMutation.mutate(
        None,
        _info(),
        id=role.id,
        name="SSO Owner",
        description="Renamed",
        color="#123456",
        permissions=SSO_CREATE,
    )

    assert role.name == "SSO Owner"
    assert role.permissions == SSO_CREATE
    role.save.assert_called_once_with()
    # Fetched under a row lock inside a transaction
    _no_db_transaction.atomic.assert_called_once()
    mock_role_model.objects.select_for_update.assert_called_once()


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
def test_update_partial_de_escalation_above_actor_ceiling(
    mock_role_model, mock_member_model, _mock_permission, _mock_meta, _mock_actor, _mock_audit
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    mock_member_model.objects.get.return_value = _actor_member("manager")
    role = _custom_role(
        {"permissions": {"SSO": ["create", "delete"]}, "app_permissions": {}}
    )
    mock_role_model.objects.select_for_update.return_value.get.return_value = role
    (
        mock_role_model.objects.filter.return_value.exclude.return_value.exists.return_value
    ) = False

    UpdateCustomRoleMutation.mutate(
        None,
        _info(),
        id=role.id,
        name="SSO Admin",
        description="Old",
        color="#000000",
        permissions=SSO_CREATE,
    )

    assert role.permissions == SSO_CREATE
    role.save.assert_called_once_with()


@patch("backend.graphene.mutations.access.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.access.OrganisationMember")
@patch("backend.graphene.mutations.access.Role")
def test_update_rejects_only_newly_added_over_ceiling_permissions(
    mock_role_model, mock_member_model, _mock_permission
):
    from backend.graphene.mutations.access import UpdateCustomRoleMutation

    mock_member_model.objects.get.return_value = _actor_member("manager")
    role = _custom_role(SSO_CREATE)
    mock_role_model.objects.select_for_update.return_value.get.return_value = role

    with pytest.raises(GraphQLError) as excinfo:
        UpdateCustomRoleMutation.mutate(
            None,
            _info(),
            id=role.id,
            name="SSO Admin",
            description="Old",
            color="#000000",
            permissions={
                "permissions": {"SSO": ["create"], "SCIM": ["read"]},
                "app_permissions": {},
            },
        )

    assert "permissions:SCIM:read" in str(excinfo.value)
    assert "SSO:create" not in str(excinfo.value)
    assert role.permissions == SSO_CREATE
    role.save.assert_not_called()
