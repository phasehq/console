from ee.integrations.secrets.rotation.sanitize import REDACTED, excerpt, sanitize


def test_redacts_obvious_secret_keys():
    data = {
        "api_key": "sk-live-deadbeef",
        "username": "rotator",
        "auth": "Bearer xyz",
        "nested": {"password": "p", "fine": "fine"},
    }
    out = sanitize(data)
    assert out["api_key"] == REDACTED
    assert out["auth"] == REDACTED
    assert out["nested"]["password"] == REDACTED
    assert out["nested"]["fine"] == "fine"
    assert out["username"] == "rotator"


def test_truncates_long_strings():
    long_string = "x" * 2000
    out = sanitize({"detail": long_string})
    assert len(out["detail"]) == 512


def test_excerpt_caps_length_and_handles_none():
    assert excerpt(None) == ""
    assert excerpt("") == ""
    assert len(excerpt("y" * 1024)) == 512


def test_extra_sensitive_keys_are_redacted():
    out = sanitize({"my_unique_field": "value"}, extra_sensitive_keys=["my_unique_field"])
    assert out["my_unique_field"] == REDACTED


def test_walks_lists():
    out = sanitize([{"token": "abc"}, {"name": "ok"}])
    assert out[0]["token"] == REDACTED
    assert out[1]["name"] == "ok"


# Value-pattern redaction — strings (regardless of dict key name) scanned for
# credential-shaped substrings and inline-redacted, preserving surrounding text.


def test_value_pattern_redacts_sk_prefixed_keys_in_error_bodies():
    out = sanitize(
        {
            "body": "Invalid key sk-Jc--MnZuaOsSPvLG3hP_2w. Try again.",
            "status": 401,
        }
    )
    assert "sk-" not in out["body"]
    assert REDACTED in out["body"]
    assert "Invalid key" in out["body"]  # surrounding diagnostic text preserved
    assert "Try again." in out["body"]
    assert out["status"] == 401


def test_value_pattern_redacts_sk_project_and_admin_variants():
    for key in ("sk-proj-abcdef0123456789", "sk-admin-XYZ012345abcdefg"):
        out = sanitize({"body": f"used {key} but no good"})
        assert REDACTED in out["body"]
        assert key not in out["body"]


def test_value_pattern_redacts_bearer_headers():
    out = sanitize({"body": "Authorization: Bearer abcdef0123456789xyz failed"})
    assert "Bearer abcdef" not in out["body"]
    assert REDACTED in out["body"]


def test_value_pattern_redacts_aws_access_keys():
    out = sanitize({"body": "creds invalid: AKIAIOSFODNN7EXAMPLE rejected"})
    assert "AKIA" not in out["body"]
    assert REDACTED in out["body"]


def test_value_pattern_redacts_github_tokens():
    out = sanitize({"body": "header had ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345 in it"})
    assert "ghp_" not in out["body"]
    assert REDACTED in out["body"]


def test_value_pattern_redacts_jwts():
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.SflKxwRJSMeKKF2QT4f"
    out = sanitize({"body": f"got {jwt} back"})
    assert "eyJ" not in out["body"]
    assert REDACTED in out["body"]


def test_safe_identifier_keys_are_not_redacted():
    """Keys whose names contain 'key'/'token'/'id' but are actually safe
    identifiers should pass through untouched — operators need them to
    correlate events with provider-side resources."""
    out = sanitize(
        {
            "key_id": "key_62pyf3WdqBymiZmt",
            "token_id": "abc123def456",
            "key_name": "phase-rs-...",
            "provider_credential_id": "tok-xyz",
            "user_id": "user_123",
        }
    )
    assert out["key_id"] == "key_62pyf3WdqBymiZmt"
    assert out["token_id"] == "abc123def456"
    assert out["key_name"] == "phase-rs-..."
    assert out["provider_credential_id"] == "tok-xyz"
    assert out["user_id"] == "user_123"


def test_long_hex_token_ids_pass_through():
    """64-char hex strings (LiteLLM token IDs) don't match the secret value
    patterns and should not be redacted."""
    long_hex = "d0f443e9f9efebc8f4758796a8376ec909e5445f98fdca52e2fd30ff994af5d7"
    out = sanitize({"provider_credential_id": long_hex, "body": f"key id was {long_hex}"})
    assert out["provider_credential_id"] == long_hex
    assert long_hex in out["body"]


def test_excerpt_also_applies_value_redaction():
    out = excerpt("Auth failed: Bearer sk-live-deadbeef-12345 was rejected")
    assert "sk-" not in out
    assert "Bearer " not in out  # Bearer with following token gets fully matched
    assert REDACTED in out
