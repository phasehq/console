import os
import pytest
from pathlib import Path
import logging
from unittest.mock import patch, MagicMock, ANY
from backend.utils.secrets import get_secret
from api.utils.secrets import (
    normalize_path_string,
    decompose_path_and_key,
    decrypt_secret_value,
    get_referenced_environment_ids,
    CROSS_APP_ENV_PATTERN,
    CROSS_ENV_PATTERN,
    LOCAL_REF_PATTERN,
)


# --- reference pattern matching ---
# A dot-less local ref placed before a dotted ref must not make the dotted
# pattern span across the local ref's braces (regression for combined refs
# like "${LOCAL}+${env.KEY}").


def test_reference_patterns_do_not_span_adjacent_references():
    # local then cross-env: cross-env must match ONLY the dotted ref
    assert CROSS_ENV_PATTERN.findall("${LOCAL}+${staging.HOST}") == [
        ("staging", "HOST")
    ]
    # local then cross-app: cross-app must match ONLY the dotted ref
    assert CROSS_APP_ENV_PATTERN.findall("${LOCAL}+${backend::prod.KEY}") == [
        ("backend", "prod", "KEY")
    ]
    # local pattern must not swallow the dotted ref that follows it
    assert LOCAL_REF_PATTERN.findall("${A}+${staging.HOST}") == ["A"]
    # all three types combined in one value resolve to three distinct matches
    combo = "${L2}|${prod.DB}|${app::prod.KEY}"
    assert LOCAL_REF_PATTERN.findall(combo) == ["L2"]
    assert CROSS_ENV_PATTERN.findall(combo) == [("prod", "DB")]
    assert CROSS_APP_ENV_PATTERN.findall(combo) == [("app", "prod", "KEY")]
    # folder-qualified keys (containing "/") still resolve
    assert CROSS_ENV_PATTERN.findall("${prod./db/KEY}") == [("prod", "/db/KEY")]
    # double-brace (Railway) syntax is still ignored
    assert LOCAL_REF_PATTERN.findall("${{RAILWAY}}") == []


@pytest.fixture
def temp_secret_file(tmp_path):
    """Create a temporary file containing a secret"""
    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("file_secret_value")
    return secret_file


@pytest.fixture
def caplog_debug(caplog):
    """Configure logging to capture debug messages"""
    caplog.set_level(logging.DEBUG)
    return caplog


def test_get_secret_from_environment():
    """Test retrieving secret from environment variable"""
    with patch.dict(os.environ, {"TEST_SECRET": "env_secret_value"}):
        assert get_secret("TEST_SECRET") == "env_secret_value"


def test_get_secret_from_file(temp_secret_file):
    """Test retrieving secret from file when _FILE env var is set"""
    with patch.dict(
        os.environ,
        {
            "TEST_SECRET_FILE": str(temp_secret_file),
        },
    ):
        assert get_secret("TEST_SECRET") == "file_secret_value"


def test_get_secret_file_priority(temp_secret_file):
    """Test that file-based secret takes priority over environment variable"""
    with patch.dict(
        os.environ,
        {
            "TEST_SECRET": "env_secret_value",
            "TEST_SECRET_FILE": str(temp_secret_file),
        },
    ):
        assert get_secret("TEST_SECRET") == "file_secret_value"


def test_get_secret_missing_file():
    """Test fallback to env var when file doesn't exist"""
    with patch.dict(
        os.environ,
        {
            "TEST_SECRET": "env_secret_value",
            "TEST_SECRET_FILE": "/nonexistent/path",
        },
    ):
        assert get_secret("TEST_SECRET") == "env_secret_value"


def test_get_secret_neither_exists():
    """Test None returned when neither file nor env var exists"""
    with patch.dict(os.environ, {}, clear=True):
        assert get_secret("TEST_SECRET") == None


