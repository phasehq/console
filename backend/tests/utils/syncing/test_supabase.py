import pytest
from unittest.mock import patch, Mock

from api.utils.syncing.supabase.main import (
    SUPABASE_API_BASE_URL,
    list_supabase_projects,
    sync_supabase_secrets,
)

MOCK_CREDENTIAL_ID = "cred-123"
# Deliberately not a valid sbp_ token shape, to stay clear of secret scanning
MOCK_ACCESS_TOKEN = "sbp-test-token-not-real"
MOCK_PROJECT_REF = "abcdefghijklmnopqrst"

SECRETS_URL = f"{SUPABASE_API_BASE_URL}/projects/{MOCK_PROJECT_REF}/secrets"


@pytest.fixture(autouse=True)
def mock_credentials():
    with patch(
        "api.utils.syncing.supabase.main.get_credentials",
        return_value={"access_token": MOCK_ACCESS_TOKEN},
    ) as mock_creds:
        yield mock_creds


def mock_response(status_code=200, json_data=None, text=""):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = json_data if json_data is not None else {}
    response.text = text
    return response


@patch("api.utils.syncing.supabase.main.requests.get")
def test_list_supabase_projects_success(mock_get):
    mock_get.return_value = mock_response(
        200,
        [
            {
                "id": "legacy-id",
                "ref": MOCK_PROJECT_REF,
                "organization_id": "org-1",
                "name": "My Project",
                "region": "us-east-1",
            }
        ],
    )

    projects = list_supabase_projects(MOCK_CREDENTIAL_ID)

    assert projects == [
        {"id": MOCK_PROJECT_REF, "name": "My Project", "region": "us-east-1"}
    ]
    mock_get.assert_called_once()
    assert mock_get.call_args.args[0] == f"{SUPABASE_API_BASE_URL}/projects"
    assert (
        mock_get.call_args.kwargs["headers"]["Authorization"]
        == f"Bearer {MOCK_ACCESS_TOKEN}"
    )


@patch("api.utils.syncing.supabase.main.requests.get")
def test_list_supabase_projects_falls_back_to_id_without_ref(mock_get):
    mock_get.return_value = mock_response(
        200, [{"id": MOCK_PROJECT_REF, "name": "My Project"}]
    )

    projects = list_supabase_projects(MOCK_CREDENTIAL_ID)

    assert projects == [{"id": MOCK_PROJECT_REF, "name": "My Project", "region": None}]


@patch("api.utils.syncing.supabase.main.requests.get")
def test_list_supabase_projects_bad_credentials(mock_get):
    mock_get.return_value = mock_response(401)

    with pytest.raises(Exception, match="Incorrect credentials"):
        list_supabase_projects(MOCK_CREDENTIAL_ID)


@patch("api.utils.syncing.supabase.main.requests.get")
def test_list_supabase_projects_other_error(mock_get):
    mock_get.return_value = mock_response(500)

    with pytest.raises(Exception, match="Error listing Supabase projects"):
        list_supabase_projects(MOCK_CREDENTIAL_ID)


@patch("api.utils.syncing.supabase.main.requests.post")
@patch("api.utils.syncing.supabase.main.requests.delete")
@patch("api.utils.syncing.supabase.main.requests.get")
def test_sync_supabase_secrets_success(mock_get, mock_delete, mock_post):
    mock_get.return_value = mock_response(
        200,
        [
            {"name": "STALE_KEY", "value": "old"},
            {"name": "KEEP_ME", "value": "old"},
            {"name": "SUPABASE_URL", "value": "system"},
        ],
    )
    mock_delete.return_value = mock_response(200)
    mock_post.return_value = mock_response(201)

    secrets = [("KEEP_ME", "new-value", None), ("NEW_KEY", "value", "comment")]
    success, result = sync_supabase_secrets(
        secrets, MOCK_CREDENTIAL_ID, MOCK_PROJECT_REF
    )

    assert success
    assert result["response_code"] == 200

    # Stale remote secrets are removed, but reserved SUPABASE_* names are not
    mock_delete.assert_called_once()
    assert mock_delete.call_args.args[0] == SECRETS_URL
    assert mock_delete.call_args.kwargs["json"] == ["STALE_KEY"]

    mock_post.assert_called_once()
    assert mock_post.call_args.args[0] == SECRETS_URL
    assert mock_post.call_args.kwargs["json"] == [
        {"name": "KEEP_ME", "value": "new-value"},
        {"name": "NEW_KEY", "value": "value"},
    ]


