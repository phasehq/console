import pytest
from unittest.mock import MagicMock, patch
from api.utils.access.permissions import (
    role_has_permission,
    user_has_permission,
    role_has_global_access,
    get_role_effective_policy,
    role_grant_violations,
    role_update_grant_violations,
    can_grant_role,
    roles_grant_violations,
    role_assignment_error,
)
from api.utils.access.roles import (
    ADMIN_ROLE_KEY,
    DEVELOPER_ROLE_KEY,
    MANAGER_ROLE_KEY,
    OWNER_ROLE_KEY,
    SERVICE_ROLE_KEY,
)


def _default_role(managed_key):
    role = MagicMock()
    role.is_default = True
    role.managed_key = managed_key
    role.permissions = {}  # default roles store empty DB JSON
    return role


def _custom_role(permissions):
    role = MagicMock()
    role.is_default = False
    role.managed_key = None
    role.permissions = permissions
    return role


class TestRoleHasPermission:
    def test_role_is_none(self):
        assert role_has_permission(None, "read", "Users") is False

    def test_default_role_permission(self):
        role = MagicMock()
        role.is_default = True
        role.name = "Renamed administrator"
        role.managed_key = ADMIN_ROLE_KEY

        # Admin has broad access
        assert role_has_permission(role, "create", "Apps") is True
        assert role_has_permission(role, "delete", "Members") is True
        assert role_has_permission(role, "unknown", "Apps") is False

    def test_default_role_app_permission(self):
        role = MagicMock()
        role.is_default = True
        role.name = "admin"
        role.managed_key = ADMIN_ROLE_KEY

        assert (
            role_has_permission(role, "create", "Secrets", is_app_resource=True) is True
        )
        assert (
            role_has_permission(role, "delete", "Secrets", is_app_resource=True) is True
        )

    def test_developer_role_restrictions(self):
        role = MagicMock()
        role.is_default = True
        role.name = "developer"
        role.managed_key = DEVELOPER_ROLE_KEY

        # Developer can read apps but not create/delete
        assert role_has_permission(role, "read", "Apps") is True
        assert role_has_permission(role, "create", "Apps") is False
        assert role_has_permission(role, "delete", "Apps") is False

        # Developer can create secrets
        assert (
            role_has_permission(role, "create", "Secrets", is_app_resource=True) is True
        )

    def test_custom_role_permission(self):
        role = MagicMock()
        role.is_default = False
        role.permissions = {
            "permissions": {
                "Users": ["read"],
            },
            "app_permissions": {
                "Secrets": ["read"],
            },
        }

        assert role_has_permission(role, "read", "Users") is True
        assert role_has_permission(role, "create", "Users") is False

    def test_custom_role_null_permission_maps(self):
        # The validator allows null maps, so this shape is authorable
        role = MagicMock()
        role.is_default = False
        role.permissions = {"permissions": None, "app_permissions": None}

        assert role_has_permission(role, "read", "Members") is False
        assert (
            role_has_permission(role, "read", "Secrets", is_app_resource=True) is False
        )

    def test_custom_role_app_permission(self):
        role = MagicMock()
        role.is_default = False
        role.permissions = {
            "permissions": {},
            "app_permissions": {
                "Secrets": ["read"],
            },
        }

        assert (
            role_has_permission(role, "read", "Secrets", is_app_resource=True) is True
        )
        assert (
            role_has_permission(role, "create", "Secrets", is_app_resource=True)
            is False
        )


