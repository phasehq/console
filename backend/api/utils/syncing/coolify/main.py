import re
import time
from urllib.parse import quote

import requests
import graphene
from django.conf import settings
from django.core.exceptions import ValidationError
from graphene import ObjectType
from api.utils.network import validate_url_is_safe
from api.utils.syncing.auth import get_credentials

# Some Coolify instances sit behind Cloudflare, which rejects requests that
# carry the default python-requests User-Agent with a 403.
COOLIFY_USER_AGENT = "Phase-Console-Sync"

# Coolify uses this prefix for its own magic variables (SERVICE_FQDN_* etc).
# Phase keys with it are skipped, and Coolify variables with it are kept.
COOLIFY_RESERVED_PREFIX = "SERVICE_"

# Coolify rejects any other key with a validation error.
COOLIFY_KEY_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*")

# Coolify resource ids are cuid2 strings.
COOLIFY_UUID_PATTERN = re.compile(r"[a-z0-9]+")

REQUEST_TIMEOUT = (5, 30)
INTERACTIVE_REQUEST_TIMEOUT = (5, 15)

# Coolify allows 200 API requests per minute by default.
MAX_RATE_LIMIT_RETRIES = 3
MAX_RETRY_AFTER_SECONDS = 30

MAX_REPORTED_ITEMS = 10


class CoolifyApplicationType(ObjectType):
    id = graphene.ID(required=True)
    name = graphene.String(required=True)
    fqdn = graphene.String()


class CoolifyError(Exception):
    pass


def normalize_coolify_url(url):
    """Return the API base URL, accepting the instance URL with or without
    scheme, trailing slash or /api/v1."""
    url = str(url or "").strip().rstrip("/")
    if not url:
        raise CoolifyError("No Coolify URL provided")
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    if url.endswith("/api/v1"):
        url = url[: -len("/api/v1")]
    elif url.endswith("/api"):
        url = url[: -len("/api")]
    return f"{url.rstrip('/')}/api/v1"


def validate_coolify_uuid(value):
    if not isinstance(value, str) or not COOLIFY_UUID_PATTERN.fullmatch(value):
        raise CoolifyError("Invalid Coolify application id")
    return value


def get_coolify_headers(api_token):
    return {
        "Authorization": f"Bearer {api_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": COOLIFY_USER_AGENT,
    }


def get_coolify_api_config(credential_id):
    credentials = get_credentials(credential_id)
    base_url = normalize_coolify_url(credentials.get("coolify_url"))
    if settings.APP_HOST == "cloud":
        try:
            validate_url_is_safe(base_url)
        except ValidationError as e:
            raise CoolifyError(" ".join(e.messages))
    headers = get_coolify_headers(credentials.get("api_token"))
    return base_url, headers


def coolify_request(method, url, headers, timeout=REQUEST_TIMEOUT, **kwargs):
    """Send a request, waiting and retrying when Coolify rate limits it."""
    for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
        response = requests.request(
            method,
            url,
            headers=headers,
            timeout=timeout,
            allow_redirects=False,
            **kwargs,
        )
        if response.status_code != 429 or attempt == MAX_RATE_LIMIT_RETRIES:
            return response
        try:
            delay = int(response.headers.get("Retry-After", ""))
        except ValueError:
            delay = 2**attempt
        time.sleep(min(max(delay, 1), MAX_RETRY_AFTER_SECONDS))


def coolify_error_message(response):
    """Coolify's own error message, without echoing the raw response body."""
    if 300 <= response.status_code < 400:
        return "Coolify redirected the request. Check the Coolify URL."
    if response.status_code == 429:
        return "Coolify rate limit exceeded. Try again in a minute."

    message = None
    try:
        body = response.json()
        if isinstance(body, dict):
            message = body.get("message")
            errors = body.get("errors")
            if isinstance(errors, dict) and errors:
                details = "; ".join(
                    f"{field}: {', '.join(map(str, msgs)) if isinstance(msgs, list) else msgs}"
                    for field, msgs in errors.items()
                )
                message = f"{message} {details}" if message else details
    except ValueError:
        pass

    if message and "api is disabled" in str(message).lower():
        return (
            "The Coolify API is disabled. Enable API access in your Coolify "
            "instance settings, then try again."
        )
    if response.status_code == 401:
        return "Coolify rejected the API token. Check that it is valid."
    if response.status_code == 403:
        return f"Coolify denied access{f': {message}' if message else ''}. Check the token's permissions."
    if response.status_code == 404:
        return "The Coolify application was not found. It may have been deleted."
    return f"{message or 'Unexpected response'} (HTTP {response.status_code})"


def _format_names(names):
    shown = ", ".join(names[:MAX_REPORTED_ITEMS])
    if len(names) > MAX_REPORTED_ITEMS:
        shown += f" and {len(names) - MAX_REPORTED_ITEMS} more"
    return shown


