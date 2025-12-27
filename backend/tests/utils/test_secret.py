import os
import pytest
from pathlib import Path
import logging
from unittest.mock import patch, MagicMock
from backend.utils.secrets import get_secret
from api.utils.secrets import (
    normalize_path_string,
    decompose_path_and_key,
    decrypt_secret_value,
)


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
    mock_resolve.assert_called_with(mock_env, "/", "API_KEY", crypto_context=None)


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
        mock_env, "/backend", "API_KEY", crypto_context=None
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
