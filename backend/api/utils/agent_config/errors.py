"""Errors every part of the Agents service configuration raises."""


class ConfigRegistryError(ValueError):
    """A registry template is invalid or ambiguous."""


class ConfigCompatibilityError(ConfigRegistryError):
    """A valid service and credential method cannot be combined."""