class TestUserHasPermission:
    @patch("api.utils.access.permissions.apps.get_model")
    def test_user_has_permission_success(self, mock_get_model):
        # Setup mocks
        MockOrganisationMember = MagicMock()
        mock_get_model.return_value = MockOrganisationMember

        mock_user = MagicMock()
        mock_org = MagicMock()

        mock_member = MagicMock()
        mock_member.role.is_default = True
        mock_member.role.name = "admin"
        mock_member.role.managed_key = ADMIN_ROLE_KEY

        MockOrganisationMember.objects.get.return_value = mock_member

        # Test
        assert user_has_permission(mock_user, "create", "Apps", mock_org) is True

        # Verify call
        MockOrganisationMember.objects.get.assert_called_with(
            user=mock_user, organisation=mock_org, deleted_at=None
        )

    @patch("api.utils.access.permissions.apps.get_model")
    def test_user_not_member(self, mock_get_model):
        # Setup mocks
        MockOrganisationMember = MagicMock()
        mock_get_model.return_value = MockOrganisationMember

        # Simulate DoesNotExist
        MockOrganisationMember.DoesNotExist = Exception
        MockOrganisationMember.objects.get.side_effect = (
            MockOrganisationMember.DoesNotExist
        )

        assert user_has_permission(MagicMock(), "read", "Users", MagicMock()) is False

    @patch("api.utils.access.permissions.apps.get_model")
    def test_service_account_permission(self, mock_get_model):
        # Mock OrganisationMember
        MockOrganisationMember = MagicMock()
        mock_get_model.return_value = MockOrganisationMember

        # For service account, the account passed is the org_member (or behaves like one)
        mock_sa_member = MagicMock()
        mock_sa_member.role.is_default = True
        mock_sa_member.role.name = "developer"
        mock_sa_member.role.managed_key = DEVELOPER_ROLE_KEY

        assert (
            user_has_permission(
                mock_sa_member, "read", "Apps", MagicMock(), is_service_account=True
            )
            is True
        )
        assert (
            user_has_permission(
                mock_sa_member, "create", "Apps", MagicMock(), is_service_account=True
            )
            is False
        )


@patch("api.utils.access.permissions.apps.get_model")
class TestRoleHasGlobalAccess:
    def test_default_role_global_access(self, mock_get_model):
        MockRole = MagicMock()
        MockRole.DoesNotExist = Exception
        mock_get_model.return_value = MockRole

        role = MagicMock()
        role.is_default = True
        role.name = "admin"
        role.managed_key = ADMIN_ROLE_KEY
        assert role_has_global_access(role) is True

        role.name = "developer"
        role.managed_key = DEVELOPER_ROLE_KEY
        assert role_has_global_access(role) is False

    def test_custom_role_global_access(self, mock_get_model):
        MockRole = MagicMock()
        MockRole.DoesNotExist = Exception
        mock_get_model.return_value = MockRole

        role = MagicMock()
        role.is_default = False
        role.permissions = {"global_access": True}
        assert role_has_global_access(role) is False

        role.permissions = {"global_access": False}
        assert role_has_global_access(role) is False

    def test_custom_role_named_admin_has_no_global_access(self, mock_get_model):
        role = MagicMock()
        role.is_default = False
        role.name = "Admin"
        role.managed_key = None
        role.permissions = {"global_access": True}

        assert role_has_global_access(role) is False

    def test_invalid_default_role_state_fails_closed(self, mock_get_model):
        role = MagicMock()
        role.is_default = True
        role.name = "Owner"
        role.managed_key = None

        assert role_has_global_access(role) is False
        assert role_has_permission(role, "delete", "Roles") is False


class TestGetRoleEffectivePolicy:
    def test_none_role(self):
        assert get_role_effective_policy(None) == ({}, {}, False)

    def test_default_role_resolves_template_not_db_json(self):
        role = _default_role(MANAGER_ROLE_KEY)
        org_perms, app_perms, global_access = get_role_effective_policy(role)

        assert org_perms["Roles"] == ["create", "read", "update", "delete"]
        assert app_perms["Secrets"] == ["create", "read", "update", "delete"]
        assert global_access is False

    def test_default_owner_has_global_access(self):
        assert get_role_effective_policy(_default_role(OWNER_ROLE_KEY))[2] is True

    def test_custom_role_reads_stored_json(self):
        role = _custom_role(
            {
                "permissions": {"Members": ["read"]},
                "app_permissions": {"Secrets": ["read", "update"]},
            }
        )
        org_perms, app_perms, global_access = get_role_effective_policy(role)

        assert org_perms == {"Members": ["read"]}
        assert app_perms == {"Secrets": ["read", "update"]}
        assert global_access is False

    def test_custom_role_stored_global_access_is_inert(self):
        role = _custom_role(
            {"permissions": {}, "app_permissions": {}, "global_access": True}
        )
        assert get_role_effective_policy(role)[2] is False

    def test_custom_role_null_permissions(self):
        assert get_role_effective_policy(_custom_role(None)) == ({}, {}, False)


