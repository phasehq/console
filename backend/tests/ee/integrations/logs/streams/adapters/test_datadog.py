"""Datadog adapter: URL/site handling, payload wrapping, status mapping."""

import gzip
import json
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest
import requests as requests_lib

from ee.integrations.logs.streams.adapters.datadog import DatadogAdapter
from ee.integrations.logs.streams.exceptions import (
    AdapterAuthError,
    AdapterPermanentError,
    AdapterRateLimitedError,
    AdapterTransientError,
)

_M = "ee.integrations.logs.streams.adapters.datadog"


@contextmanager
def _patch_http(method="post", **mock_kwargs):
    """Patch the adapter's pooled requests session; yields the method mock."""
    session = MagicMock()
    method_mock = getattr(session, method)
    method_mock.configure_mock(**mock_kwargs)
    with patch(f"{_M}._get_session", return_value=session):
        yield method_mock


CREDS = {"api_key": "dd-key-123", "site": "us3.datadoghq.com"}
CONTEXT = {"organisation_name": "Acme Corp", "stream_name": "My Datadog Export"}

ENVELOPE = {
    "schema_version": 1,
    "event": {"id": "e1", "category": "secrets", "type": "read"},
    "timestamp": "2026-07-30T12:00:00+00:00",
    "actor": {"type": "user", "id": "m1", "name": "dev@example.com"},
    "client": {"address": "203.0.113.7"},
    "user_agent": {"original": "phase-cli/1.18"},
    "user": {"id": "m1", "email": "dev@example.com", "name": "Dev"},
    "phase": {"organisation": {"id": "o1", "name": "Acme"}},
}


def _response(status=202, headers=None, text=""):
    response = MagicMock()
    response.status_code = status
    response.headers = headers or {}
    response.text = text
    return response


def _adapter():
    return DatadogAdapter()


def test_intake_url_site_allowlist_and_normalisation():
    adapter = _adapter()

    url, site = adapter._intake_url({"site": "https://us3.datadoghq.com/"})
    assert url == "https://http-intake.logs.us3.datadoghq.com/api/v2/logs"
    assert site == "us3.datadoghq.com"

    url, _ = adapter._intake_url({})
    assert url == "https://http-intake.logs.datadoghq.com/api/v2/logs"

    with pytest.raises(AdapterPermanentError, match="Unknown Datadog site"):
        adapter._intake_url({"site": "evil.example.com"})


def test_ship_sends_gzipped_payload_with_reserved_fields_and_remaps():
    adapter = _adapter()

    with _patch_http("post", return_value=_response(202)) as mock_post:
        result = adapter.ship([ENVELOPE], CREDS, {"tags": "env:prod"}, CONTEXT)

    assert result.status_code == 202
    args, kwargs = mock_post.call_args
    assert args[0] == "https://http-intake.logs.us3.datadoghq.com/api/v2/logs"
    assert kwargs["headers"]["DD-API-KEY"] == "dd-key-123"
    assert kwargs["headers"]["Content-Encoding"] == "gzip"

    payload = json.loads(gzip.decompress(kwargs["data"]))
    event = payload[0]

    # Reserved fields set only in the adapter; tag values are sanitized so
    # names with spaces don't break Datadog's tag parsing.
    assert event["ddsource"] == "phase"
    assert event["service"] == "phase-console"
    assert "phase_org:acme_corp" in event["ddtags"]
    assert "phase_stream:my_datadog_export" in event["ddtags"]
    assert "env:prod" in event["ddtags"]
    assert event["message"] == "secrets.read"

    # OTel names remapped to Datadog standard attributes
    assert event["network"]["client"]["ip"] == "203.0.113.7"
    assert event["http"]["useragent"] == "phase-cli/1.18"
    assert event["usr"]["email"] == "dev@example.com"
    for removed in ("client", "user_agent", "user"):
        assert removed not in event


def test_ship_without_gzip():
    adapter = _adapter()

    with _patch_http("post", return_value=_response(202)) as mock_post:
        adapter.ship([ENVELOPE], CREDS, {"gzip": False}, CONTEXT)

    _, kwargs = mock_post.call_args
    assert "Content-Encoding" not in kwargs["headers"]
    json.loads(kwargs["data"])  # plain JSON body


@pytest.mark.parametrize(
    "status,exc",
    [
        (401, AdapterAuthError),
        (403, AdapterAuthError),
        (400, AdapterPermanentError),
        (413, AdapterPermanentError),
        (500, AdapterTransientError),
        (503, AdapterTransientError),
    ],
)
def test_ship_maps_http_status_to_typed_errors(status, exc):
    adapter = _adapter()

    with _patch_http("post", return_value=_response(status)):
        with pytest.raises(exc):
            adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)


@pytest.mark.parametrize("status", [200, 301, 302, 303, 307])
def test_ship_accepts_only_202(status):
    """Datadog's v2 intake acknowledges with 202 only. A redirect or a
    non-202 2xx means an intermediary answered (e.g. a TLS-intercepting
    proxy) — accepting it would advance the cursor over events Datadog never
    ingested. Retrying is safe: at-least-once, consumers dedupe."""
    adapter = _adapter()

    with _patch_http("post", return_value=_response(status)):
        with pytest.raises(AdapterTransientError):
            adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)


def test_ship_does_not_follow_redirects():
    """Following a 3xx would convert the POST to a body-less GET (silent
    data loss) and re-send DD-API-KEY to the redirect target — requests only
    strips Authorization on cross-host redirects."""
    adapter = _adapter()

    with _patch_http("post", return_value=_response(202)) as mock_post:
        adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)

    assert mock_post.call_args.kwargs["allow_redirects"] is False