def test_get_secret_empty_file(tmp_path):
    """Test handling of empty secret file"""
    empty_file = tmp_path / "empty_secret.txt"
    empty_file.write_text("")

    with patch.dict(
        os.environ,
        {
            "TEST_SECRET_FILE": str(empty_file),
        },
    ):
        assert get_secret("TEST_SECRET") == ""


def test_debug_logging_file_success(temp_secret_file, caplog_debug):
    """Test debug logging when secret is successfully loaded from file"""
    with patch.dict(
        os.environ,
        {
            "DEBUG": "true",
            "TEST_SECRET_FILE": str(temp_secret_file),
        },
    ):
        get_secret("TEST_SECRET")
        assert (
            f"Loaded secret 'TEST_SECRET' from file: {temp_secret_file}"
            in caplog_debug.text
        )


def test_debug_logging_file_not_found(caplog_debug):
    """Test debug logging when secret file is not found"""
    with patch.dict(
        os.environ,
        {
            "DEBUG": "true",
            "TEST_SECRET_FILE": "/nonexistent/path",
        },
    ):
        get_secret("TEST_SECRET")
        assert (
            "File path specified for 'TEST_SECRET' but file not found"
            in caplog_debug.text
        )


def test_debug_logging_env_var_success(caplog_debug):
    """Test debug logging when secret is successfully loaded from env var"""
    with patch.dict(
        os.environ,
        {
            "DEBUG": "true",
            "TEST_SECRET": "env_secret_value",
        },
    ):
        get_secret("TEST_SECRET")
        assert (
            "Loaded secret 'TEST_SECRET' from environment variable" in caplog_debug.text
        )


def test_debug_logging_not_found(caplog_debug):
    """Test debug logging when secret is not found anywhere"""
    with patch.dict(
        os.environ,
        {
            "DEBUG": "true",
        },
    ):
        get_secret("TEST_SECRET")
        assert (
            "Secret 'TEST_SECRET' not found in environment or file" in caplog_debug.text
        )


def test_secret_file_with_whitespace(tmp_path):
    """Test handling of secret files with whitespace"""
    secret_file = tmp_path / "secret_with_whitespace.txt"
    secret_file.write_text("  secret_value_with_spaces  \n")

    with patch.dict(
        os.environ,
        {
            "TEST_SECRET_FILE": str(secret_file),
        },
    ):
        assert get_secret("TEST_SECRET") == "secret_value_with_spaces"


def test_file_read_permission_error(tmp_path):
    """Test handling of unreadable secret file"""
    secret_file = tmp_path / "unreadable_secret.txt"
    secret_file.write_text("secret_value")
    secret_file.chmod(0o000)  # Remove all permissions

    with patch.dict(
        os.environ,
        {"TEST_SECRET_FILE": str(secret_file), "TEST_SECRET": "fallback_value"},
    ):
        assert get_secret("TEST_SECRET") == "fallback_value"


def test_normalize_path_string():
    """Test path normalization logic"""
    assert normalize_path_string("/") == "/"
    assert normalize_path_string("foo") == "/foo"
    assert normalize_path_string("/foo") == "/foo"
    assert normalize_path_string("/foo/") == "/foo"
    assert normalize_path_string("//foo//bar") == "/foo/bar"
    assert normalize_path_string("foo/bar/") == "/foo/bar"


