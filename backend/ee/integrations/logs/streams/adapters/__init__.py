"""Log stream destination adapter registry.

Adding a destination = one adapter module + one entry here. Adapters must
stay dependency-free (plain requests); see base.LogStreamAdapter for the
contract.
"""

from .datadog import DatadogAdapter

ADAPTERS = {
    adapter.id: adapter
    for adapter in (DatadogAdapter(),)
}


def get_adapter(adapter_id):
    adapter = ADAPTERS.get(adapter_id)
    if adapter is None:
        raise ValueError(f"Unknown log stream provider '{adapter_id}'")
    return adapter


def all_adapters():
    return list(ADAPTERS.values())
