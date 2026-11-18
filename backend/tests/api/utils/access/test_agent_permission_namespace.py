"""Guards for the agent permission namespace.

Per-Agent resources live in `agent_permissions`, beside `permissions` and
`app_permissions`. Unlike app resources, they are routed by *name* rather than
by an explicit flag at each call site, which is only safe while their names
stay disjoint from every organisation and app resource. These tests pin that.
"""

from unittest.mock import MagicMock

import pytest

from api.utils.access.permissions import role_has_permission
from api.utils.access.roles import (
    AGENT_PERMISSION_RESOURCES,
    DEVELOPER_ROLE_KEY,
    VALID_AGENT_PERMISSIONS,
    VALID_APP_PERMISSIONS,
    VALID_ORG_PERMISSIONS,
    default_roles,
    normalize_custom_role_permissions,
    permission_key_for,
    validate_custom_role_permissions,
)


def _custom_role(policy):
    role = MagicMock()
    role.is_default = False
    role.permissions = policy
    return role


def _managed_role(managed_key):
    role = MagicMock()
    role.is_default = True
    role.managed_key = managed_key
    return role


class TestNamespaceRouting:
    def test_agent_resource_names_never_collide_with_other_namespaces(self):
        # Routing by name silently reads the wrong map on a collision, which
        # would grant or deny the wrong resource. Fail here instead.
        assert not AGENT_PERMISSION_RESOURCES & set(VALID_ORG_PERMISSIONS)
        assert not AGENT_PERMISSION_RESOURCES & set(VALID_APP_PERMISSIONS)

    def test_registered_resources_match_the_managed_templates(self):
        assert set(VALID_AGENT_PERMISSIONS) == AGENT_PERMISSION_RESOURCES

    @pytest.mark.parametrize(
        ("resource", "is_app_resource", "expected"),
        [
            ("AgentWorkflows", False, "agent_permissions"),
            ("AgentMemberships", False, "agent_permissions"),
            ("AgentTokens", False, "agent_permissions"),
            ("AgentSessions", False, "agent_permissions"),
            # Lifecycle and org-wide assets stay organisation scoped, as Apps does.
            ("Agents", False, "permissions"),
            ("AgentConnections", False, "permissions"),
            ("AgentRequests", False, "permissions"),
            ("Apps", False, "permissions"),
            # Colliding app/org names still need the explicit flag.
            ("Members", False, "permissions"),
            ("Members", True, "app_permissions"),
        ],
    )
    def test_permission_key_for(self, resource, is_app_resource, expected):
        assert permission_key_for(resource, is_app_resource) == expected

    def test_every_managed_template_declares_all_three_namespaces(self):
        for name, template in default_roles.items():
            assert {"permissions", "app_permissions", "agent_permissions"} <= set(
                template
            ), name
            assert set(template["agent_permissions"]) == AGENT_PERMISSION_RESOURCES, name
            assert not AGENT_PERMISSION_RESOURCES & set(template["permissions"]), name


class TestRoleHasPermission:
    def test_custom_role_reads_agent_resources_from_agent_permissions(self):
        role = _custom_role(
            {
                "permissions": {"Agents": ["read"]},
                "app_permissions": {},
                "agent_permissions": {"AgentWorkflows": ["read"]},
            }
        )

        assert role_has_permission(role, "read", "Agents") is True
        assert role_has_permission(role, "read", "AgentWorkflows") is True
        assert role_has_permission(role, "create", "AgentWorkflows") is False

    def test_a_grant_left_in_the_organisation_map_confers_nothing(self):
        """Fail closed on the pre-split shape rather than honouring it."""

        role = _custom_role(
            {
                "permissions": {"AgentWorkflows": ["read"]},
                "app_permissions": {},
            }
        )

        assert role_has_permission(role, "read", "AgentWorkflows") is False

    def test_a_role_without_an_agent_map_grants_nothing_within_agents(self):
        role = _custom_role({"permissions": {}, "app_permissions": {}})

        for resource in AGENT_PERMISSION_RESOURCES:
            assert role_has_permission(role, "read", resource) is False

    def test_managed_developer_role_resolves_through_the_template(self):
        role = _managed_role(DEVELOPER_ROLE_KEY)

        assert role_has_permission(role, "delete", "AgentWorkflows") is True
        assert role_has_permission(role, "update", "AgentTokens") is False
        assert role_has_permission(role, "read", "AgentMemberships") is False
        assert role_has_permission(role, "update", "Agents") is True


class TestCustomRoleValidation:
    def test_accepts_the_split_shape(self):
        assert (
            validate_custom_role_permissions(
                {
                    "permissions": {"Agents": ["read"], "AgentRequests": ["read"]},
                    "app_permissions": {"Secrets": ["read"]},
                    "agent_permissions": {"AgentSessions": ["create", "read"]},
                }
            )
            is None
        )

    def test_agent_permissions_is_optional_for_existing_clients(self):
        assert (
            validate_custom_role_permissions({"permissions": {}, "app_permissions": {}})
            is None
        )

    @pytest.mark.parametrize("resource", sorted(AGENT_PERMISSION_RESOURCES))
    def test_points_a_misplaced_agent_resource_at_its_namespace(self, resource):
        error = validate_custom_role_permissions(
            {"permissions": {resource: ["read"]}, "app_permissions": {}}
        )

        assert error == (
            f"'{resource}' is an agent permission class; set it under agent_permissions."
        )

    @pytest.mark.parametrize(
        ("agent_permissions", "message"),
        [
            ({"Agents": ["read"]}, "Unknown agent permission class: 'Agents'"),
            ({"AgentTokens": ["approve"]}, "Unknown action 'approve' for agent"),
            ({"AgentTokens": "read"}, "Actions for 'AgentTokens' must be an array."),
            (["AgentTokens"], "agent_permissions must be a JSON object."),
        ],
    )
    def test_rejects_invalid_agent_permissions(self, agent_permissions, message):
        error = validate_custom_role_permissions(
            {
                "permissions": {},
                "app_permissions": {},
                "agent_permissions": agent_permissions,
            }
        )

        assert error is not None and error.startswith(message), error

    def test_unknown_top_level_keys_name_the_agent_map(self):
        error = validate_custom_role_permissions(
            {"permissions": {}, "app_permissions": {}, "team_permissions": {}}
        )

        assert error.endswith(
            "Allowed keys: permissions, app_permissions, agent_permissions."
        )

    def test_org_and_app_messages_are_unchanged(self):
        assert validate_custom_role_permissions(
            {"permissions": {"Nope": ["read"]}, "app_permissions": {}}
        ).startswith("Unknown org permission class: 'Nope'")
        assert validate_custom_role_permissions(
            {"permissions": {}, "app_permissions": {"Nope": ["read"]}}
        ).startswith("Unknown app permission class: 'Nope'")

    def test_camel_case_agent_permissions_round_trip(self):
        assert normalize_custom_role_permissions(
            {"permissions": {}, "appPermissions": {}, "agentPermissions": {}}
        ) == {"permissions": {}, "app_permissions": {}, "agent_permissions": {}}
