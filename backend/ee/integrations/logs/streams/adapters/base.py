"""Adapter contract for log stream destinations.

An adapter turns a chunk of neutral envelopes into one delivery to a specific
destination. The contract is deliberately destination-agnostic: credentials
come from the linked ProviderCredentials record (decrypted by the engine),
`options` is adapter-validated free-form config, and `context` carries stream
metadata (organisation/stream names) for tagging. Adapters that need their own
token exchange (e.g. Microsoft Sentinel via Azure AD) do it inside `ship()`.

Raise the typed errors from ..exceptions to drive engine behaviour; return a
ShipResult on success.
"""

from dataclasses import dataclass, field


@dataclass
class ShipResult:
    status_code: int
    duration_ms: int = 0
    meta: dict = field(default_factory=dict)


class LogStreamAdapter:
    id = None
    name = None
    # Providers registry id whose credentials this adapter consumes.
    credentials_provider = None
    # Oldest event timestamp the destination accepts (None = unlimited).
    max_event_age = None

    def validate_options(self, options):
        """Normalise and validate stream options; raise ValueError on bad input."""
        return options or {}

    def destination_url(self, credentials, options):
        """Deep link to the shipped logs in the destination's UI, or None."""
        return None

    def ship(self, chunk, credentials, options, context):
        raise NotImplementedError

    def test(self, credentials, options, context):
        """Verify the credentials and options against the destination.

        Contract: this MUST NOT ingest any data into the destination — use
        the provider's key-validation or health endpoint. Only ship a
        synthetic event as an explicit last resort for a destination with no
        such endpoint.
        """
        raise NotImplementedError