def test_decompose_path_and_key():
    """Test splitting key into path and key name"""
    assert decompose_path_and_key("foo") == ("/", "foo")
    assert decompose_path_and_key("/foo") == ("/", "foo")
    assert decompose_path_and_key("path/to/key") == ("/path/to", "key")
    assert decompose_path_and_key("/path/to/key") == ("/path/to", "key")
    assert decompose_path_and_key("folder/subfolder/key") == (
        "/folder/subfolder",
        "key",
    )


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.get_environment_crypto_context")
def test_decrypt_secret_value_simple(mock_get_context, mock_decrypt, mock_get_model):
    """Test simple decryption without references"""
    mock_get_context.return_value = (b"salt", b"pub", b"priv")
    mock_decrypt.return_value = "plain_value"

    secret = MagicMock()
    secret.value = "encrypted"

    assert decrypt_secret_value(secret) == "plain_value"


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.resolve_secret_value")
@patch("api.utils.secrets.check_environment_access")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.get_environment_crypto_context")
def test_decrypt_secret_value_with_cross_env_ref(
    mock_get_context, mock_decrypt, mock_check_access, mock_resolve, mock_get_model
):
    """Test resolving ${Env.Key} reference"""
    mock_get_context.return_value = (b"salt", b"pub", b"priv")
    # First call is decrypting the main secret, subsequent calls might be for refs if not mocked out
    mock_decrypt.return_value = "Value is ${Production.API_KEY}"
    mock_resolve.return_value = "secret_api_key"
    mock_check_access.return_value = True

    # Setup mocks for models
    MockEnvironment = MagicMock()
    MockApp = MagicMock()

    def get_model_side_effect(app_label, model_name):
        if model_name == "Environment":
            return MockEnvironment
        if model_name == "App":
            return MockApp
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    secret = MagicMock()
    secret.environment.app.organisation = MagicMock()
    secret.environment.app = MagicMock()

    # Mock Environment.objects.get
    mock_env = MagicMock()
    MockEnvironment.objects.get.return_value = mock_env

    result = decrypt_secret_value(secret)

    assert result == "Value is secret_api_key"
    mock_resolve.assert_called_with(
        mock_env,
        "/",
        "API_KEY",
        crypto_context=None,
        require_resolved_references=False,
        account=None,
        context_cache=None,
        _visited=ANY,
    )


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.resolve_secret_value")
@patch("api.utils.secrets.check_environment_access")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.get_environment_crypto_context")
def test_decrypt_secret_value_with_cross_env_ref_in_folder(
    mock_get_context, mock_decrypt, mock_check_access, mock_resolve, mock_get_model
):
    """Test resolving ${Env.folder/Key} reference"""
    mock_get_context.return_value = (b"salt", b"pub", b"priv")
    mock_decrypt.return_value = "Value is ${Production.backend/API_KEY}"
    mock_resolve.return_value = "secret_api_key"
    mock_check_access.return_value = True

    # Setup mocks for models
    MockEnvironment = MagicMock()
    MockApp = MagicMock()

    def get_model_side_effect(app_label, model_name):
        if model_name == "Environment":
            return MockEnvironment
        if model_name == "App":
            return MockApp
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    secret = MagicMock()

    mock_env = MagicMock()
    MockEnvironment.objects.get.return_value = mock_env

    result = decrypt_secret_value(secret)

    assert result == "Value is secret_api_key"
    mock_resolve.assert_called_with(
        mock_env,
        "/backend",
        "API_KEY",
        crypto_context=None,
        require_resolved_references=False,
        account=None,
        context_cache=None,
        _visited=ANY,
    )


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.get_environment_crypto_context")
def test_decrypt_secret_value_ignores_railway_syntax(
    mock_get_context, mock_decrypt, mock_get_model
):
    """Test that decrypt_secret_value ignores Railway-style references ${{...}}"""
    mock_secret = MagicMock()
    mock_secret.value = "encrypted_value"
    mock_secret.environment.id = 1
    mock_secret.environment.app.organisation.id = 1

    # Mock decrypt_asymmetric to return a value containing Railway syntax
    mock_decrypt.return_value = "Some value with ${{RAILWAY_REF}}"

    # Mock get_environment_crypto_context
    with patch("api.utils.secrets.get_environment_crypto_context") as mock_context:
        mock_context.return_value = (b"salt", b"pub", b"priv")

        # Should return the value as-is without trying to resolve ${{RAILWAY_REF}}
        result = decrypt_secret_value(mock_secret)

        assert result == "Some value with ${{RAILWAY_REF}}"


