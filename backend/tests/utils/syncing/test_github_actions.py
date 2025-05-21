from api.utils.syncing.github.actions import (
    check_rate_limit,
    encrypt_secret,
    get_all_secrets,
    sync_github_secrets,
)

import pytest
import base64
from unittest.mock import patch, Mock, MagicMock

import json


def get_mocked_response(url, *args, **kwargs):
    mock_response = Mock()

    if "/rate_limit" in url:
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "resources": {
                "core": {
                    "remaining": 5000,
                    "reset": 9999999999,  # arbitrary future timestamp
                }
            }
        }
        return mock_response

    elif "/actions/secrets/public-key" in url:
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "key_id": "test-key-id",
            "key": "test-public-key",
        }
        return mock_response

    elif "/actions/secrets" in url:
        mock_response.status_code = 200
        mock_response.json.return_value = {"secrets": [{"name": "EXISTING_SECRET"}]}
        return mock_response

    raise ValueError(f"Unhandled GET URL: {url}")


# Mock data
MOCK_PUBLIC_KEY = base64.b64encode(b"A" * 32).decode("utf-8")
MOCK_SECRET_VALUE = "super-secret-value"
MOCK_ENCRYPTED_VALUE = base64.b64encode(b"encrypted").decode("utf-8")
MOCK_ACCESS_TOKEN = "ghp_testtoken"
MOCK_REPO = "demo-repo"
MOCK_OWNER = "demo-owner"
MOCK_API_HOST = "https://api.github.com"


def test_encrypt_secret_returns_base64_string():
    """Test encrypt_secret returns a valid base64 string."""
    public_key = base64.b64encode(b"\x01" * 32).decode("utf-8")
    result = encrypt_secret(public_key, "value")
    assert isinstance(result, str)
    # Base64 decode to validate format
    base64.b64decode(result)


@patch("api.utils.syncing.github.actions.requests.get")
def test_check_rate_limit_allows_when_remaining(mock_get):
    mock_get.return_value.json.return_value = {
        "resources": {"core": {"remaining": 100}}
    }
    assert check_rate_limit(MOCK_ACCESS_TOKEN)


@patch("api.utils.syncing.github.actions.requests.get")
def test_check_rate_limit_denies_when_exceeded(mock_get):
    mock_get.return_value.json.return_value = {
        "resources": {"core": {"remaining": 0, "reset": 9999999999}}
    }
    assert not check_rate_limit(MOCK_ACCESS_TOKEN)


@patch("api.utils.syncing.github.actions.get_all_secrets", return_value=[])
@patch(
    "api.utils.syncing.github.actions.encrypt_secret", return_value=MOCK_ENCRYPTED_VALUE
)
@patch("api.utils.syncing.github.actions.requests.put")
@patch("api.utils.syncing.github.actions.requests.get")
def test_sync_github_secrets_success(mock_get, mock_put, mock_encrypt, mock_existing):
    # Mock public key request
    mock_get.side_effect = get_mocked_response
    mock_put.return_value.status_code = 201

    secrets = [("MY_SECRET", "value", None)]
    success, result = sync_github_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert success
    assert result["message"] == "Secrets synced successfully"
    assert mock_encrypt.called


@patch("api.utils.syncing.github.actions.get_all_secrets", return_value=[])
@patch(
    "api.utils.syncing.github.actions.encrypt_secret",
    return_value="A" * (64 * 1024 + 1),
)  # too large
@patch("api.utils.syncing.github.actions.requests.put")
@patch("api.utils.syncing.github.actions.requests.get")
def test_sync_skips_oversized_secret(mock_get, mock_put, mock_encrypt, mock_existing):
    mock_get.side_effect = get_mocked_response
    secrets = [("HUGE_SECRET", "value", None)]
    success, result = sync_github_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert success
    assert "synced successfully" in result["message"]
    mock_put.assert_not_called()


@patch(
    "api.utils.syncing.github.actions.get_all_secrets",
    return_value=[{"name": "OLD_SECRET"}],
)
@patch(
    "api.utils.syncing.github.actions.encrypt_secret", return_value=MOCK_ENCRYPTED_VALUE
)
@patch("api.utils.syncing.github.actions.requests.delete")
@patch("api.utils.syncing.github.actions.requests.put")
@patch("api.utils.syncing.github.actions.requests.get")
def test_sync_deletes_missing_secrets(
    mock_get, mock_put, mock_delete, mock_encrypt, mock_existing
):
    # First call for public key
    mock_get.side_effect = get_mocked_response
    mock_put.return_value.status_code = 201
    mock_delete.return_value.status_code = 204

    secrets = [("NEW_SECRET", "value", None)]
    success, result = sync_github_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert success
    mock_delete.assert_called_once()
    assert "synced successfully" in result["message"]


@patch("api.utils.syncing.github.actions.get_all_secrets", return_value=[])
@patch(
    "api.utils.syncing.github.actions.encrypt_secret", return_value=MOCK_ENCRYPTED_VALUE
)
@patch("api.utils.syncing.github.actions.requests.put")
@patch("api.utils.syncing.github.actions.requests.get")
def test_sync_github_secrets_fails_on_put_error(
    mock_get, mock_put, mock_encrypt, mock_existing
):
    mock_get.side_effect = get_mocked_response
    mock_put.return_value.status_code = 422
    mock_put.return_value.text = "Unprocessable Entity"

    secrets = [("BAD_SECRET", "value", None)]
    success, result = sync_github_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert not success
    assert "Error syncing secret" in result["message"]


@patch("api.utils.syncing.github.actions.requests.get")
def test_get_all_secrets_pagination(mock_get):
    # Page 1 returns one secret
    page1_response = Mock()
    page1_response.status_code = 200
    page1_response.json.return_value = {"secrets": [{"name": "SECRET1"}]}

    # Page 2 returns another secret
    page2_response = Mock()
    page2_response.status_code = 200
    page2_response.json.return_value = {"secrets": [{"name": "SECRET2"}]}

    # Page 3 returns empty to end pagination
    page3_response = Mock()
    page3_response.status_code = 200
    page3_response.json.return_value = {"secrets": []}

    mock_get.side_effect = [page1_response, page2_response, page3_response]

    headers = {"Authorization": f"Bearer {MOCK_ACCESS_TOKEN}"}
    secrets = get_all_secrets(MOCK_REPO, MOCK_OWNER, headers)

    assert len(secrets) == 2
    assert secrets[0]["name"] == "SECRET1"
    assert secrets[1]["name"] == "SECRET2"
