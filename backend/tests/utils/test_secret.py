import os
import pytest
from pathlib import Path
import logging
from unittest.mock import patch
from backend.utils.secrets import get_secret


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
    """Test empty string returned when neither file nor env var exists"""
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