@patch("api.utils.secrets.blake2b_digest")
@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.get_environment_crypto_context")
def test_decrypt_secret_value_resolves_nested_local_references(
    mock_get_context, mock_decrypt, mock_get_model, mock_digest
):
    """Multi-level local references resolve fully (regression test for #877).

    LEVEL2 -> ${LEVEL1} -> ${LEVEL0}; the final value must be fully expanded,
    not just resolved one level deep.
    """
    mock_get_context.return_value = (b"salt", b"pub", b"priv")
    mock_digest.side_effect = lambda key_name, salt: key_name  # key_digest == key name

    env = MagicMock()
    env.id = 1

    def make_secret(digest, ciphertext):
        s = MagicMock()
        s.environment_id = 1
        s.environment = env
        s.path = "/"
        s.key_digest = digest
        s.value = ciphertext
        return s

    level2 = make_secret("LEVEL2", "ct:L2")
    level1 = make_secret("LEVEL1", "ct:L1")
    level0 = make_secret("LEVEL0", "ct:L0")

    decrypt_map = {
        "ct:L2": "${LEVEL1}+L2",
        "ct:L1": "${LEVEL0}+L1",
        "ct:L0": "L0",
    }
    mock_decrypt.side_effect = lambda ct, *a, **k: decrypt_map[ct]

    secrets_by_digest = {"LEVEL1": level1, "LEVEL0": level0}

    MockSecret = MagicMock()
    MockSecret.objects.get.side_effect = lambda **kwargs: secrets_by_digest[
        kwargs["key_digest"]
    ]

    def get_model_side_effect(app_label, model_name):
        if model_name == "Secret":
            return MockSecret
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    result = decrypt_secret_value(level2)
    assert result == "L0+L1+L2"


@patch("api.utils.secrets.blake2b_digest")
@patch("api.utils.secrets.check_environment_access")
@patch("api.utils.secrets.get_or_compute_crypto_context")
@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.get_environment_crypto_context")
def test_decrypt_secret_value_resolves_nested_cross_env_reference(
    mock_get_context,
    mock_decrypt,
    mock_get_model,
    mock_get_or_compute,
    mock_check_access,
    mock_digest,
):
    """A cross-env reference whose target value itself contains a reference is
    resolved recursively: ${staging.DB_URL} -> ${staging.HOST}:5432 -> db:5432.
    """
    crypto_context = (b"salt", b"pub", b"priv")
    mock_get_context.return_value = crypto_context
    mock_get_or_compute.return_value = crypto_context
    mock_check_access.return_value = True
    mock_digest.side_effect = lambda key_name, salt: key_name

    main_env = MagicMock()
    main_env.id = 1
    staging_env = MagicMock()
    staging_env.id = 2

    def make_secret(env, env_id, digest, ciphertext):
        s = MagicMock()
        s.environment = env
        s.environment_id = env_id
        s.path = "/"
        s.key_digest = digest
        s.value = ciphertext
        return s

    main_secret = make_secret(main_env, 1, "MAIN", "ct:MAIN")
    db_url_secret = make_secret(staging_env, 2, "DB_URL", "ct:DBURL")
    host_secret = make_secret(staging_env, 2, "HOST", "ct:HOST")

    decrypt_map = {
        "ct:MAIN": "${staging.DB_URL}",
        "ct:DBURL": "${staging.HOST}:5432",
        "ct:HOST": "db",
    }
    mock_decrypt.side_effect = lambda ct, *a, **k: decrypt_map[ct]

    secrets_by_digest = {"DB_URL": db_url_secret, "HOST": host_secret}

    MockSecret = MagicMock()
    MockSecret.objects.get.side_effect = lambda **kwargs: secrets_by_digest[
        kwargs["key_digest"]
    ]
    MockEnvironment = MagicMock()
    MockEnvironment.objects.get.return_value = staging_env

    def get_model_side_effect(app_label, model_name):
        if model_name == "Secret":
            return MockSecret
        if model_name == "Environment":
            return MockEnvironment
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    result = decrypt_secret_value(main_secret)
    assert result == "db:5432"