def list_coolify_applications(credential_id):
    base_url, headers = get_coolify_api_config(credential_id)

    response = coolify_request(
        "GET",
        f"{base_url}/applications",
        headers,
        timeout=INTERACTIVE_REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise CoolifyError(coolify_error_message(response))

    return [
        {
            "id": application["uuid"],
            "name": application["name"],
            "fqdn": application.get("fqdn"),
        }
        for application in response.json()
    ]


def is_managed_by_phase(env):
    """Whether a Coolify variable is one a sync may overwrite or delete."""
    return not (
        env.get("is_coolify")
        or env.get("is_buildpack_control")
        or env["key"].startswith(COOLIFY_RESERVED_PREFIX)
    )


def build_coolify_env_payload(secrets, scopes, existing):
    """Build the bulk upsert payload.

    is_literal stops "$VAR" interpolation, but Coolify still resolves
    {{environment.X}} / {{team.X}} shared variable references. is_shown_once is
    sent back as Coolify has it, because the bulk endpoint resets it otherwise.
    """
    payload = []
    for is_preview in scopes:
        for key, value, _ in secrets:
            current = existing.get((key, is_preview), {})
            payload.append(
                {
                    "key": key,
                    "value": value,
                    "is_preview": is_preview,
                    "is_literal": True,
                    "is_multiline": "\n" in value,
                    "is_shown_once": bool(current.get("is_shown_once", False)),
                }
            )
    return payload


def sync_coolify_secrets(secrets, credential_id, application_uuid, sync_preview=False):
    """Make a Coolify application's variables match Phase, deleting the ones
    Phase doesn't have. Coolify trims values and stores "" as null. The
    application is not redeployed."""
    try:
        validate_coolify_uuid(application_uuid)
        base_url, headers = get_coolify_api_config(credential_id)
        envs_url = f"{base_url}/applications/{quote(application_uuid, safe='')}/envs"

        skipped_keys = sorted(
            key for key, _, _ in secrets if key.startswith(COOLIFY_RESERVED_PREFIX)
        )
        secrets = [s for s in secrets if not s[0].startswith(COOLIFY_RESERVED_PREFIX)]

        # The bulk endpoint saves one variable at a time and stops at the first
        # invalid key, so catch those before anything is written.
        invalid_keys = sorted(
            key for key, _, _ in secrets if not COOLIFY_KEY_PATTERN.fullmatch(key)
        )
        if invalid_keys:
            return False, {
                "message": (
                    "Nothing was synced. Coolify variable names must start with a "
                    "letter or underscore and contain only letters, numbers, "
                    f"underscores and dots. Rename: {_format_names(invalid_keys)}"
                )
            }

        response = coolify_request("GET", envs_url, headers)
        if response.status_code != 200:
            return False, {
                "response_code": response.status_code,
                "message": f"Error fetching Coolify environment variables: {coolify_error_message(response)}",
            }

        scopes = [False, True] if sync_preview else [False]
        envs = [env for env in response.json() if bool(env.get("is_preview")) in scopes]
        existing = {(env["key"], bool(env.get("is_preview"))): env for env in envs}
        managed_envs = [env for env in envs if is_managed_by_phase(env)]

        phase_keys = {key for key, _, _ in secrets}
        envs_to_delete = [env for env in managed_envs if env["key"] not in phase_keys]

        # An empty source is almost always a wrong path; don't wipe the app.
        if not secrets and envs_to_delete:
            return False, {
                "message": (
                    "Nothing was synced. There are no secrets in this environment "
                    f"and path, and syncing would delete {len(envs_to_delete)} "
                    "Coolify variable(s). Check the path, or remove the variables "
                    "in Coolify first."
                )
            }

        payload = build_coolify_env_payload(secrets, scopes, existing)
        if payload:
            upsert_response = coolify_request(
                "PATCH", f"{envs_url}/bulk", headers, json={"data": payload}
            )
            if upsert_response.status_code not in [200, 201]:
                return False, {
                    "response_code": upsert_response.status_code,
                    "message": f"Error syncing secrets: {coolify_error_message(upsert_response)}",
                }

        for env in envs_to_delete:
            delete_response = coolify_request(
                "DELETE", f"{envs_url}/{quote(env['uuid'], safe='')}", headers
            )
            # 404: already gone, nothing left to do
            if delete_response.status_code not in [200, 204, 404]:
                return False, {
                    "response_code": delete_response.status_code,
                    "message": f"Error deleting Coolify environment variable {env['key']}: {coolify_error_message(delete_response)}",
                }

        message = "Successfully synced secrets."
        if skipped_keys:
            message += (
                f" Skipped keys reserved by Coolify: {_format_names(skipped_keys)}."
            )

        return True, {"response_code": 200, "message": message}

    except requests.RequestException as e:
        return False, {"message": f"HTTP request error: {str(e)}"}
    except Exception as e:
        return False, {"message": f"An unexpected error occurred: {str(e)}"}