class TestRoleGrantViolations:
    def test_grant_within_own_policy(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        assert (
            role_grant_violations(
                manager,
                {
                    "permissions": {"Members": ["read", "update"]},
                    "app_permissions": {"Secrets": ["create", "read"]},
                },
            )
            == []
        )

    def test_default_role_actor_compared_via_template(self):
        # Manager's DB JSON is empty — a raw-JSON comparison would flag everything
        manager = _default_role(MANAGER_ROLE_KEY)
        violations = role_grant_violations(
            manager,
            {
                "permissions": {
                    "Organisation": ["read", "delete"],
                    "SSO": ["create"],
                },
                "app_permissions": {},
            },
        )
        assert violations == [
            "permissions:Organisation:delete",
            "permissions:SSO:create",
        ]

    def test_missing_resource_key_grants_nothing(self):
        # Manager's template has no MemberPersonalAccessTokens key at all
        manager = _default_role(MANAGER_ROLE_KEY)
        violations = role_grant_violations(
            manager,
            {
                "permissions": {"MemberPersonalAccessTokens": ["read"]},
                "app_permissions": {},
            },
        )
        assert violations == ["permissions:MemberPersonalAccessTokens:read"]

    def test_scopes_compared_independently(self):
        actor = _custom_role(
            {
                "permissions": {"ServiceAccounts": ["create", "read"]},
                "app_permissions": {},
            }
        )
        violations = role_grant_violations(
            actor,
            {
                "permissions": {"ServiceAccounts": ["create"]},
                "app_permissions": {"ServiceAccounts": ["create"]},
            },
        )
        assert violations == ["app_permissions:ServiceAccounts:create"]

    def test_global_access_needs_global_actor(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        assert role_grant_violations(
            manager, {"permissions": {}, "app_permissions": {}, "global_access": True}
        ) == ["global_access"]

    def test_global_access_actor_is_exempt(self):
        admin = _default_role(ADMIN_ROLE_KEY)
        # Admin's own template lacks Organisation:delete, but global access
        # is the delegation escape hatch
        assert (
            role_grant_violations(
                admin,
                {
                    "permissions": {"Organisation": ["delete"]},
                    "app_permissions": {},
                    "global_access": True,
                },
            )
            == []
        )

    def test_no_actor_role_fails_closed(self):
        assert role_grant_violations(
            None, {"permissions": {"Members": ["read"]}, "app_permissions": {}}
        ) == ["permissions:Members:read"]

    def test_unknown_resource_fails_closed(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        assert role_grant_violations(
            manager, {"permissions": {"NotAResource": ["read"]}, "app_permissions": {}}
        ) == ["permissions:NotAResource:read"]

    def test_duplicate_actions_reported_once(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        assert role_grant_violations(
            manager,
            {"permissions": {"SSO": ["create", "create"]}, "app_permissions": {}},
        ) == ["permissions:SSO:create"]

    def test_empty_target_policy(self):
        assert role_grant_violations(_default_role(DEVELOPER_ROLE_KEY), {}) == []

    def test_malformed_actor_policy_grants_nothing(self):
        # Legacy pre-validation rows can store arbitrary JSON shapes
        for stored in (["read"], "read", 123, {"permissions": ["read"]}):
            actor = _custom_role(stored)
            assert role_grant_violations(
                actor, {"permissions": {"Members": ["read"]}, "app_permissions": {}}
            ) == ["permissions:Members:read"]

    def test_malformed_actor_actions_grant_nothing(self):
        actor = _custom_role(
            {"permissions": {"Members": "read"}, "app_permissions": {}}
        )
        assert role_grant_violations(
            actor, {"permissions": {"Members": ["read"]}, "app_permissions": {}}
        ) == ["permissions:Members:read"]

    def test_malformed_target_scope_is_a_violation(self):
        # String actions substring-match at enforcement, so malformed target
        # shapes must fail the ceiling — never coerce to empty
        manager = _default_role(MANAGER_ROLE_KEY)
        assert role_grant_violations(
            manager, {"permissions": ["read"], "app_permissions": {}}
        ) == ["permissions:invalid"]

    def test_malformed_target_actions_are_a_violation(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        for actions in ("createreadupdatedelete", 5, True, [{"read": True}]):
            assert role_grant_violations(
                manager,
                {"permissions": {"Members": actions}, "app_permissions": {}},
            ) == ["permissions:Members:invalid"]


class TestRoleUpdateGrantViolations:
    """Edits are ceilinged on what they add; whatever the role already held
    beyond the actor's ceiling is grandfathered."""

    GRANDFATHERED = {"permissions": {"SSO": ["create"]}, "app_permissions": {}}

    def test_unchanged_policy_is_not_a_violation(self):
        # Rename-only edits resubmit the stored policy verbatim
        manager = _default_role(MANAGER_ROLE_KEY)
        assert role_grant_violations(manager, self.GRANDFATHERED) == [
            "permissions:SSO:create"
        ]
        assert (
            role_update_grant_violations(
                manager, _custom_role(self.GRANDFATHERED), self.GRANDFATHERED
            )
            == []
        )

    def test_partial_de_escalation(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        current = _custom_role(
            {"permissions": {"SSO": ["create", "delete"]}, "app_permissions": {}}
        )
        assert (
            role_update_grant_violations(manager, current, self.GRANDFATHERED) == []
        )

    def test_keep_grandfathered_and_add_within_ceiling(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        new_policy = {
            "permissions": {"SSO": ["create"], "Members": ["read"]},
            "app_permissions": {},
        }
        assert (
            role_update_grant_violations(
                manager, _custom_role(self.GRANDFATHERED), new_policy
            )
            == []
        )

    def test_only_new_over_ceiling_permissions_reported(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        new_policy = {
            "permissions": {"SSO": ["create"], "SCIM": ["read"]},
            "app_permissions": {},
        }
        assert role_update_grant_violations(
            manager, _custom_role(self.GRANDFATHERED), new_policy
        ) == ["permissions:SCIM:read"]

    def test_widening_grandfathered_resource_reports_new_action(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        new_policy = {
            "permissions": {"SSO": ["create", "delete"]},
            "app_permissions": {},
        }
        assert role_update_grant_violations(
            manager, _custom_role(self.GRANDFATHERED), new_policy
        ) == ["permissions:SSO:delete"]

    def test_global_access_is_never_grandfathered(self):
        # Custom roles have no effective global access, so it is always an addition
        manager = _default_role(MANAGER_ROLE_KEY)
        current = _custom_role({**self.GRANDFATHERED, "global_access": True})
        assert role_update_grant_violations(
            manager, current, {**self.GRANDFATHERED, "global_access": True}
        ) == ["global_access"]

    def test_malformed_current_policy_does_not_launder_addition(self):
        # "<scope>:<resource>:invalid" never matches a well-formed violation
        manager = _default_role(MANAGER_ROLE_KEY)
        current = _custom_role(
            {"permissions": {"SSO": "create"}, "app_permissions": {}}
        )
        assert role_update_grant_violations(
            manager, current, self.GRANDFATHERED
        ) == ["permissions:SSO:create"]

    def test_default_current_role_grandfathers_nothing(self):
        # A default role's effective policy is the whole managed template,
        # so grandfathering against one would cancel every violation
        manager = _default_role(MANAGER_ROLE_KEY)
        new_policy = {
            "permissions": {"SSO": ["create", "delete"]},
            "app_permissions": {},
        }
        assert role_update_grant_violations(
            manager, _default_role(OWNER_ROLE_KEY), new_policy
        ) == role_grant_violations(manager, new_policy)

    def test_malformed_current_resource_cannot_cancel_literal_invalid_action(self):
        # Stored SSO: "create" emits "permissions:SSO:invalid" — the same
        # string a new policy granting the literal action "invalid" emits
        manager = _default_role(MANAGER_ROLE_KEY)
        current = _custom_role(
            {"permissions": {"SSO": "create"}, "app_permissions": {}}
        )
        new_policy = {
            "permissions": {"SSO": ["invalid"]},
            "app_permissions": {},
        }
        assert role_update_grant_violations(manager, current, new_policy) == [
            "permissions:SSO:invalid"
        ]

    def test_malformed_current_scope_cannot_cancel_malformed_new_scope(self):
        # Both shapes emit "permissions:invalid"
        manager = _default_role(MANAGER_ROLE_KEY)
        current = _custom_role({"permissions": ["read"], "app_permissions": {}})
        new_policy = {"permissions": "everything", "app_permissions": {}}
        assert role_update_grant_violations(manager, current, new_policy) == [
            "permissions:invalid"
        ]

    def test_malformed_current_policy_grandfathers_nothing_at_all(self):
        # One malformed marker disables grandfathering for the whole edit
        manager = _default_role(MANAGER_ROLE_KEY)
        current = _custom_role(
            {
                "permissions": {"SSO": "create", "SCIM": ["read"]},
                "app_permissions": {},
            }
        )
        new_policy = {
            "permissions": {"SCIM": ["read"]},
            "app_permissions": {},
        }
        assert role_update_grant_violations(manager, current, new_policy) == [
            "permissions:SCIM:read"
        ]

    def test_no_current_role_matches_full_check(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        new_policy = {
            "permissions": {"SSO": ["create"], "Members": ["read"]},
            "app_permissions": {},
        }
        assert role_update_grant_violations(manager, None, new_policy) == [
            "permissions:SSO:create"
        ]
        assert role_update_grant_violations(
            manager, None, new_policy
        ) == role_grant_violations(manager, new_policy)


class TestCanGrantRole:
    def test_manager_can_grant_developer(self):
        assert (
            can_grant_role(
                _default_role(MANAGER_ROLE_KEY), _default_role(DEVELOPER_ROLE_KEY)
            )
            is True
        )

    def test_manager_can_grant_manager(self):
        assert (
            can_grant_role(
                _default_role(MANAGER_ROLE_KEY), _default_role(MANAGER_ROLE_KEY)
            )
            is True
        )

    def test_manager_can_grant_service(self):
        # Manager is the designed SA admin — the stock Service role must be
        # within its ceiling (Manager gained app Environments:delete for this)
        manager = _default_role(MANAGER_ROLE_KEY)
        service = _default_role(SERVICE_ROLE_KEY)
        assert can_grant_role(manager, service) is True

    def test_manager_cannot_grant_owner(self):
        assert (
            can_grant_role(
                _default_role(MANAGER_ROLE_KEY), _default_role(OWNER_ROLE_KEY)
            )
            is False
        )

    def test_admin_can_grant_owner_policy(self):
        # Global-access exemption; the Owner managed_key guard at call sites
        # still blocks assigning the actual Owner role
        assert (
            can_grant_role(_default_role(ADMIN_ROLE_KEY), _default_role(OWNER_ROLE_KEY))
            is True
        )

    def test_custom_actor_covering_custom_target(self):
        actor = _custom_role(
            {
                "permissions": {"Members": ["create", "read", "update"]},
                "app_permissions": {"Secrets": ["read"]},
            }
        )
        target = _custom_role(
            {
                "permissions": {"Members": ["read"]},
                "app_permissions": {"Secrets": ["read"]},
            }
        )
        assert can_grant_role(actor, target) is True
        assert can_grant_role(target, actor) is False


class TestRolesGrantViolationsUnion:
    def test_single_role_matches_role_grant_violations(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        target = {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
        assert roles_grant_violations([manager], target) == role_grant_violations(
            manager, target
        )

    def test_union_covers_what_neither_role_covers_alone(self):
        org_role = _custom_role(
            {"permissions": {"Members": ["read"]}, "app_permissions": {}}
        )
        override = _custom_role(
            {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
        )
        target = {
            "permissions": {"Members": ["read"], "SSO": ["create"]},
            "app_permissions": {},
        }
        assert role_grant_violations(org_role, target) != []
        assert role_grant_violations(override, target) != []
        assert roles_grant_violations([org_role, override], target) == []

    def test_union_reports_violations_no_role_covers(self):
        org_role = _custom_role(
            {"permissions": {"Members": ["read"]}, "app_permissions": {}}
        )
        override = _custom_role(
            {"permissions": {"SSO": ["create"]}, "app_permissions": {}}
        )
        target = {
            "permissions": {"Members": ["read"], "SCIM": ["read"]},
            "app_permissions": {},
        }
        assert roles_grant_violations([org_role, override], target) == [
            "permissions:SCIM:read"
        ]

    def test_any_global_role_exempts(self):
        weak = _custom_role({"permissions": {}, "app_permissions": {}})
        admin = _default_role(ADMIN_ROLE_KEY)
        target = {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}}
        assert roles_grant_violations([weak, admin], target) == []

    def test_empty_actor_roles_fail_closed(self):
        target = {"permissions": {"Members": ["read"]}, "app_permissions": {}}
        assert roles_grant_violations([], target) == ["permissions:Members:read"]
        assert roles_grant_violations([None], target) == ["permissions:Members:read"]


class TestRoleAssignmentError:
    def test_manager_can_assign_default_service(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        service = _default_role(SERVICE_ROLE_KEY)
        service.name = "Service"
        assert role_assignment_error([manager], service) is None

    def test_manager_cannot_assign_role_above_ceiling(self):
        manager = _default_role(MANAGER_ROLE_KEY)
        target = _custom_role(
            {"permissions": {"SSO": ["create", "read"]}, "app_permissions": {}}
        )
        target.name = "SSO Admin"
        error = role_assignment_error([manager], target)
        assert "SSO Admin" in error
        assert "permissions:SSO:create" in error

    def test_global_actor_exempt(self):
        admin = _default_role(ADMIN_ROLE_KEY)
        target = _custom_role(
            {"permissions": {"Organisation": ["delete"]}, "app_permissions": {}}
        )
        target.name = "Org Deleter"
        assert role_assignment_error([admin], target) is None

    def test_team_override_union_permits_assignment(self):
        developer = _default_role(DEVELOPER_ROLE_KEY)
        override = _custom_role(
            {
                "permissions": {"ServiceAccounts": ["create", "read"]},
                "app_permissions": {},
            }
        )
        target = _custom_role(
            {
                "permissions": {"ServiceAccounts": ["read"], "Apps": ["read"]},
                "app_permissions": {},
            }
        )
        target.name = "SA Reader"
        assert role_assignment_error([developer], target) is not None
        assert role_assignment_error([developer, override], target) is None


def test_grant_ceiling_prunes_retired_keys_from_stored_roles():
    # Custom roles saved before the Tokens permission was retired still store the key
    legacy = MagicMock()
    legacy.is_default = False
    legacy.managed_key = None
    legacy.permissions = {
        "permissions": {"Members": ["read"]},
        "app_permissions": {"Secrets": ["read"], "Tokens": ["read", "create"]},
    }
    manager = _default_role(MANAGER_ROLE_KEY)

    # Raw payloads are not pruned: an unknown class is still a violation
    assert role_grant_violations(manager, legacy.permissions) == [
        "app_permissions:Tokens:read",
        "app_permissions:Tokens:create",
    ]
    assert role_assignment_error([manager], legacy) is None
    assert role_update_grant_violations(
        manager, legacy, {"permissions": {"Members": ["read"]}, "app_permissions": {}}
    ) == []
