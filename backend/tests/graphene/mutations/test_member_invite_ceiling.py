"""Grant ceiling for BulkInviteOrganisationMembersMutation: an invite role
must be within the inviter's own permissions (global-access inviters exempt).
"""

from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


def _info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


def _actor_member(managed_key):
    member = MagicMock()
    member.role.is_default = True
    member.role.managed_key = managed_key
    member.role.permissions = {}
    return member


def _custom_role(name, permissions):
    role = MagicMock()
    role.is_default = False
    role.managed_key = None
    role.name = name
    role.permissions = permissions
    return role


def _invite(role_id="role-1", email="new@example.com"):
    invite = MagicMock()
    invite.email = email
    invite.apps = []
    invite.role_id = role_id
    return invite


STRONG_ROLE_PERMISSIONS = {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
WEAK_ROLE_PERMISSIONS = {
    "permissions": {"Logs": ["read"]},
    "app_permissions": {"Secrets": ["read"]},
}
# Admin holds only Organisation read/update, so this is above its own ceiling
BEYOND_ADMIN_ROLE_PERMISSIONS = {
    "permissions": {"Organisation": ["delete"]},
    "app_permissions": {},
}


def _arrange(
    mock_org_model,
    mock_member_model,
    mock_role_model,
    mock_app_model,
    mock_invite_model,
    actor,
    role,
):
    mock_org_model.objects.get.return_value = MagicMock()
    mock_member_model.objects.get.return_value = actor
    mock_member_model.objects.filter.return_value.exists.return_value = False
    # Custom roles without global access or SA-token create pass the invite
    # safelist, so only the ceiling can reject them
    mock_role_model.objects.filter.return_value = [role]
    mock_role_model.objects.get.return_value = role
    mock_app_model.objects.filter.return_value = []
    mock_invite_model.objects.filter.return_value.exists.return_value = False


def _mutate(invites=None):
    from backend.graphene.mutations.organisation import (
        BulkInviteOrganisationMembersMutation,
    )

    return BulkInviteOrganisationMembersMutation.mutate(
        None, _info(), org_id="org-1", invites=invites or [_invite()]
    )


@patch("backend.graphene.mutations.organisation.log_audit_event")
@patch(
    "backend.graphene.mutations.organisation.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.organisation.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.organisation.send_invite_email_job")
@patch("backend.graphene.mutations.organisation.can_add_account", return_value=True)
@patch("backend.graphene.mutations.organisation.user_is_org_member", return_value=True)
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.organisation.OrganisationMemberInvite")
@patch("backend.graphene.mutations.organisation.App")
@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.Organisation")
def test_bulk_invite_rejects_role_above_actor_ceiling(
    mock_org_model,
    mock_member_model,
    mock_role_model,
    mock_app_model,
    mock_invite_model,
    _permission,
    _is_member,
    _quota,
    _email,
    _meta,
    _actor,
    _audit,
):
    _arrange(
        mock_org_model,
        mock_member_model,
        mock_role_model,
        mock_app_model,
        mock_invite_model,
        actor=_actor_member("manager"),
        role=_custom_role("SSO Admin", STRONG_ROLE_PERMISSIONS),
    )

    with pytest.raises(
        GraphQLError, match="You cannot assign the 'SSO Admin' role"
    ) as exc_info:
        _mutate()

    assert "permissions:SSO:create" in str(exc_info.value)
    mock_invite_model.objects.create.assert_not_called()


@patch("backend.graphene.mutations.organisation.log_audit_event")
@patch(
    "backend.graphene.mutations.organisation.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.organisation.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.organisation.send_invite_email_job")
@patch("backend.graphene.mutations.organisation.can_add_account", return_value=True)
@patch("backend.graphene.mutations.organisation.user_is_org_member", return_value=True)
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.organisation.OrganisationMemberInvite")
@patch("backend.graphene.mutations.organisation.App")
@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.Organisation")
def test_bulk_invite_accepts_role_within_actor_ceiling(
    mock_org_model,
    mock_member_model,
    mock_role_model,
    mock_app_model,
    mock_invite_model,
    _permission,
    _is_member,
    _quota,
    _email,
    _meta,
    _actor,
    _audit,
):
    _arrange(
        mock_org_model,
        mock_member_model,
        mock_role_model,
        mock_app_model,
        mock_invite_model,
        actor=_actor_member("manager"),
        role=_custom_role("Auditor", WEAK_ROLE_PERMISSIONS),
    )

    result = _mutate()

    mock_invite_model.objects.create.assert_called_once()
    assert result.invites == [mock_invite_model.objects.create.return_value]


@patch("backend.graphene.mutations.organisation.log_audit_event")
@patch(
    "backend.graphene.mutations.organisation.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.organisation.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.organisation.send_invite_email_job")
@patch("backend.graphene.mutations.organisation.can_add_account", return_value=True)
@patch("backend.graphene.mutations.organisation.user_is_org_member", return_value=True)
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.organisation.OrganisationMemberInvite")
@patch("backend.graphene.mutations.organisation.App")
@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.Organisation")
def test_bulk_invite_global_access_actor_exempt_from_ceiling(
    mock_org_model,
    mock_member_model,
    mock_role_model,
    mock_app_model,
    mock_invite_model,
    _permission,
    _is_member,
    _quota,
    _email,
    _meta,
    _actor,
    _audit,
):
    """Admin lacks Organisation:delete itself, but global access is the
    delegation escape hatch so it can still invite with that role."""
    _arrange(
        mock_org_model,
        mock_member_model,
        mock_role_model,
        mock_app_model,
        mock_invite_model,
        actor=_actor_member("admin"),
        role=_custom_role("Org Deleter", BEYOND_ADMIN_ROLE_PERMISSIONS),
    )

    _mutate()

    mock_invite_model.objects.create.assert_called_once()


@patch("backend.graphene.mutations.organisation.log_audit_event")
@patch(
    "backend.graphene.mutations.organisation.get_actor_info_from_graphql",
    return_value=("user", "member-1", {}),
)
@patch(
    "backend.graphene.mutations.organisation.get_resolver_request_meta",
    return_value=("127.0.0.1", "pytest"),
)
@patch("backend.graphene.mutations.organisation.send_invite_email_job")
@patch("backend.graphene.mutations.organisation.can_add_account", return_value=True)
@patch("backend.graphene.mutations.organisation.user_is_org_member", return_value=True)
@patch("backend.graphene.mutations.organisation.user_has_permission", return_value=True)
@patch("backend.graphene.mutations.organisation.OrganisationMemberInvite")
@patch("backend.graphene.mutations.organisation.App")
@patch("backend.graphene.mutations.organisation.Role")
@patch("backend.graphene.mutations.organisation.OrganisationMember")
@patch("backend.graphene.mutations.organisation.Organisation")
def test_bulk_invite_mixed_batch_creates_nothing(
    mock_org_model,
    mock_member_model,
    mock_role_model,
    mock_app_model,
    mock_invite_model,
    _permission,
    _is_member,
    _quota,
    mock_email,
    _meta,
    _actor,
    mock_audit,
):
    """A batch is validated in full before any invite is created, so one
    role above the ceiling must not leave earlier invites half-applied."""
    weak_role = _custom_role("Auditor", WEAK_ROLE_PERMISSIONS)
    strong_role = _custom_role("SSO Admin", STRONG_ROLE_PERMISSIONS)
    _arrange(
        mock_org_model,
        mock_member_model,
        mock_role_model,
        mock_app_model,
        mock_invite_model,
        actor=_actor_member("manager"),
        role=weak_role,
    )
    roles_by_id = {"auditor": weak_role, "sso-admin": strong_role}
    mock_role_model.objects.filter.return_value = list(roles_by_id.values())
    mock_role_model.objects.get.side_effect = lambda organisation, id: roles_by_id[id]

    with pytest.raises(GraphQLError, match="You cannot assign the 'SSO Admin' role"):
        _mutate(
            invites=[
                _invite("auditor", email="first@example.com"),
                _invite("sso-admin", email="second@example.com"),
            ]
        )

    mock_invite_model.objects.create.assert_not_called()
    mock_email.assert_not_called()
    mock_audit.assert_not_called()
