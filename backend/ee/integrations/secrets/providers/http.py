from __future__ import annotations

import logging
import time
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.core.exceptions import ValidationError

from api.utils.network import validate_url_is_safe

from .exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
    ProviderQuotaError,
    ProviderTransientError,
)
from .sanitize import excerpt

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = (5, 30)  # (connect, read)


def _endpoint_summary(method: str, url: str) -> str:
    # Drops query string since some providers put secrets there.
    try:
        parsed = urlparse(url)
        host = parsed.netloc or ""
        path = parsed.path or "/"
        return f"{method.upper()} {host}{path}"
    except Exception:
        return f"{method.upper()} {url}"


def call_summary(response: requests.Response) -> dict:
    return getattr(response, "phase_summary", {}) or {}


def _extract_provider_message(response) -> str | None:
    try:
        body = response.json()
    except (ValueError, AttributeError):
        return None
    if not isinstance(body, dict):
        return None
    err = body.get("error")
    if isinstance(err, dict):
        msg = err.get("message")
        if isinstance(msg, str):
            return msg.strip()[:300]
    if isinstance(err, str):
        return err.strip()[:300]
    for key in ("message", "detail", "error_description"):
        v = body.get(key)
        if isinstance(v, str):
            return v.strip()[:300]
    return None


def _safe_url(url: str) -> None:
    if getattr(settings, "APP_HOST", "self") != "cloud":
        return
    try:
        validate_url_is_safe(url)
    except ValidationError as e:
        raise ProviderConfigError(
            f"URL not reachable in cloud mode: {url}",
            user_message="The configured URL is not reachable from the Phase cloud.",
        ) from e


def request(
    method: str,
    url: str,
    *,
    headers: dict | None = None,
    json: dict | None = None,
    params: dict | None = None,
    timeout: tuple[int, int] = DEFAULT_TIMEOUT,
) -> requests.Response:
    """Perform an HTTP request and translate failures into ProviderError subclasses."""
    _safe_url(url)
    endpoint = _endpoint_summary(method, url)
    started = time.monotonic()

    def _elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        # Disable redirects so a provider 3xx can't bypass the URL allowlist.
        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            json=json,
            params=params,
            timeout=timeout,
            allow_redirects=False,
        )
    except requests.Timeout as e:
        raise ProviderTransientError(
            f"Timeout calling {method} {url}: {e}",
            user_message="The provider did not respond in time. Will retry.",
            raw={
                "endpoint": endpoint,
                "duration_ms": _elapsed_ms(),
                "transport_error": "timeout",
            },
        ) from e
    except requests.ConnectionError as e:
        raise ProviderTransientError(
            f"Connection error calling {method} {url}: {e}",
            user_message="Could not reach the provider. Will retry.",
            raw={
                "endpoint": endpoint,
                "duration_ms": _elapsed_ms(),
                "transport_error": "connection",
            },
        ) from e
    except requests.RequestException as e:
        raise ProviderTransientError(
            f"HTTP error calling {method} {url}: {e}",
            user_message="Provider request failed. Will retry.",
            raw={
                "endpoint": endpoint,
                "duration_ms": _elapsed_ms(),
                "transport_error": e.__class__.__name__,
            },
        ) from e

    duration_ms = _elapsed_ms()

    if 200 <= response.status_code < 300:
        try:
            response.phase_summary = {
                "endpoint": endpoint,
                "status": response.status_code,
                "duration_ms": duration_ms,
            }
        except Exception:
            pass
        return response

    body_excerpt = excerpt(response.text)
    raw = {
        "endpoint": endpoint,
        "status": response.status_code,
        "duration_ms": duration_ms,
        "body": body_excerpt,
    }

    if response.status_code in (401, 403):
        provider_msg = _extract_provider_message(response)
        user_message = (
            f"Provider authentication failed: {provider_msg}"
            if provider_msg
            else "Provider authentication failed. Update the root credentials and resume rotation."
        )
        raise ProviderAuthError(
            f"{response.status_code} from {method} {url}: {body_excerpt}",
            user_message=user_message,
            raw=raw,
        )
    if response.status_code == 404:
        raise ProviderNotFound(
            f"404 from {method} {url}: {body_excerpt}",
            user_message="Credential not found at provider.",
            raw=raw,
        )
    if response.status_code == 429:
        raise ProviderTransientError(
            f"429 from {method} {url}: {body_excerpt}",
            user_message="Provider rate limit hit. Will retry.",
            raw=raw,
        )
    if 500 <= response.status_code < 600:
        raise ProviderTransientError(
            f"{response.status_code} from {method} {url}: {body_excerpt}",
            user_message="Provider returned a server error. Will retry.",
            raw=raw,
        )
    if response.status_code == 402:
        raise ProviderQuotaError(
            f"402 from {method} {url}: {body_excerpt}",
            user_message="Provider returned a billing / quota error.",
            raw=raw,
        )
    raise ProviderConfigError(
        f"{response.status_code} from {method} {url}: {body_excerpt}",
        user_message=f"Provider returned an error ({response.status_code}).",
        raw=raw,
    )
