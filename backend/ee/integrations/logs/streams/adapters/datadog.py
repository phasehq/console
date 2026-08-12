"""Datadog Logs intake adapter.

Ships chunks to ``https://http-intake.logs.{site}/api/v2/logs`` with the
stream's API key. Uses plain ``requests`` — no Datadog SDK.

The neutral envelope is remapped onto Datadog standard attributes here so
logs light up native facets with zero pipeline configuration:

- ``client.address``      -> ``network.client.ip``
- ``user_agent.original`` -> ``http.useragent``
- ``user.*``              -> ``usr.{id,name,email}``
"""

import gzip
import json
import math
import re
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

from ..exceptions import (
    AdapterAuthError,
    AdapterPermanentError,
    AdapterRateLimitedError,
    AdapterTransientError,
)
from .base import LogStreamAdapter, ShipResult

# Hard allowlist — the site composes into the intake URL, so this doubles as
# an SSRF guard for attacker-controlled credential values.
DATADOG_SITES = (
    "datadoghq.com",
    "us3.datadoghq.com",
    "us5.datadoghq.com",
    "datadoghq.eu",
    "uk1.datadoghq.com",
    "ap1.datadoghq.com",
    "ap2.datadoghq.com",
    "ddog-gov.com",
    "us2.ddog-gov.com",
)

REQUEST_TIMEOUT = (5, 30)  # (connect, read) seconds


def _parse_retry_after(value):
    """Retry-After is delay-seconds OR an HTTP-date (RFC 9110 §10.2.3 —
    intermediary proxies emit dates). Unparseable values fall back to None,
    which lets the engine use its own backoff."""
    if not value:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = None
    if parsed is not None:
        # nan/inf/negatives break the sleep arithmetic; 0.0 -> engine backoff.
        if not math.isfinite(parsed):
            return None
        return max(0.0, parsed)
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0.0, (parsed - datetime.now(timezone.utc)).total_seconds())


def _tag_value(value):
    """Sanitize a value for use in a Datadog tag — tags don't allow spaces or
    most punctuation, and an org named "Acme Corp" must not break parsing."""
    sanitized = re.sub(r"[^a-z0-9\-_./:]+", "_", str(value).lower())
    return sanitized.strip("_:")[:200]