@patch("api.utils.secrets.blake2b_digest")
@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.get_environment_crypto_context")
def test_decrypt_secret_value_breaks_reference_cycle(
    mock_get_context, mock_decrypt, mock_get_model, mock_digest
):
    """A reference cycle (A -> B -> A) terminates instead of recursing forever."""
    mock_get_context.return_value = (b"salt", b"pub", b"priv")
    mock_digest.side_effect = lambda key_name, salt: key_name

    env = MagicMock()
    env.id = 1

    def make_secret(digest, ciphertext):
        s = MagicMock()
        s.environment_id = 1
        s.environment = env
        s.path = "/"
        s.key_digest = digest
        s.value = ciphertext
        return s

    a = make_secret("A", "ct:A")
    b = make_secret("B", "ct:B")

    decrypt_map = {"ct:A": "${B}", "ct:B": "${A}"}
    mock_decrypt.side_effect = lambda ct, *args, **kwargs: decrypt_map[ct]

    secrets_by_digest = {"A": a, "B": b}
    MockSecret = MagicMock()
    MockSecret.objects.get.side_effect = lambda **kwargs: secrets_by_digest[
        kwargs["key_digest"]
    ]

    def get_model_side_effect(app_label, model_name):
        if model_name == "Secret":
            return MockSecret
        return MagicMock()

    mock_get_model.side_effect = get_model_side_effect

    # Should return without raising / hanging; the cyclic ref is left unresolved.
    result = decrypt_secret_value(a)
    assert result == "${A}"


# --- get_referenced_environment_ids tests ---


