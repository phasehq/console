from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


def _actor_member(managed_key=None, permissions=None):
    member = MagicMock()
    member.role.is_default = managed_key is not None
    member.role.managed_key = managed_key
    member.role.permissions = permissions if permissions is not None else {}
    return member


def _custom_role(name, permissions):
    role = MagicMock()
    role.is_default = False
    role.managed_key = None
    role.name = name
    role.permissions = permissions
    return role


@patch("backend.graphene.mutations.service_accounts.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.service_accounts._validate_handler_members")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Organisation")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
def test_create_sa_rejects_role_above_actor_ceiling(
    mock_sa_model,
    mock_role_model,
    mock_org_model,
    mock_member_model,
    _mock_handlers,
    _mock_permission,
):
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountMutation,
    )

    mock_org_model.objects.get.return_value = MagicMock()
    mock_member_model.objects.get.return_value = _actor_member("manager")
    mock_role_model.objects.get.return_value = _custom_role(
        "SSO Admin", {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
    )

    with pytest.raises(GraphQLError, match="You cannot assign the 'SSO Admin' role"):
        CreateServiceAccountMutation.mutate(
            None,
            _info(),
            name="new-sa",
            organisation_id="org-1",
            role_id="role-1",
            handlers=[MagicMock()],
            identity_key="aa" * 32,
        )

    mock_sa_model.objects.create.assert_not_called()


@patch("backend.graphene.mutations.service_accounts._check_sa_permission")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
def test_update_sa_rejects_role_change_above_actor_ceiling(
    mock_sa_model, mock_role_model, mock_member_model, _mock_sa_perm
):
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountMutation,
    )

    service_account = MagicMock()
    service_account.role_id = "old-role"
    service_account.team = None
    mock_sa_model.objects.get.return_value = service_account

    strong_role = _custom_role(
        "SSO Admin", {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
    )
    strong_role.id = "new-role"
    mock_role_model.objects.get.return_value = strong_role
    mock_member_model.objects.get.return_value = _actor_member("manager")

    with pytest.raises(GraphQLError, match="You cannot assign the 'SSO Admin' role"):
        UpdateServiceAccountMutation.mutate(
            None,
            _info(),
            service_account_id="sa-1",
            name="renamed",
            role_id="new-role",
        )

    service_account.save.assert_not_called()


@patch("backend.graphene.mutations.service_accounts._check_sa_permission")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
def test_update_sa_keeping_current_role_skips_ceiling(
    mock_sa_model, mock_role_model, mock_member_model, _mock_sa_perm
):
    # SA already holds a role above the actor's ceiling — a rename keeping
    # the same role grants nothing new and must succeed
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountMutation,
    )

    strong_role = _custom_role(
        "SSO Admin", {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
    )
    strong_role.id = "role-1"

    service_account = MagicMock()
    service_account.role_id = "role-1"
    service_account.team = None
    mock_sa_model.objects.get.return_value = service_account
    mock_role_model.objects.get.return_value = strong_role

    UpdateServiceAccountMutation.mutate(
        None,
        _info(),
        service_account_id="sa-1",
        name="renamed",
        role_id="role-1",
    )

    mock_member_model.objects.get.assert_not_called()
    service_account.save.assert_called_once()


@patch("backend.graphene.mutations.service_accounts.log_audit_event")
@patch(
    "backend.graphene.mutations.service_accounts.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.service_accounts.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.service_accounts.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.service_accounts._validate_handler_members")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Organisation")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccountHandler")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
@patch("backend.graphene.mutations.service_accounts.transaction")
@patch("backend.graphene.mutations.service_accounts.settings")
def test_create_sa_within_ceiling_succeeds(
    mock_settings,
    _mock_tx,
    mock_sa_model,
    _mock_handler_model,
    mock_role_model,
    mock_org_model,
    mock_member_model,
    _mock_handlers,
    _mock_permission,
    _mock_meta,
    _mock_actor,
    _mock_audit,
):
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountMutation,
    )

    mock_settings.APP_HOST = "selfhosted"
    mock_org_model.objects.get.return_value = MagicMock()
    mock_member_model.objects.get.return_value = _actor_member("manager")

    # Default Service role resolves via template — within Manager's ceiling
    service_role = MagicMock()
    service_role.is_default = True
    service_role.managed_key = "service"
    service_role.permissions = {}
    mock_role_model.objects.get.return_value = service_role

    CreateServiceAccountMutation.mutate(
        None,
        _info(),
        name="new-sa",
        organisation_id="org-1",
        role_id="role-1",
        handlers=[MagicMock()],
        identity_key="aa" * 32,
    )

    mock_sa_model.objects.create.assert_called_once()


