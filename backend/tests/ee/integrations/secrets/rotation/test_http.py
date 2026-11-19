from unittest.mock import MagicMock, patch

import pytest
from django.core.exceptions import ValidationError

from ee.integrations.secrets.providers.exceptions import (
    ProviderConfigError,
    ProviderNotFound,
)
from ee.integrations.secrets.providers.http import _safe_url, request


@patch("ee.integrations.secrets.providers.http.validate_url_is_safe")
@patch("ee.integrations.secrets.providers.http.settings")
def test_safe_url_self_hosted_skips_validation(mock_settings, mock_validate):
    mock_settings.APP_HOST = "self"
    _safe_url("https://api.openai.com/v1/foo")
    mock_validate.assert_not_called()


@patch("ee.integrations.secrets.providers.http.validate_url_is_safe")
@patch("ee.integrations.secrets.providers.http.settings")
def test_safe_url_cloud_passes_public_urls(mock_settings, mock_validate):
    mock_settings.APP_HOST = "cloud"
    mock_validate.return_value = None
    _safe_url("https://api.openai.com/v1/foo")
    mock_validate.assert_called_once_with("https://api.openai.com/v1/foo")


@patch("ee.integrations.secrets.providers.http.validate_url_is_safe")
@patch("ee.integrations.secrets.providers.http.settings")
def test_safe_url_cloud_translates_validation_error(mock_settings, mock_validate):
    mock_settings.APP_HOST = "cloud"
    mock_validate.side_effect = ValidationError("private IP")
    with pytest.raises(ProviderConfigError):
        _safe_url("http://10.0.0.1/key")


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_request_disables_redirects(mock_request):
    mock_request.return_value = MagicMock(
        status_code=200, text="", phase_summary=None
    )
    request("GET", "https://api.example.com/x", timeout=(1, 1))
    _, kwargs = mock_request.call_args
    assert kwargs["allow_redirects"] is False


def _error_response(status, body):
    resp = MagicMock(status_code=status, text=str(body))
    resp.json.return_value = body
    return resp


@pytest.mark.parametrize(
    "body, expected",
    [
        ({"error": {"message": "bad scope"}}, "bad scope"),
        ({"error": "bad scope"}, "bad scope"),
        ({"message": "bad scope"}, "bad scope"),
        ({"message": {"scopes": ["is invalid"]}}, "scopes is invalid"),
        ({"errors": ["bad scope"]}, "bad scope"),
        ({"errors": [{"code": 1000, "message": "bad scope"}]}, "bad scope"),
    ],
)
@patch("ee.integrations.secrets.providers.http.requests.request")
def test_config_error_includes_provider_message(mock_request, body, expected):
    mock_request.return_value = _error_response(400, body)

    with pytest.raises(ProviderConfigError) as exc:
        request("POST", "https://api.example.com/x")

    assert exc.value.user_message == f"Provider returned an error (400): {expected}"


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_config_error_without_message_keeps_generic_text(mock_request):
    mock_request.return_value = _error_response(422, {"unexpected": True})

    with pytest.raises(ProviderConfigError) as exc:
        request("POST", "https://api.example.com/x")

    assert exc.value.user_message == "Provider returned an error (422)."


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_not_found_includes_provider_message(mock_request):
    mock_request.return_value = _error_response(
        404, {"message": "404 Project Not Found"}
    )

    with pytest.raises(ProviderNotFound) as exc:
        request("DELETE", "https://api.example.com/x")

    assert exc.value.user_message == "Not found at the provider: 404 Project Not Found"


@patch("ee.integrations.secrets.providers.http.requests.request")
def test_provider_message_is_redacted(mock_request):
    leaked = "sk-proj-" + "a" * 24
    mock_request.return_value = _error_response(400, {"error": f"bad key {leaked}"})

    with pytest.raises(ProviderConfigError) as exc:
        request("POST", "https://api.example.com/x")

    assert leaked not in exc.value.user_message
    assert "***" in exc.value.user_message
