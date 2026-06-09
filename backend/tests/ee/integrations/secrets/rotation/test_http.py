from unittest.mock import MagicMock, patch

import pytest
from django.core.exceptions import ValidationError

from ee.integrations.secrets.rotation.exceptions import RotationProviderConfigError
from ee.integrations.secrets.rotation.http import _safe_url, request


@patch("ee.integrations.secrets.rotation.http.validate_url_is_safe")
@patch("ee.integrations.secrets.rotation.http.settings")
def test_safe_url_self_hosted_skips_validation(mock_settings, mock_validate):
    mock_settings.APP_HOST = "self"
    _safe_url("https://api.openai.com/v1/foo")
    mock_validate.assert_not_called()


@patch("ee.integrations.secrets.rotation.http.validate_url_is_safe")
@patch("ee.integrations.secrets.rotation.http.settings")
def test_safe_url_cloud_passes_public_urls(mock_settings, mock_validate):
    mock_settings.APP_HOST = "cloud"
    mock_validate.return_value = None
    _safe_url("https://api.openai.com/v1/foo")
    mock_validate.assert_called_once_with("https://api.openai.com/v1/foo")


@patch("ee.integrations.secrets.rotation.http.validate_url_is_safe")
@patch("ee.integrations.secrets.rotation.http.settings")
def test_safe_url_cloud_translates_validation_error(mock_settings, mock_validate):
    mock_settings.APP_HOST = "cloud"
    mock_validate.side_effect = ValidationError("private IP")
    with pytest.raises(RotationProviderConfigError):
        _safe_url("http://10.0.0.1/key")


@patch("ee.integrations.secrets.rotation.http.requests.request")
def test_request_disables_redirects(mock_request):
    mock_request.return_value = MagicMock(
        status_code=200, text="", phase_summary=None
    )
    request("GET", "https://api.example.com/x", timeout=(1, 1))
    _, kwargs = mock_request.call_args
    assert kwargs["allow_redirects"] is False
