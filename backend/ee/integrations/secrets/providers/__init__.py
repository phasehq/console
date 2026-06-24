"""Shared credential-provider infrastructure.

The classes here are deliberately rotation/dynamic-secret agnostic — they
describe how Phase talks to an external provider (OpenAI, LiteLLM, …) to
mint and revoke credentials. Higher-level consumers (rotation engine,
dynamic-secret leases, etc.) own their own registries that map onto these
provider classes.
"""