class DatadogAdapter(LogStreamAdapter):
    id = "datadog"
    name = "Datadog"
    credentials_provider = "datadog"
    # Datadog's intake accepts events with timestamps up to 18h in the past;
    # older events are silently dropped after a 202.
    max_event_age = timedelta(hours=18)

    def validate_options(self, options):
        options = options or {}
        validated = {
            "service": str(options.get("service") or "phase-console")[:100],
            "tags": str(options.get("tags") or "")[:500],
            "gzip": bool(options.get("gzip", True)),
        }
        return validated

    def test(self, credentials, options, context):
        """Validate the API key via Datadog's dedicated key-validation
        endpoint — no log data is ingested."""
        self.validate_options(options)
        _, site = self._intake_url(credentials)

        try:
            response = requests.get(
                f"https://api.{site}/api/v1/validate",
                headers={"DD-API-KEY": credentials.get("api_key") or ""},
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as ex:
            raise AdapterTransientError(
                f"Could not reach Datadog: {ex}",
                user_message="Could not reach Datadog",
            ) from ex

        if response.status_code == 200:
            return True, {"status_code": 200, "site": site}
        if response.status_code in (401, 403):
            raise AdapterAuthError(
                f"Datadog rejected the credentials ({response.status_code})",
                user_message="Datadog rejected the credentials",
                status_code=response.status_code,
            )
        raise AdapterTransientError(
            f"Datadog returned {response.status_code}",
            status_code=response.status_code,
        )

    def destination_url(self, credentials, options):
        """Deep link to the Datadog Logs explorer filtered to Phase events."""
        site = (credentials.get("site") or "datadoghq.com").strip().lower()
        site = site.removeprefix("https://").removeprefix("http://").strip("/")
        if site not in DATADOG_SITES:
            return None
        # Bare sites host the app on an app. subdomain; regional sites
        # (us3.datadoghq.com etc.) are already the app host.
        host = f"app.{site}" if site.count(".") == 1 else site
        return f"https://{host}/logs?query=source%3Aphase"

    def _intake_url(self, credentials):
        site = (credentials.get("site") or "datadoghq.com").strip().lower()
        # Tolerate pasted values like "https://us3.datadoghq.com/"
        site = site.removeprefix("https://").removeprefix("http://").strip("/")
        if site not in DATADOG_SITES:
            raise AdapterPermanentError(
                f"Unknown Datadog site '{site}'",
                user_message=f"Unknown Datadog site '{site}'. Expected one of: "
                + ", ".join(DATADOG_SITES),
            )
        return f"https://http-intake.logs.{site}/api/v2/logs", site

    def _to_datadog_event(self, envelope, options, context):
        event = dict(envelope)

        client = event.pop("client", None) or {}
        user_agent = event.pop("user_agent", None) or {}
        user = event.pop("user", None)

        if client.get("address"):
            event["network"] = {"client": {"ip": client["address"]}}
        if user_agent.get("original"):
            event["http"] = {"useragent": user_agent["original"]}
        if user:
            event["usr"] = {
                "id": user.get("id", ""),
                "name": user.get("name") or user.get("full_name") or "",
                "email": user.get("email", ""),
            }

        phase = event.get("phase", {})
        event_block = event.get("event", {})
        message = phase.get("description") or "{}.{}".format(
            event_block.get("category", "event"), event_block.get("type", "unknown")
        )

        tags = [
            "phase_org:{}".format(_tag_value(context.get("organisation_name", ""))),
            "phase_stream:{}".format(_tag_value(context.get("stream_name", ""))),
        ]
        if options.get("tags"):
            tags.append(options["tags"])

        event["ddsource"] = "phase"
        event["service"] = options.get("service") or "phase-console"
        event["ddtags"] = ",".join(t for t in tags if t and not t.endswith(":"))
        event["message"] = message
        return event

    def ship(self, chunk, credentials, options, context):
        options = self.validate_options(options)
        url, site = self._intake_url(credentials)
        api_key = credentials.get("api_key") or ""

        body = json.dumps(
            [self._to_datadog_event(envelope, options, context) for envelope in chunk],
            default=str,
        ).encode("utf-8")

        headers = {
            "DD-API-KEY": api_key,
            "Content-Type": "application/json",
        }
        if options["gzip"]:
            body = gzip.compress(body)
            headers["Content-Encoding"] = "gzip"

        started = time.monotonic()
        try:
            response = requests.post(url, data=body, headers=headers, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as ex:
            raise AdapterTransientError(
                f"Could not reach Datadog intake: {ex}",
                user_message="Could not reach the Datadog intake endpoint",
            ) from ex
        duration_ms = int((time.monotonic() - started) * 1000)

        status = response.status_code
        if status in (200, 202):
            return ShipResult(
                status_code=status,
                duration_ms=duration_ms,
                meta={"site": site, "events": len(chunk)},
            )
        if status in (401, 403):
            raise AdapterAuthError(
                f"Datadog rejected the credentials ({status})",
                user_message="Datadog rejected the credentials",
                status_code=status,
            )
        if status in (408, 429):
            raise AdapterRateLimitedError(
                f"Datadog intake throttled the request ({status})",
                retry_after=_parse_retry_after(response.headers.get("Retry-After")),
                status_code=status,
            )
        if status in (400, 413):
            raise AdapterPermanentError(
                f"Datadog rejected the payload ({status}): {response.text[:200]}",
                user_message=f"Datadog rejected the payload ({status})",
                status_code=status,
            )
        raise AdapterTransientError(
            f"Datadog intake returned {status}",
            status_code=status,
        )