def test_ship_rate_limited_carries_retry_after():
    adapter = _adapter()

    with _patch_http(
        "post",
        return_value=_response(429, headers={"Retry-After": "30"}),
    ):
        with pytest.raises(AdapterRateLimitedError) as excinfo:
            adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)

    assert excinfo.value.retry_after == 30.0


def test_ship_connection_error_is_transient():
    adapter = _adapter()

    with _patch_http("post", side_effect=requests_lib.ConnectionError("boom")):
        with pytest.raises(AdapterTransientError):
            adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)


def test_test_validates_key_without_ingesting_data():
    """Connection tests hit Datadog's key-validation endpoint — never the
    logs intake, so no garbage events land in the customer's org."""
    adapter = _adapter()

    session = MagicMock()
    session.get.return_value = _response(200)
    with patch(f"{_M}._get_session", return_value=session):
        ok, meta = adapter.test(CREDS, {}, CONTEXT)

    assert ok is True
    assert meta["status_code"] == 200
    assert session.get.call_args.args[0] == "https://api.us3.datadoghq.com/api/v1/validate"
    assert session.get.call_args.kwargs["headers"]["DD-API-KEY"] == "dd-key-123"
    assert session.get.call_args.kwargs["allow_redirects"] is False
    session.post.assert_not_called()


def test_test_maps_invalid_key_to_auth_error():
    adapter = _adapter()

    with _patch_http("get", return_value=_response(403)):
        with pytest.raises(AdapterAuthError, match="credentials"):
            adapter.test(CREDS, {}, CONTEXT)


def test_auth_error_message_says_credentials_not_key():
    adapter = _adapter()

    with _patch_http("post", return_value=_response(401)):
        with pytest.raises(AdapterAuthError) as excinfo:
            adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)

    assert "credentials" in excinfo.value.user_message
    assert "key" not in excinfo.value.user_message.lower()


@pytest.mark.parametrize(
    "site,expected_host",
    [
        ("datadoghq.com", "app.datadoghq.com"),
        ("datadoghq.eu", "app.datadoghq.eu"),
        ("us3.datadoghq.com", "us3.datadoghq.com"),
        ("ap1.datadoghq.com", "ap1.datadoghq.com"),
        ("ddog-gov.com", "app.ddog-gov.com"),
    ],
)
def test_destination_url_maps_site_to_app_host(site, expected_host):
    adapter = _adapter()

    url = adapter.destination_url({"site": site}, {})

    assert url == f"https://{expected_host}/logs?query=source%3Aphase"


def test_destination_url_rejects_unknown_site():
    adapter = _adapter()

    assert adapter.destination_url({"site": "evil.example.com"}, {}) is None


def test_validate_options_defaults_and_bounds():
    adapter = _adapter()

    options = adapter.validate_options({})
    assert options == {"service": "phase-console", "tags": "", "gzip": True}

    options = adapter.validate_options({"service": "x" * 500, "gzip": False})
    assert len(options["service"]) == 100
    assert options["gzip"] is False


def test_parse_retry_after_accepts_seconds_dates_and_garbage():
    """RFC 9110 allows delay-seconds OR an HTTP-date (intermediary proxies
    emit dates). An unparseable value must yield None — the engine then uses
    its own backoff — never raise out of the retry ladder."""
    from ee.integrations.logs.streams.adapters.datadog import _parse_retry_after

    assert _parse_retry_after("2.5") == 2.5
    assert _parse_retry_after(None) is None
    assert _parse_retry_after("") is None
    assert _parse_retry_after("not-a-date") is None
    # Negative values would crash time.sleep; nan/inf poison the engine's
    # min()/deadline arithmetic and the meta JSON. Clamp or discard.
    assert _parse_retry_after("-1") == 0.0
    assert _parse_retry_after("nan") is None
    assert _parse_retry_after("inf") is None
    # A past HTTP-date clamps to 0 (falsy -> engine backoff).
    assert _parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT") == 0.0
    future = _parse_retry_after("Fri, 01 Jan 2100 00:00:00 GMT")
    assert future is not None and future > 0


def test_ship_survives_http_date_retry_after():
    """Regression: a bare float() on an HTTP-date Retry-After raised
    ValueError past the typed error handlers into the job crash path."""
    adapter = _adapter()
    response = _response(
        429, headers={"Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT"}
    )

    with _patch_http("post", return_value=response):
        with pytest.raises(AdapterRateLimitedError) as exc_info:
            adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)

    assert exc_info.value.retry_after == 0.0


def test_ship_rate_limited_without_retry_after_header():
    adapter = _adapter()

    with _patch_http("post", return_value=_response(429)):
        with pytest.raises(AdapterRateLimitedError) as exc_info:
            adapter.ship([ENVELOPE], CREDS, {}, CONTEXT)

    assert exc_info.value.retry_after is None


def test_intake_and_app_urls_for_uk1_and_us2_fed():
    adapter = _adapter()

    url, _ = adapter._intake_url({"site": "uk1.datadoghq.com"})
    assert url == "https://http-intake.logs.uk1.datadoghq.com/api/v2/logs"
    url, _ = adapter._intake_url({"site": "us2.ddog-gov.com"})
    assert url == "https://http-intake.logs.us2.ddog-gov.com/api/v2/logs"

    # Both are regional (two-dot) sites — already app hosts, no app. prefix.
    assert adapter.destination_url({"site": "uk1.datadoghq.com"}, {}) == (
        "https://uk1.datadoghq.com/logs?query=source%3Aphase"
    )
    assert adapter.destination_url({"site": "us2.ddog-gov.com"}, {}) == (
        "https://us2.ddog-gov.com/logs?query=source%3Aphase"
    )
