"""Declarative service configuration for AI Agents.

The registry is the single source of truth for which third-party services an
Agent Connection may target, how the proxy injects credentials into their
traffic, and what environment the CLI prepares for the Agent process. It lives
outside ``ee/`` because ``api.models`` validates Connections against it.
"""

from .http_definition import (
    HTTP_DISPLAY_NAME,
    HTTP_SERVICE_TYPE,
    DefinitionError,
    is_custom_service,
    load_definition,
    service_for_connection,
    upgrade_definition,
    validate_definition,
)
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
    "HTTP_DISPLAY_NAME",
    "HTTP_SERVICE_TYPE",
    "REGISTRY",
    "SCHEMA_VERSION",
    "ConfigCompatibilityError",
    "ConfigRegistry",
    "ConfigRegistryError",
    "DefinitionError",
    "get_config_registry",
    "host_rules_require_independent_approval",
    "is_custom_service",
    "load_definition",
    "load_registry",
    "service_for_connection",
    "upgrade_definition",
    "validate_definition",
    "validate_host_rules",
]
