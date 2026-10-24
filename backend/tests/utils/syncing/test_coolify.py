import pytest
from unittest.mock import patch, Mock

from api.utils.syncing.coolify.main import (
    COOLIFY_USER_AGENT,
    build_coolify_env_payload,
    list_coolify_applications,
    normalize_coolify_url,
    sync_coolify_secrets,
)

MOCK_CREDENTIAL_ID = "cred-123"
MOCK_API_TOKEN = "coolify-test-token-not-real"
MOCK_COOLIFY_URL = "https://coolify.example.com"
MOCK_API_BASE_URL = "https://coolify.example.com/api/v1"
MOCK_APPLICATION_UUID = "abcd1234efgh5678ijkl9012"

ENVS_URL = f"{MOCK_API_BASE_URL}/applications/{MOCK_APPLICATION_UUID}/envs"


@pytest.fixture(autouse=True)
def mock_credentials():
    with patch(
        "api.utils.syncing.coolify.main.get_credentials",
        return_value={"coolify_url": MOCK_COOLIFY_URL, "api_token": MOCK_API_TOKEN},
    ) as mock_creds:
        yield mock_creds


def mock_response(status_code=200, json_data=None, text=""):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = json_data if json_data is not None else {}
    response.text = text
    return response


def remote_env(key, uuid, is_preview=False):
    return {"uuid": uuid, "key": key, "value": "old", "is_preview": is_preview}


@pytest.mark.parametrize(
    "url",
    [
        "https://coolify.example.com",
        "https://coolify.example.com/",
        "https://coolify.example.com/api/v1",
        "https://coolify.example.com/api/v1/",
        "https://coolify.example.com/api",
        "  https://coolify.example.com  ",
        "coolify.example.com",
    ],
)
def test_normalize_coolify_url(url):
    assert normalize_coolify_url(url) == MOCK_API_BASE_URL


def test_normalize_coolify_url_keeps_http_and_port():
    assert (
        normalize_coolify_url("http://10.0.0.5:8000/")
        == "http://10.0.0.5:8000/api/v1"
    )


def test_normalize_coolify_url_rejects_empty():
    with pytest.raises(Exception, match="No Coolify URL"):
        normalize_coolify_url("")


@patch("api.utils.syncing.coolify.main.requests.get")
def test_list_coolify_applications_success(mock_get):
    mock_get.return_value = mock_response(
        200,
        [
            {
                "uuid": MOCK_APPLICATION_UUID,
                "name": "my-app",
                "fqdn": "https://app.example.com",
                "status": "running:healthy",
            },
            {"uuid": "other-uuid", "name": "worker", "fqdn": None},
        ],
    )

    applications = list_coolify_applications(MOCK_CREDENTIAL_ID)

    assert applications == [
        {
            "id": MOCK_APPLICATION_UUID,
            "name": "my-app",
            "fqdn": "https://app.example.com",
        },
        {"id": "other-uuid", "name": "worker", "fqdn": None},
    ]
    mock_get.assert_called_once()
    assert mock_get.call_args.args[0] == f"{MOCK_API_BASE_URL}/applications"
    headers = mock_get.call_args.kwargs["headers"]
    assert headers["Authorization"] == f"Bearer {MOCK_API_TOKEN}"
    # A non-default User-Agent is required by instances behind Cloudflare
    assert headers["User-Agent"] == COOLIFY_USER_AGENT


@patch("api.utils.syncing.coolify.main.requests.get")
def test_list_coolify_applications_bad_credentials(mock_get):
    mock_get.return_value = mock_response(401)

    with pytest.raises(Exception, match="Incorrect credentials"):
        list_coolify_applications(MOCK_CREDENTIAL_ID)


@patch("api.utils.syncing.coolify.main.requests.get")
def test_list_coolify_applications_other_error(mock_get):
    mock_get.return_value = mock_response(500)

    with pytest.raises(Exception, match="Error listing Coolify applications"):
        list_coolify_applications(MOCK_CREDENTIAL_ID)


def test_build_coolify_env_payload_writes_production_and_preview():
    pem = "-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----"
    payload = build_coolify_env_payload(
        [("API_KEY", "va$lue'\"", None), ("PEM", pem, "comment")]
    )

    assert payload == [
        {
            "key": "API_KEY",
            "value": "va$lue'\"",
            "is_preview": False,
            "is_literal": True,
            "is_multiline": False,
            "is_shown_once": False,
        },
        {
            "key": "PEM",
            "value": pem,
            "is_preview": False,
            "is_literal": True,
            "is_multiline": True,
            "is_shown_once": False,
        },
        {
            "key": "API_KEY",
            "value": "va$lue'\"",
            "is_preview": True,
            "is_literal": True,
            "is_multiline": False,
            "is_shown_once": False,
        },
        {
            "key": "PEM",
            "value": pem,
            "is_preview": True,
            "is_literal": True,
            "is_multiline": True,
            "is_shown_once": False,
        },
    ]