def _team_with_override(permissions):
    team = MagicMock()
    team.owner_id = None
    team.member_role = _custom_role("SA Manager", permissions)
    return team


SA_MANAGER_OVERRIDE = {
    "permissions": {"ServiceAccounts": ["create", "read"]},
    "app_permissions": {},
}

# The permission gate needs ServiceAccounts:update before the ceiling is reached
SA_MANAGER_UPDATE_OVERRIDE = {
    "permissions": {"ServiceAccounts": ["create", "read", "update"]},
    "app_permissions": {},
}


@patch("backend.graphene.mutations.service_accounts.TeamMembership")
@patch("backend.graphene.mutations.service_accounts.Team")
@patch("backend.graphene.mutations.service_accounts._validate_handler_members")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Organisation")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
def test_team_create_rejects_role_above_union_ceiling(
    mock_sa_model,
    mock_role_model,
    mock_org_model,
    mock_member_model,
    _mock_handlers,
    mock_team_model,
    mock_membership_model,
):
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountMutation,
    )

    mock_org_model.objects.get.return_value = MagicMock()
    mock_member_model.objects.get.return_value = _actor_member("developer")
    mock_team_model.objects.get.return_value = _team_with_override(SA_MANAGER_OVERRIDE)
    mock_membership_model.objects.filter.return_value.exists.return_value = True
    mock_role_model.objects.get.return_value = _custom_role(
        "SSO Admin", {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
    )

    with pytest.raises(GraphQLError, match="You cannot assign the 'SSO Admin' role"):
        CreateServiceAccountMutation.mutate(
            None,
            _info(),
            name="new-sa",
            organisation_id="org-1",
            role_id="role-1",
            handlers=[MagicMock()],
            identity_key="aa" * 32,
            team_id="team-1",
        )

    mock_sa_model.objects.create.assert_not_called()


@patch("backend.graphene.mutations.service_accounts.log_audit_event")
@patch(
    "backend.graphene.mutations.service_accounts.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.service_accounts.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.service_accounts.TeamAppEnvironment")
@patch("backend.graphene.mutations.service_accounts.TeamMembership")
@patch("backend.graphene.mutations.service_accounts.Team")
@patch("backend.graphene.mutations.service_accounts._validate_handler_members")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Organisation")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccountHandler")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
@patch("backend.graphene.mutations.service_accounts.transaction")
@patch("backend.graphene.mutations.service_accounts.settings")
def test_team_create_union_ceiling_covers_role_neither_role_covers_alone(
    mock_settings,
    _mock_tx,
    mock_sa_model,
    _mock_handler_model,
    mock_role_model,
    mock_org_model,
    mock_member_model,
    _mock_handlers,
    mock_team_model,
    mock_membership_model,
    mock_team_app_env_model,
    _mock_meta,
    _mock_actor,
    _mock_audit,
):
    from api.utils.access.permissions import role_assignment_error
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountMutation,
    )

    mock_settings.APP_HOST = "selfhosted"
    mock_org_model.objects.get.return_value = MagicMock()
    actor = _actor_member("developer")
    mock_member_model.objects.get.return_value = actor
    team = _team_with_override(SA_MANAGER_OVERRIDE)
    mock_team_model.objects.get.return_value = team
    mock_membership_model.objects.filter.return_value.exists.return_value = True
    mock_membership_model.objects.get_or_create.return_value = (MagicMock(), True)
    (
        mock_team_app_env_model.objects.filter.return_value.values_list.return_value.distinct.return_value
    ) = []

    # Developer holds Members:read but no ServiceAccounts; the override
    # holds ServiceAccounts but no Members — only the union covers both
    target = _custom_role(
        "SA Reader",
        {
            "permissions": {"ServiceAccounts": ["read"], "Members": ["read"]},
            "app_permissions": {},
        },
    )
    mock_role_model.objects.get.return_value = target
    assert role_assignment_error([actor.role], target) is not None
    assert role_assignment_error([team.member_role], target) is not None

    CreateServiceAccountMutation.mutate(
        None,
        _info(),
        name="new-sa",
        organisation_id="org-1",
        role_id="role-1",
        handlers=[MagicMock()],
        identity_key="aa" * 32,
        team_id="team-1",
    )

    mock_sa_model.objects.create.assert_called_once()