@patch("api.utils.syncing.supabase.main.requests.post")
@patch("api.utils.syncing.supabase.main.requests.delete")
@patch("api.utils.syncing.supabase.main.requests.get")
def test_sync_supabase_secrets_no_delete_when_nothing_stale(
    mock_get, mock_delete, mock_post
):
    mock_get.return_value = mock_response(200, [{"name": "KEY_1", "value": "old"}])
    mock_post.return_value = mock_response(200)

    success, _ = sync_supabase_secrets(
        [("KEY_1", "value", None)], MOCK_CREDENTIAL_ID, MOCK_PROJECT_REF
    )

    assert success
    mock_delete.assert_not_called()


@patch("api.utils.syncing.supabase.main.requests.post")
@patch("api.utils.syncing.supabase.main.requests.delete")
@patch("api.utils.syncing.supabase.main.requests.get")
def test_sync_supabase_secrets_skips_reserved_keys(mock_get, mock_delete, mock_post):
    mock_get.return_value = mock_response(200, [])

    secrets = [("SUPABASE_CUSTOM", "value", None)]
    success, result = sync_supabase_secrets(
        secrets, MOCK_CREDENTIAL_ID, MOCK_PROJECT_REF
    )

    assert success
    assert "SUPABASE_CUSTOM" in result["message"]
    # Nothing left to push once reserved keys are filtered out
    mock_post.assert_not_called()
    mock_delete.assert_not_called()


@patch("api.utils.syncing.supabase.main.requests.post")
@patch("api.utils.syncing.supabase.main.requests.get")
def test_sync_supabase_secrets_batches_large_payloads(mock_get, mock_post):
    mock_get.return_value = mock_response(200, [])
    mock_post.return_value = mock_response(201)

    secrets = [(f"KEY_{i}", f"value_{i}", None) for i in range(150)]
    success, _ = sync_supabase_secrets(secrets, MOCK_CREDENTIAL_ID, MOCK_PROJECT_REF)

    assert success
    assert mock_post.call_count == 2
    first_batch = mock_post.call_args_list[0].kwargs["json"]
    second_batch = mock_post.call_args_list[1].kwargs["json"]
    assert len(first_batch) == 100
    assert len(second_batch) == 50
    assert first_batch[0] == {"name": "KEY_0", "value": "value_0"}
    assert second_batch[-1] == {"name": "KEY_149", "value": "value_149"}


@patch("api.utils.syncing.supabase.main.requests.get")
def test_sync_supabase_secrets_fetch_error(mock_get):
    mock_get.return_value = mock_response(403, text="Forbidden")

    success, result = sync_supabase_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_PROJECT_REF
    )

    assert not success
    assert result["response_code"] == 403


@patch("api.utils.syncing.supabase.main.requests.delete")
@patch("api.utils.syncing.supabase.main.requests.get")
def test_sync_supabase_secrets_delete_error(mock_get, mock_delete):
    mock_get.return_value = mock_response(200, [{"name": "STALE_KEY", "value": "old"}])
    mock_delete.return_value = mock_response(400, text="Bad request")

    success, result = sync_supabase_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_PROJECT_REF
    )

    assert not success
    assert result["response_code"] == 400
    assert "Error deleting Supabase secrets" in result["message"]


@patch("api.utils.syncing.supabase.main.requests.post")
@patch("api.utils.syncing.supabase.main.requests.get")
def test_sync_supabase_secrets_create_error(mock_get, mock_post):
    mock_get.return_value = mock_response(200, [])
    mock_post.return_value = mock_response(400, text="Invalid secret name")

    success, result = sync_supabase_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_PROJECT_REF
    )

    assert not success
    assert result["response_code"] == 400
    assert "Error syncing secrets" in result["message"]