@patch("api.utils.syncing.coolify.main.requests.patch")
@patch("api.utils.syncing.coolify.main.requests.delete")
@patch("api.utils.syncing.coolify.main.requests.get")
def test_sync_coolify_secrets_success(mock_get, mock_delete, mock_patch):
    mock_get.return_value = mock_response(
        200,
        [
            remote_env("KEEP_ME", "env-1"),
            remote_env("KEEP_ME", "env-2", is_preview=True),
            remote_env("STALE_KEY", "env-3"),
            remote_env("STALE_KEY", "env-4", is_preview=True),
            remote_env("SERVICE_FQDN_APP", "env-5"),
        ],
    )

    call_order = []
    mock_patch.side_effect = lambda *a, **kw: call_order.append(
        "patch"
    ) or mock_response(201)
    mock_delete.side_effect = lambda *a, **kw: call_order.append(
        "delete"
    ) or mock_response(200)

    secrets = [("KEEP_ME", "new-value", None), ("NEW_KEY", "value", "comment")]
    success, result = sync_coolify_secrets(
        secrets, MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID
    )

    assert success
    assert result["response_code"] == 200

    mock_patch.assert_called_once()
    assert mock_patch.call_args.args[0] == f"{ENVS_URL}/bulk"
    payload = mock_patch.call_args.kwargs["json"]["data"]
    assert [(env["key"], env["is_preview"]) for env in payload] == [
        ("KEEP_ME", False),
        ("NEW_KEY", False),
        ("KEEP_ME", True),
        ("NEW_KEY", True),
    ]

    # Both copies of a stale key are removed; Coolify-managed SERVICE_* are not
    deleted_urls = [call.args[0] for call in mock_delete.call_args_list]
    assert deleted_urls == [f"{ENVS_URL}/env-3", f"{ENVS_URL}/env-4"]

    # Writes land before deletions so a failed push leaves the target intact
    assert call_order == ["patch", "delete", "delete"]


@patch("api.utils.syncing.coolify.main.requests.patch")
@patch("api.utils.syncing.coolify.main.requests.delete")
@patch("api.utils.syncing.coolify.main.requests.get")
def test_sync_coolify_secrets_no_delete_when_nothing_stale(
    mock_get, mock_delete, mock_patch
):
    mock_get.return_value = mock_response(200, [remote_env("KEY_1", "env-1")])
    mock_patch.return_value = mock_response(201)

    success, _ = sync_coolify_secrets(
        [("KEY_1", "value", None)], MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID
    )

    assert success
    mock_delete.assert_not_called()


@patch("api.utils.syncing.coolify.main.requests.patch")
@patch("api.utils.syncing.coolify.main.requests.delete")
@patch("api.utils.syncing.coolify.main.requests.get")
def test_sync_coolify_secrets_empty_environment_clears_target(
    mock_get, mock_delete, mock_patch
):
    mock_get.return_value = mock_response(
        200,
        [remote_env("OLD", "env-1"), remote_env("OLD", "env-2", is_preview=True)],
    )
    mock_delete.return_value = mock_response(200)

    success, _ = sync_coolify_secrets([], MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID)

    assert success
    # Coolify rejects an empty bulk payload, so no upsert is sent
    mock_patch.assert_not_called()
    assert mock_delete.call_count == 2


@patch("api.utils.syncing.coolify.main.requests.get")
def test_sync_coolify_secrets_fetch_error(mock_get):
    mock_get.return_value = mock_response(404, text="Application not found")

    success, result = sync_coolify_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID
    )

    assert not success
    assert result["response_code"] == 404
    assert "Error fetching Coolify environment variables" in result["message"]


@patch("api.utils.syncing.coolify.main.requests.patch")
@patch("api.utils.syncing.coolify.main.requests.delete")
@patch("api.utils.syncing.coolify.main.requests.get")
def test_sync_coolify_secrets_upsert_error_skips_delete(
    mock_get, mock_delete, mock_patch
):
    mock_get.return_value = mock_response(200, [remote_env("STALE", "env-1")])
    mock_patch.return_value = mock_response(422, text="Validation failed.")

    success, result = sync_coolify_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID
    )

    assert not success
    assert result["response_code"] == 422
    assert "Error syncing secrets" in result["message"]
    mock_delete.assert_not_called()


@patch("api.utils.syncing.coolify.main.requests.patch")
@patch("api.utils.syncing.coolify.main.requests.delete")
@patch("api.utils.syncing.coolify.main.requests.get")
def test_sync_coolify_secrets_delete_error(mock_get, mock_delete, mock_patch):
    mock_get.return_value = mock_response(200, [remote_env("STALE", "env-1")])
    mock_patch.return_value = mock_response(201)
    mock_delete.return_value = mock_response(500, text="Server error")

    success, result = sync_coolify_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID
    )

    assert not success
    assert result["response_code"] == 500
    assert "Error deleting Coolify environment variable STALE" in result["message"]


@patch("api.utils.syncing.coolify.main.requests.patch")
@patch("api.utils.syncing.coolify.main.requests.delete")
@patch("api.utils.syncing.coolify.main.requests.get")
def test_sync_coolify_secrets_ignores_already_deleted(
    mock_get, mock_delete, mock_patch
):
    mock_get.return_value = mock_response(200, [remote_env("STALE", "env-1")])
    mock_patch.return_value = mock_response(201)
    mock_delete.return_value = mock_response(404, text="Not found")

    success, _ = sync_coolify_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID
    )

    assert success