@patch("backend.graphene.mutations.service_accounts._check_sa_permission")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
def test_update_team_owned_sa_ceiling_includes_team_override(
    mock_sa_model, mock_role_model, mock_member_model, _mock_sa_perm
):
    from api.utils.access.permissions import role_assignment_error
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountMutation,
    )

    service_account = MagicMock()
    service_account.role_id = "old-role"
    service_account.team = _team_with_override(SA_MANAGER_UPDATE_OVERRIDE)
    mock_sa_model.objects.get.return_value = service_account

    new_role = _custom_role(
        "SA Reader",
        {"permissions": {"ServiceAccounts": ["read"]}, "app_permissions": {}},
    )
    new_role.id = "new-role"
    mock_role_model.objects.get.return_value = new_role
    actor = _actor_member("developer")
    mock_member_model.objects.get.return_value = actor
    # Developer alone is below the target; the override is what covers it
    assert role_assignment_error([actor.role], new_role) is not None

    UpdateServiceAccountMutation.mutate(
        None,
        _info(),
        service_account_id="sa-1",
        name="renamed",
        role_id="new-role",
    )

    assert service_account.role is new_role
    service_account.save.assert_called_once()


ORG_DELETE_ROLE = {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}}


@patch("backend.graphene.mutations.service_accounts.log_audit_event")
@patch(
    "backend.graphene.mutations.service_accounts.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.service_accounts.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.service_accounts.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.service_accounts._validate_handler_members")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Organisation")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccountHandler")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
@patch("backend.graphene.mutations.service_accounts.transaction")
@patch("backend.graphene.mutations.service_accounts.settings")
def test_create_sa_global_access_actor_exempt_from_ceiling(
    mock_settings,
    _mock_tx,
    mock_sa_model,
    _mock_handler_model,
    mock_role_model,
    mock_org_model,
    mock_member_model,
    _mock_handlers,
    _mock_permission,
    _mock_meta,
    _mock_actor,
    _mock_audit,
):
    from backend.graphene.mutations.service_accounts import (
        CreateServiceAccountMutation,
    )

    mock_settings.APP_HOST = "selfhosted"
    mock_org_model.objects.get.return_value = MagicMock()
    # Admin lacks Organisation:delete in its own template but has
    # global_access — the delegation escape hatch
    mock_member_model.objects.get.return_value = _actor_member("admin")
    mock_role_model.objects.get.return_value = _custom_role("OrgManager", ORG_DELETE_ROLE)

    CreateServiceAccountMutation.mutate(
        None,
        _info(),
        name="new-sa",
        organisation_id="org-1",
        role_id="role-1",
        handlers=[MagicMock()],
        identity_key="aa" * 32,
    )

    mock_sa_model.objects.create.assert_called_once()


@patch("backend.graphene.mutations.service_accounts._check_sa_permission")
@patch("backend.graphene.mutations.service_accounts.OrganisationMember")
@patch("backend.graphene.mutations.service_accounts.Role")
@patch("backend.graphene.mutations.service_accounts.ServiceAccount")
def test_update_sa_global_access_actor_exempt_from_ceiling(
    mock_sa_model, mock_role_model, mock_member_model, _mock_sa_perm
):
    from backend.graphene.mutations.service_accounts import (
        UpdateServiceAccountMutation,
    )

    service_account = MagicMock()
    service_account.role_id = "old-role"
    service_account.team = None
    mock_sa_model.objects.get.return_value = service_account

    new_role = _custom_role("OrgManager", ORG_DELETE_ROLE)
    new_role.id = "new-role"
    mock_role_model.objects.get.return_value = new_role
    mock_member_model.objects.get.return_value = _actor_member("admin")

    UpdateServiceAccountMutation.mutate(
        None,
        _info(),
        service_account_id="sa-1",
        name="renamed",
        role_id="new-role",
    )

    assert service_account.role is new_role
    service_account.save.assert_called_once()
