"""Declarative service configuration for AI Agents.

The registry is the single source of truth for which third-party services an
Agent Connection may target, how the proxy injects credentials into their
traffic, and what environment the CLI prepares for the Agent process. It lives
outside ``ee/`` because ``api.models`` validates Connections against it.
"""

from .registry import (
    CLIENT_MATCHER_SCHEMA_VERSION,
    DEFAULT_SERVICE_ROOT,
    REGISTRY,
    SCHEMA_VERSION,
    ConfigCompatibilityError,
    ConfigRegistry,
    ConfigRegistryError,
    get_config_registry,
    host_rules_require_independent_approval,
    load_registry,
    validate_host_rules,
)

__all__ = [
    "CLIENT_MATCHER_SCHEMA_VERSION",
    "DEFAULT_SERVICE_ROOT",
    "REGISTRY",
    "SCHEMA_VERSION",
    "ConfigCompatibilityError",
    "ConfigRegistry",
    "ConfigRegistryError",
    "get_config_registry",
    "host_rules_require_independent_approval",
    "load_registry",
    "validate_host_rules",
]
