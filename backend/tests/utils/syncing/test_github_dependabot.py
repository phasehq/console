import base64
from unittest.mock import Mock, patch

from api.utils.syncing.github.dependabot import (
    get_all_dependabot_repo_secrets,
    get_all_dependabot_org_secrets,
    sync_github_dependabot_secrets,
    sync_github_dependabot_org_secrets,
)

MOCK_ENCRYPTED_VALUE = base64.b64encode(b"encrypted").decode("utf-8")
MOCK_ACCESS_TOKEN = "ghp_x96ociStAXnGrAzhTrOJknn3vCzbqi1hsz4HR8iBPqk"
MOCK_REPO = "demo-repo"
MOCK_OWNER = "demo-owner"
MOCK_ORG = "demo-org"


def get_mocked_response(url, *args, **kwargs):
    mock_response = Mock()

    if "/rate_limit" in url:
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "resources": {"core": {"remaining": 5000, "reset": 9999999999}}
        }
        return mock_response

    if "/dependabot/secrets/public-key" in url:
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "key_id": "1380204578043523344",
            "key": "V+kIG2GZl25Tlr9LC6uPA5EzVfrow9I3VcVCKFkkwVM=",
        }
        return mock_response

    if "/dependabot/secrets" in url:
        mock_response.status_code = 200
        mock_response.json.return_value = {"secrets": [{"name": "EXISTING_SECRET"}]}
        return mock_response

    raise ValueError(f"Unhandled GET URL: {url}")


@patch("api.utils.syncing.github.dependabot.get_all_dependabot_repo_secrets", return_value=[])
@patch(
    "api.utils.syncing.github.dependabot.encrypt_secret", return_value=MOCK_ENCRYPTED_VALUE
)
@patch("api.utils.syncing.github.dependabot.requests.put")
@patch("api.utils.syncing.github.dependabot.requests.get")
def test_sync_dependabot_secrets_success(mock_get, mock_put, mock_encrypt, mock_existing):
    mock_get.side_effect = get_mocked_response
    mock_put.return_value.status_code = 201

    secrets = [("MY_SECRET", "value", None)]
    success, result = sync_github_dependabot_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert success
    assert result["message"] == "Dependabot secrets synced successfully"
    assert mock_encrypt.called


@patch("api.utils.syncing.github.dependabot.get_all_dependabot_repo_secrets", return_value=[])
@patch(
    "api.utils.syncing.github.dependabot.encrypt_secret",
    return_value="A" * (64 * 1024 + 1),
)  # too large
@patch("api.utils.syncing.github.dependabot.requests.put")
@patch("api.utils.syncing.github.dependabot.requests.get")
def test_sync_dependabot_oversized_secret(mock_get, mock_put, mock_encrypt, mock_existing):
    mock_get.side_effect = get_mocked_response
    secrets = [("HUGE_SECRET", "value", None)]
    success, result = sync_github_dependabot_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert not success
    assert "too large to sync" in result["message"]
    mock_put.assert_not_called()


@patch(
    "api.utils.syncing.github.dependabot.get_all_dependabot_repo_secrets",
    return_value=[{"name": "OLD_SECRET"}],
)
@patch(
    "api.utils.syncing.github.dependabot.encrypt_secret", return_value=MOCK_ENCRYPTED_VALUE
)
@patch("api.utils.syncing.github.dependabot.requests.delete")
@patch("api.utils.syncing.github.dependabot.requests.put")
@patch("api.utils.syncing.github.dependabot.requests.get")
def test_sync_dependabot_deletes_missing_secrets(
    mock_get, mock_put, mock_delete, mock_encrypt, mock_existing
):
    mock_get.side_effect = get_mocked_response
    mock_put.return_value.status_code = 201
    mock_delete.return_value.status_code = 204

    secrets = [("NEW_SECRET", "value", None)]
    success, result = sync_github_dependabot_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert success
    mock_delete.assert_called_once()
    assert "synced successfully" in result["message"]


@patch("api.utils.syncing.github.dependabot.get_all_dependabot_repo_secrets", return_value=[])
@patch(
    "api.utils.syncing.github.dependabot.encrypt_secret", return_value=MOCK_ENCRYPTED_VALUE
)
@patch("api.utils.syncing.github.dependabot.requests.put")
@patch("api.utils.syncing.github.dependabot.requests.get")
def test_sync_dependabot_secrets_fails_on_put_error(
    mock_get, mock_put, mock_encrypt, mock_existing
):
    mock_get.side_effect = get_mocked_response
    mock_put.return_value.status_code = 422
    mock_put.return_value.text = "Unprocessable Entity"

    secrets = [("BAD_SECRET", "value", None)]
    success, result = sync_github_dependabot_secrets(
        secrets, MOCK_ACCESS_TOKEN, MOCK_REPO, MOCK_OWNER
    )
    assert not success
    assert "Error syncing secret" in result["message"]


@patch("api.utils.syncing.github.dependabot.requests.get")
def test_get_all_dependabot_repo_secrets_pagination(mock_get):
    page1_response = Mock()
    page1_response.status_code = 200
    page1_response.json.return_value = {"secrets": [{"name": "SECRET1"}]}

    page2_response = Mock()
    page2_response.status_code = 200
    page2_response.json.return_value = {"secrets": [{"name": "SECRET2"}]}

    page3_response = Mock()
    page3_response.status_code = 200
    page3_response.json.return_value = {"secrets": []}

    mock_get.side_effect = [page1_response, page2_response, page3_response]

    headers = {"Authorization": f"Bearer {MOCK_ACCESS_TOKEN}"}
    secrets = get_all_dependabot_repo_secrets(MOCK_REPO, MOCK_OWNER, headers)

    assert len(secrets) == 2
    assert secrets[0]["name"] == "SECRET1"
    assert secrets[1]["name"] == "SECRET2"


@patch("api.utils.syncing.github.dependabot.requests.get")
def test_get_all_dependabot_org_secrets_pagination(mock_get):
    page1_response = Mock()
    page1_response.status_code = 200
    page1_response.json.return_value = {"secrets": [{"name": "ORG_SECRET1"}]}

    page2_response = Mock()
    page2_response.status_code = 200
    page2_response.json.return_value = {"secrets": [{"name": "ORG_SECRET2"}]}

    page3_response = Mock()
    page3_response.status_code = 200
    page3_response.json.return_value = {"secrets": []}

    mock_get.side_effect = [page1_response, page2_response, page3_response]

    headers = {"Authorization": f"Bearer {MOCK_ACCESS_TOKEN}"}
    secrets = get_all_dependabot_org_secrets(MOCK_ORG, headers)

    assert len(secrets) == 2
    assert secrets[0]["name"] == "ORG_SECRET1"
    assert secrets[1]["name"] == "ORG_SECRET2"