def _refs_models(source_app_id="app-1", server_key_exists=True):
    """get_model side_effect for get_referenced_environment_ids with a single
    secret in the source env. Reference text is supplied via decrypt_asymmetric
    mocking in each test."""
    mock_env = MagicMock()
    mock_env.app_id = source_app_id

    MockEnvironment = MagicMock()
    MockEnvironment.objects.select_related.return_value.get.return_value = mock_env
    MockEnvironment.DoesNotExist = Exception

    MockServerEnvKey = MagicMock()
    MockServerEnvKey.DoesNotExist = type("DoesNotExist", (Exception,), {})
    if server_key_exists:
        mock_server_env_key = MagicMock()
        mock_server_env_key.wrapped_seed = "wrapped_seed"
        MockServerEnvKey.objects.get.return_value = mock_server_env_key
    else:
        MockServerEnvKey.objects.get.side_effect = MockServerEnvKey.DoesNotExist()

    mock_secret = MagicMock()
    mock_secret.value = "encrypted"
    MockSecret = MagicMock()
    MockSecret.objects.filter.return_value = [mock_secret]

    def get_model_side_effect(app_label, model_name):
        if model_name == "Secret":
            return MockSecret
        if model_name == "ServerEnvironmentKey":
            return MockServerEnvKey
        if model_name == "Environment":
            return MockEnvironment
        return MagicMock()

    return get_model_side_effect


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.env_keypair")
@patch("api.utils.secrets.get_server_keypair")
def test_get_referenced_environment_ids_cross_env(
    mock_server_kp, mock_env_kp, mock_decrypt, mock_get_model
):
    """${ENV.KEY} resolves to the target env id within the same app."""
    mock_server_kp.return_value = (b"pk", b"sk")
    mock_env_kp.return_value = (b"env_pub", b"env_priv")
    mock_get_model.side_effect = _refs_models(source_app_id="app-1")
    mock_decrypt.side_effect = ["env_seed", "url=${staging.DB_HOST}"]

    name_ctx = {
        "apps_by_name": {},
        "ambiguous_apps": set(),
        "envs_by_app_name": {("app-1", "staging"): "env-staging-id"},
    }

    assert get_referenced_environment_ids("env-1", name_ctx) == {"env-staging-id"}


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.env_keypair")
@patch("api.utils.secrets.get_server_keypair")
def test_get_referenced_environment_ids_cross_app(
    mock_server_kp, mock_env_kp, mock_decrypt, mock_get_model
):
    """${APP::ENV.KEY} resolves the app name then the env id."""
    mock_server_kp.return_value = (b"pk", b"sk")
    mock_env_kp.return_value = (b"env_pub", b"env_priv")
    mock_get_model.side_effect = _refs_models(source_app_id="app-2")
    mock_decrypt.side_effect = ["env_seed", "${backend::production.API_KEY}"]

    name_ctx = {
        "apps_by_name": {"backend": "app-1"},
        "ambiguous_apps": set(),
        "envs_by_app_name": {("app-1", "production"): "env-prod-id"},
    }

    assert get_referenced_environment_ids("env-2", name_ctx) == {"env-prod-id"}


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.env_keypair")
@patch("api.utils.secrets.get_server_keypair")
def test_get_referenced_environment_ids_no_match(
    mock_server_kp, mock_env_kp, mock_decrypt, mock_get_model
):
    """A plain value references nothing."""
    mock_server_kp.return_value = (b"pk", b"sk")
    mock_env_kp.return_value = (b"env_pub", b"env_priv")
    mock_get_model.side_effect = _refs_models(source_app_id="app-1")
    mock_decrypt.side_effect = ["env_seed", "just a plain value"]

    name_ctx = {
        "apps_by_name": {},
        "ambiguous_apps": set(),
        "envs_by_app_name": {("app-1", "staging"): "env-staging-id"},
    }

    assert get_referenced_environment_ids("env-1", name_ctx) == set()


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.env_keypair")
@patch("api.utils.secrets.get_server_keypair")
def test_get_referenced_environment_ids_ambiguous_app_skipped(
    mock_server_kp, mock_env_kp, mock_decrypt, mock_get_model
):
    """A cross-app reference to an ambiguously-named app is not resolved."""
    mock_server_kp.return_value = (b"pk", b"sk")
    mock_env_kp.return_value = (b"env_pub", b"env_priv")
    mock_get_model.side_effect = _refs_models(source_app_id="app-2")
    mock_decrypt.side_effect = ["env_seed", "${backend::production.API_KEY}"]

    name_ctx = {
        "apps_by_name": {"backend": "app-1"},
        "ambiguous_apps": {"backend"},
        "envs_by_app_name": {("app-1", "production"): "env-prod-id"},
    }

    assert get_referenced_environment_ids("env-2", name_ctx) == set()


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.env_keypair")
@patch("api.utils.secrets.get_server_keypair")
def test_get_referenced_environment_ids_no_sse(
    mock_server_kp, mock_env_kp, mock_decrypt, mock_get_model
):
    """No ServerEnvironmentKey (SSE disabled) => no references discoverable."""
    mock_server_kp.return_value = (b"pk", b"sk")
    mock_get_model.side_effect = _refs_models(server_key_exists=False)

    name_ctx = {
        "apps_by_name": {},
        "ambiguous_apps": set(),
        "envs_by_app_name": {("app-1", "staging"): "env-staging-id"},
    }

    assert get_referenced_environment_ids("env-1", name_ctx) == set()


@patch("api.utils.secrets.apps.get_model")
@patch("api.utils.secrets.decrypt_asymmetric")
@patch("api.utils.secrets.env_keypair")
@patch("api.utils.secrets.get_server_keypair")
def test_get_referenced_environment_ids_ignores_railway_syntax(
    mock_server_kp, mock_env_kp, mock_decrypt, mock_get_model
):
    """${{...}} Railway-style syntax is not treated as a reference."""
    mock_server_kp.return_value = (b"pk", b"sk")
    mock_env_kp.return_value = (b"env_pub", b"env_priv")
    mock_get_model.side_effect = _refs_models(source_app_id="app-1")
    mock_decrypt.side_effect = ["env_seed", "url=${{staging.DB_HOST}}"]

    name_ctx = {
        "apps_by_name": {},
        "ambiguous_apps": set(),
        "envs_by_app_name": {("app-1", "staging"): "env-staging-id"},
    }

    assert get_referenced_environment_ids("env-1", name_ctx) == set()
