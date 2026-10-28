import pytest
from unittest.mock import patch, Mock

from api.utils.syncing.coolify.main import (
    COOLIFY_USER_AGENT,
    CoolifyError,
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


@pytest.fixture
def mock_request():
    with patch("api.utils.syncing.coolify.main.requests.request") as mock:
        yield mock


@pytest.fixture(autouse=True)
def no_sleep():
    with patch("api.utils.syncing.coolify.main.time.sleep") as mock:
        yield mock


def mock_response(status_code=200, json_data=None, text="", headers=None):
    response = Mock()
    response.status_code = status_code
    if json_data is None:
        response.json.side_effect = ValueError("no json")
    else:
        response.json.return_value = json_data
    response.text = text
    response.headers = headers or {}
    return response


def route(get=None, patch=None, delete=None):
    """Answer each request by method, and record the order they were sent in."""
    calls = []
    responses = {"GET": get, "PATCH": patch, "DELETE": delete}

    def handler(method, url, **kwargs):
        calls.append((method, url, kwargs))
        response = responses[method]
        # Mocks are callable too, so only plain functions are called
        return response if isinstance(response, Mock) else response(url)

    return handler, calls


def remote_env(key, uuid, is_preview=False, **flags):
    return {"uuid": uuid, "key": key, "value": "old", "is_preview": is_preview, **flags}


def sync(mock_request, secrets, handler, **kwargs):
    mock_request.side_effect = handler
    return sync_coolify_secrets(
        secrets, MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID, **kwargs
    )


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


def test_list_coolify_applications_success(mock_request):
    mock_request.return_value = mock_response(
        200,
        [
            {
                "uuid": MOCK_APPLICATION_UUID,
                "name": "my-app",
                "fqdn": "https://app.example.com",
                "status": "running:healthy",
            },
            {"uuid": "otheruuid", "name": "worker", "fqdn": None},
        ],
    )

    applications = list_coolify_applications(MOCK_CREDENTIAL_ID)

    assert applications == [
        {
            "id": MOCK_APPLICATION_UUID,
            "name": "my-app",
            "fqdn": "https://app.example.com",
        },
        {"id": "otheruuid", "name": "worker", "fqdn": None},
    ]
    mock_request.assert_called_once()
    assert mock_request.call_args.args == ("GET", f"{MOCK_API_BASE_URL}/applications")
    kwargs = mock_request.call_args.kwargs
    assert kwargs["headers"]["Authorization"] == f"Bearer {MOCK_API_TOKEN}"
    # A non-default User-Agent is required by instances behind Cloudflare
    assert kwargs["headers"]["User-Agent"] == COOLIFY_USER_AGENT
    assert kwargs["timeout"] == (5, 15)
    assert kwargs["allow_redirects"] is False


def test_list_coolify_applications_bad_credentials(mock_request):
    mock_request.return_value = mock_response(401, {"message": "Unauthenticated."})

    with pytest.raises(CoolifyError, match="rejected the API token"):
        list_coolify_applications(MOCK_CREDENTIAL_ID)


def test_list_coolify_applications_api_disabled(mock_request):
    mock_request.return_value = mock_response(403, {"message": "API is disabled."})

    with pytest.raises(CoolifyError, match="Coolify API is disabled. Enable API access"):
        list_coolify_applications(MOCK_CREDENTIAL_ID)


def test_list_coolify_applications_other_error(mock_request):
    mock_request.return_value = mock_response(500, text="<html>boom</html>")

    with pytest.raises(CoolifyError, match=r"HTTP 500") as exc:
        list_coolify_applications(MOCK_CREDENTIAL_ID)
    # The raw body is never echoed
    assert "boom" not in str(exc.value)


def test_list_coolify_applications_wrong_url(mock_request):
    mock_request.return_value = mock_response(404)

    with pytest.raises(CoolifyError, match="No Coolify API was found at this URL"):
        list_coolify_applications(MOCK_CREDENTIAL_ID)


def test_list_coolify_applications_does_not_wait_on_rate_limit(mock_request, no_sleep):
    mock_request.return_value = mock_response(429, headers={"Retry-After": "30"})

    with pytest.raises(CoolifyError, match="rate limit"):
        list_coolify_applications(MOCK_CREDENTIAL_ID)

    mock_request.assert_called_once()
    no_sleep.assert_not_called()


@patch("api.utils.syncing.coolify.main.settings")
@patch("api.utils.syncing.coolify.main.validate_url_is_safe")
def test_cloud_rejects_internal_coolify_url(
    mock_validate, mock_settings, mock_request
):
    from django.core.exceptions import ValidationError

    mock_settings.APP_HOST = "cloud"
    mock_validate.side_effect = ValidationError(
        "URL resolves to a restricted IP address: 127.0.0.1"
    )

    with pytest.raises(CoolifyError, match="restricted IP address"):
        list_coolify_applications(MOCK_CREDENTIAL_ID)

    success, result = sync_coolify_secrets(
        [("KEY", "value", None)], MOCK_CREDENTIAL_ID, MOCK_APPLICATION_UUID
    )
    assert not success
    assert result["message"] == "URL resolves to a restricted IP address: 127.0.0.1"
    mock_request.assert_not_called()


@patch("api.utils.syncing.coolify.main.settings")
@patch("api.utils.syncing.coolify.main.validate_url_is_safe")
def test_self_hosted_allows_internal_coolify_url(
    mock_validate, mock_settings, mock_request
):
    mock_settings.APP_HOST = "self"
    mock_request.return_value = mock_response(200, [])

    list_coolify_applications(MOCK_CREDENTIAL_ID)

    mock_validate.assert_not_called()


def test_build_coolify_env_payload_production_only():
    pem = "-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----"
    payload = build_coolify_env_payload(
        [("API_KEY", "va$lue'\"", None), ("PEM", pem, "comment")], [False], {}
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
    ]


def test_build_coolify_env_payload_keeps_locked_flag():
    existing = {
        ("LOCKED", False): {"is_shown_once": True},
        ("LOCKED", True): {"is_shown_once": False},
    }
    payload = build_coolify_env_payload(
        [("LOCKED", "v", None), ("NEW", "v", None)], [False, True], existing
    )

    assert [(e["key"], e["is_preview"], e["is_shown_once"]) for e in payload] == [
        ("LOCKED", False, True),
        ("NEW", False, False),
        ("LOCKED", True, False),
        ("NEW", True, False),
    ]


def test_sync_production_only_by_default(mock_request):
    handler, calls = route(
        get=mock_response(
            200,
            [
                remote_env("KEEP_ME", "env1"),
                remote_env("KEEP_ME", "env2", is_preview=True),
                remote_env("STALE_KEY", "env3"),
                remote_env("STALE_KEY", "env4", is_preview=True),
            ],
        ),
        patch=mock_response(201),
        delete=mock_response(200),
    )

    secrets = [("KEEP_ME", "new-value", None), ("NEW_KEY", "value", "comment")]
    success, result = sync(mock_request, secrets, handler)

    assert success, result
    patch_call = next(c for c in calls if c[0] == "PATCH")
    assert patch_call[1] == f"{ENVS_URL}/bulk"
    payload = patch_call[2]["json"]["data"]
    assert [(e["key"], e["is_preview"]) for e in payload] == [
        ("KEEP_ME", False),
        ("NEW_KEY", False),
    ]
    # Preview copies are left alone
    assert [c[1] for c in calls if c[0] == "DELETE"] == [f"{ENVS_URL}/env3"]


def test_sync_preview_writes_and_deletes_both_copies(mock_request):
    handler, calls = route(
        get=mock_response(
            200,
            [
                remote_env("KEEP_ME", "env1"),
                remote_env("STALE_KEY", "env3"),
                remote_env("STALE_KEY", "env4", is_preview=True),
            ],
        ),
        patch=mock_response(201),
        delete=mock_response(200),
    )

    success, _ = sync(
        mock_request, [("KEEP_ME", "v", None)], handler, sync_preview=True
    )

    assert success
    payload = next(c for c in calls if c[0] == "PATCH")[2]["json"]["data"]
    assert [(e["key"], e["is_preview"]) for e in payload] == [
        ("KEEP_ME", False),
        ("KEEP_ME", True),
    ]
    assert [c[1] for c in calls if c[0] == "DELETE"] == [
        f"{ENVS_URL}/env3",
        f"{ENVS_URL}/env4",
    ]
    # Writes land before deletions
    assert [c[0] for c in calls] == ["GET", "PATCH", "DELETE", "DELETE"]


def test_sync_keeps_coolify_managed_variables(mock_request):
    handler, calls = route(
        get=mock_response(
            200,
            [
                remote_env("NIXPACKS_NODE_VERSION", "env1", is_buildpack_control=True),
                remote_env("COOLIFY_FQDN", "env2", is_coolify=True),
                remote_env("SERVICE_FQDN_APP", "env3"),
                remote_env("STALE", "env4"),
            ],
        ),
        patch=mock_response(201),
        delete=mock_response(200),
    )

    success, _ = sync(mock_request, [("KEY", "v", None)], handler)

    assert success
    assert [c[1] for c in calls if c[0] == "DELETE"] == [f"{ENVS_URL}/env4"]


def test_sync_skips_reserved_service_keys(mock_request):
    handler, calls = route(
        get=mock_response(200, []), patch=mock_response(201)
    )

    success, result = sync(
        mock_request, [("KEY", "v", None), ("SERVICE_TOKEN", "v", None)], handler
    )

    assert success
    payload = next(c for c in calls if c[0] == "PATCH")[2]["json"]["data"]
    assert [e["key"] for e in payload] == ["KEY"]
    assert "Skipped keys reserved by Coolify: SERVICE_TOKEN" in result["message"]


def test_sync_rejects_invalid_keys_before_any_request(mock_request):
    handler, calls = route(get=mock_response(200, []), patch=mock_response(201))

    success, result = sync(
        mock_request,
        [
            ("AAA_NEW_BEFORE", "v", None),
            ("MY-KEY", "v", None),
            ("2FA_SECRET", "v", None),
            ("ZZZ_NEW_AFTER", "v", None),
        ],
        handler,
    )

    assert not success
    assert result["message"].startswith("Nothing was synced.")
    assert "Rename: 2FA_SECRET, MY-KEY" in result["message"]
    assert calls == []


def test_sync_refuses_empty_source_when_target_has_variables(mock_request):
    handler, calls = route(
        get=mock_response(200, [remote_env("DATABASE_URL", "env1")]),
        patch=mock_response(201),
        delete=mock_response(200),
    )

    success, result = sync(mock_request, [], handler)

    assert not success
    assert result["message"].startswith("Nothing was synced.")
    assert [c[0] for c in calls] == ["GET"]


def test_sync_empty_source_and_empty_target_succeeds(mock_request):
    handler, calls = route(
        get=mock_response(
            200, [remote_env("NIXPACKS_NODE_VERSION", "env1", is_buildpack_control=True)]
        )
    )

    success, _ = sync(mock_request, [], handler)

    assert success
    # Coolify rejects an empty bulk payload, so no upsert is sent
    assert [c[0] for c in calls] == ["GET"]


@pytest.mark.parametrize(
    "application_uuid",
    ["../databases/abc123", "abc/def", "ABC123", "", None],
)
def test_sync_rejects_malformed_application_uuid(mock_request, application_uuid):
    success, result = sync_coolify_secrets(
        [("KEY", "v", None)], MOCK_CREDENTIAL_ID, application_uuid
    )

    assert not success
    assert "Invalid Coolify application id" in result["message"]
    mock_request.assert_not_called()


def test_sync_fetch_error(mock_request):
    handler, _ = route(get=mock_response(404, {"message": "Application not found."}))

    success, result = sync(mock_request, [("KEY", "v", None)], handler)

    assert not success
    assert result["response_code"] == 404
    assert "Error fetching Coolify environment variables" in result["message"]


def test_sync_upsert_error_skips_delete(mock_request):
    handler, calls = route(
        get=mock_response(200, [remote_env("STALE", "env1")]),
        patch=mock_response(
            422,
            {
                "message": "Validation failed.",
                "errors": {"key": ["The key field format is invalid."]},
            },
        ),
    )

    success, result = sync(mock_request, [("KEY", "v", None)], handler)

    assert not success
    assert result["response_code"] == 422
    assert "The key field format is invalid." in result["message"]
    assert "DELETE" not in [c[0] for c in calls]


def test_sync_delete_error(mock_request):
    handler, _ = route(
        get=mock_response(200, [remote_env("STALE", "env1")]),
        patch=mock_response(201),
        delete=mock_response(500, text="Server error"),
    )

    success, result = sync(mock_request, [("KEY", "v", None)], handler)

    assert not success
    assert result["response_code"] == 500
    assert "Error deleting Coolify environment variable STALE" in result["message"]


def test_sync_ignores_already_deleted(mock_request):
    handler, _ = route(
        get=mock_response(200, [remote_env("STALE", "env1")]),
        patch=mock_response(201),
        delete=mock_response(404, text="Not found"),
    )

    success, _ = sync(mock_request, [("KEY", "v", None)], handler)

    assert success


def test_sync_retries_after_rate_limit(mock_request, no_sleep):
    deletes = iter(
        [mock_response(429, headers={"Retry-After": "7"}), mock_response(200)]
    )
    handler, calls = route(
        get=mock_response(200, [remote_env("STALE", "env1")]),
        patch=mock_response(201),
        delete=lambda url: next(deletes),
    )

    success, _ = sync(mock_request, [("KEY", "v", None)], handler)

    assert success
    assert [c[0] for c in calls] == ["GET", "PATCH", "GET", "DELETE", "DELETE"]
    no_sleep.assert_called_once_with(7)


def test_sync_gives_up_after_repeated_rate_limits(mock_request):
    handler, calls = route(get=mock_response(429))

    success, result = sync(mock_request, [("KEY", "v", None)], handler)

    assert not success
    assert "rate limit" in result["message"]
    assert len(calls) == 4


class FakeCoolify:
    """Keeps an application's variables like Coolify does: a new production
    variable gets a preview copy (EnvironmentVariable::created)."""

    def __init__(self, envs=()):
        self.envs = [dict(env) for env in envs]
        self.next_id = 0

    def _add(self, key, value, is_preview):
        self.next_id += 1
        self.envs.append(
            {"uuid": f"new{self.next_id}", "key": key, "value": value, "is_preview": is_preview}
        )

    def handler(self, method, url, **kwargs):
        if method == "GET":
            return mock_response(200, [dict(env) for env in self.envs])
        if method == "PATCH":
            for item in kwargs["json"]["data"]:
                scope = item["is_preview"]
                match = [e for e in self.envs if e["key"] == item["key"] and e["is_preview"] == scope]
                if match:
                    match[0]["value"] = item["value"]
                    continue
                had_key = any(e["key"] == item["key"] for e in self.envs)
                self._add(item["key"], item["value"], scope)
                if not scope and not had_key:
                    self._add(item["key"], item["value"], True)
            return mock_response(201, [])
        if method == "DELETE":
            env_uuid = url.rsplit("/", 1)[1]
            self.envs = [e for e in self.envs if e["uuid"] != env_uuid]
            return mock_response(200, {})

    def values(self, is_preview):
        return {e["key"]: e["value"] for e in self.envs if e["is_preview"] == is_preview}


def test_preview_off_keeps_new_secrets_out_of_previews(mock_request):
    coolify = FakeCoolify()

    success, _ = sync(mock_request, [("SATELLITE_HANDOFF_KEY", "v1", None)], coolify.handler)

    assert success
    assert coolify.values(is_preview=False) == {"SATELLITE_HANDOFF_KEY": "v1"}
    assert coolify.values(is_preview=True) == {}


def test_preview_off_leaves_existing_preview_values_alone(mock_request):
    coolify = FakeCoolify(
        [
            remote_env("FIRMWARE_UPDATE_URL", "env1"),
            {**remote_env("FIRMWARE_UPDATE_URL", "env2", is_preview=True), "value": "preview-url"},
        ]
    )

    success, _ = sync(
        mock_request,
        [("FIRMWARE_UPDATE_URL", "prod-url", None), ("NEW_KEY", "v", None)],
        coolify.handler,
    )

    assert success
    assert coolify.values(is_preview=False) == {"FIRMWARE_UPDATE_URL": "prod-url", "NEW_KEY": "v"}
    assert coolify.values(is_preview=True) == {"FIRMWARE_UPDATE_URL": "preview-url"}


def test_preview_off_delete_in_phase_leaves_nothing_behind(mock_request):
    coolify = FakeCoolify()
    secrets = [("SATELLITE_HANDOFF_KEY", "v", None), ("KEEP", "v", None)]

    sync(mock_request, secrets, coolify.handler)
    success, _ = sync(mock_request, secrets[1:], coolify.handler)

    assert success
    assert coolify.values(is_preview=False) == {"KEEP": "v"}
    assert coolify.values(is_preview=True) == {}


def test_preview_on_writes_and_removes_both_copies(mock_request):
    coolify = FakeCoolify()

    sync(mock_request, [("A", "1", None), ("B", "1", None)], coolify.handler, sync_preview=True)
    success, _ = sync(mock_request, [("A", "2", None)], coolify.handler, sync_preview=True)

    assert success
    assert coolify.values(is_preview=False) == {"A": "2"}
    assert coolify.values(is_preview=True) == {"A": "2"}
