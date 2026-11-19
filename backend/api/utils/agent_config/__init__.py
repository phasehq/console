"""Declarative service configuration for AI Agents.

The registry says which services a Connection may target and how the proxy injects
credentials. It sits outside ``ee/`` because ``api.models`` validates against it.
"""

from .http_definition import (
    APP_DISPLAY_NAME,
    APP_SERVICE_TYPE,
    HTTP_DISPLAY_NAME,
    HTTP_SERVICE_TYPE,
    DefinitionError,
    is_app_service,
    is_custom_service,
    load_definition,
    service_for_connection,
    upgrade_definition,
    validate_definition,
)
from .presets import PresetError, expand_preset, list_presets, preset_summaries
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
    "APP_DISPLAY_NAME",
    "APP_SERVICE_TYPE",
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
    "PresetError",
    "expand_preset",
    "get_config_registry",
    "host_rules_require_independent_approval",
    "is_app_service",
    "is_custom_service",
    "list_presets",
    "load_definition",
    "load_registry",
    "preset_summaries",
    "service_for_connection",
    "upgrade_definition",
    "validate_definition",
    "validate_host_rules",
]
