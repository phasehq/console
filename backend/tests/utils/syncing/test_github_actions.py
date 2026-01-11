from api.utils.syncing.github.actions import (
    check_rate_limit,
    encrypt_secret,
    get_all_secrets,
    sync_github_secrets,
    list_repos,
)
import base64
import pytest
from unittest.mock import patch, Mock, call


@pytest.fixture(autouse=True)
def mock_settings():
    with patch("api.utils.syncing.github.actions.settings") as mock_settings:
        mock_settings.APP_HOST = "cloud"
        yield mock_settings


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
            "key_id": "1380204578043523344",
            "key": "V+kIG2GZl25Tlr9LC6uPA5EzVfrow9I3VcVCKFkkwVM=",
        }
        return mock_response

    elif "/actions/secrets" in url:
        mock_response.status_code = 200
        mock_response.json.return_value = {"secrets": [{"name": "EXISTING_SECRET"}]}
        return mock_response

    raise ValueError(f"Unhandled GET URL: {url}")


# Mock data
MOCK_PUBLIC_KEY = base64.b64encode(b"A" * 32).decode("utf-8")
MOCK_ENCRYPTED_VALUE = base64.b64encode(b"encrypted").decode("utf-8")
MOCK_ACCESS_TOKEN = "ghp_x96ociStAXnGrAzhTrOJknn3vCzbqi1hsz4HR8iBPqk"
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
    assert not success
    assert "too large to sync" in result["message"]
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


@patch("api.utils.syncing.github.actions.requests.get")
@patch("api.utils.syncing.github.actions.decrypt_asymmetric", return_value=MOCK_ACCESS_TOKEN)
@patch("api.utils.syncing.github.actions.get_server_keypair")
@patch("api.utils.syncing.github.actions.apps.get_model")
def test_list_repos_handles_pagination_for_1000_repos(
    mock_apps_get_model, mock_get_server_keypair, mock_decrypt_asymmetric, mock_requests_get
):
    """Test list_repos correctly paginates to fetch all repositories (e.g., 1000)."""
    mock_pk_obj = Mock()
    mock_pk_obj.hex.return_value = "mock_pk_hex"
    mock_sk_obj = Mock()
    mock_sk_obj.hex.return_value = "mock_sk_hex"
    mock_get_server_keypair.return_value = (mock_pk_obj, mock_sk_obj)

    mock_provider_credential = Mock()
    mock_provider_credential.credentials = {"access_token": "encrypted_access_token"}
    mock_apps_get_model.return_value.objects.get.return_value = mock_provider_credential

    def mock_fetch_repos_side_effect(url, headers):
        response_mock = Mock()
        response_mock.status_code = 200

        if f"{MOCK_API_HOST}/user/repos" in url:
            assert headers == {"Authorization": f"Bearer {MOCK_ACCESS_TOKEN}"}
            query_params = url.split("?")[1]
            params = dict(qp.split("=") for qp in query_params.split("&"))
            page = int(params.get("page", "1"))

            repos_data = []
            if 1 <= page <= 10:  # 10 pages for 1000 repos (100 per page)
                for i in range(100):
                    repo_global_index = (page - 1) * 100 + i
                    repos_data.append(
                        {
                            "name": f"repo_{repo_global_index}",
                            "owner": {"login": "test-owner"},
                            "private": repo_global_index % 2 == 0,  # Mix of private/public
                        }
                    )
            # Page 11 (or more) will return empty repos_data, ending pagination

            response_mock.json.return_value = repos_data
        else:
            # Fallback for any other unexpected calls, though none are expected in this flow
            response_mock.status_code = 404
            response_mock.json.return_value = {"message": "Not Found"}
            # Or raise ValueError for strictness:
            # raise ValueError(f"Unhandled GET URL in test_list_repos_pagination: {url}")

        return response_mock

    mock_requests_get.side_effect = mock_fetch_repos_side_effect

    # Call the function under test
    retrieved_repos = list_repos(credential_id="dummy_cred_id")

    # Assertions
    assert len(retrieved_repos) == 1000
    for i in range(1000):
        assert retrieved_repos[i]["name"] == f"repo_{i}"
        assert retrieved_repos[i]["owner"] == "test-owner"
        expected_type = "private" if i % 2 == 0 else "public"
        assert retrieved_repos[i]["type"] == expected_type

    # Check that requests.get was called 11 times (10 pages with data, 1 empty page)
    expected_api_calls = []
    for page_num in range(1, 12): # Pages 1 through 11
        expected_url = f"{MOCK_API_HOST}/user/repos?per_page=100&type=all&page={page_num}"
        expected_api_calls.append(
            call(expected_url, headers={"Authorization": f"Bearer {MOCK_ACCESS_TOKEN}"})
        )

    mock_requests_get.assert_has_calls(expected_api_calls, any_order=False)
    assert mock_requests_get.call_count == 11
    mock_decrypt_asymmetric.assert_called_once()
    mock_get_server_keypair.assert_called_once()
    mock_apps_get_model.return_value.objects.get.assert_called_once_with(id="dummy_cred_id")
