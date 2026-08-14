"""Server-side validation of provider-specific credential fields.

The Datadog site composes into intake/API URLs (an SSRF surface) and a bad
value otherwise only surfaces at ship time as a permanently-failing stream —
the allowlist must be enforced at credential save, not just in the console
picker.
"""

from unittest.mock import patch

import pytest
from graphql import GraphQLError

from backend.graphene.mutations.syncing import validate_credential_values

_KEYPAIR = (b"\x01" * 32, b"\x02" * 32)
_C = "api.utils.crypto"


def test_non_datadog_providers_are_untouched():
    with patch(f"{_C}.decrypt_asymmetric") as mock_decrypt:
        validate_credential_values("cloudflare", {"access_token": "enc"})

    mock_decrypt.assert_not_called()


def test_missing_site_is_rejected():
    with pytest.raises(GraphQLError, match="site is required"):
        validate_credential_values("datadog", {"api_key": "enc"})


def test_valid_site_passes_despite_scheme_and_case_noise():
    with patch(f"{_C}.get_server_keypair", return_value=_KEYPAIR), patch(
        f"{_C}.decrypt_asymmetric", return_value="https://US3.datadoghq.com/"
    ):
        validate_credential_values("datadog", {"site": "enc"})


def test_unknown_site_is_rejected():
    with patch(f"{_C}.get_server_keypair", return_value=_KEYPAIR), patch(
        f"{_C}.decrypt_asymmetric", return_value="logs.evil.example"
    ):
        with pytest.raises(GraphQLError, match="Unknown Datadog site"):
            validate_credential_values("datadog", {"site": "enc"})


def test_unreadable_site_ciphertext_is_rejected():
    with patch(f"{_C}.get_server_keypair", return_value=_KEYPAIR), patch(
        f"{_C}.decrypt_asymmetric", side_effect=Exception("bad ciphertext")
    ):
        with pytest.raises(GraphQLError, match="Could not read"):
            validate_credential_values("datadog", {"site": "enc"})
