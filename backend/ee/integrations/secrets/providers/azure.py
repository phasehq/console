"""Azure credential provider that rotates Microsoft Entra app registration client secrets."""

from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, NoReturn

from azure.core.exceptions import (
    AzureError,
    ClientAuthenticationError,
    ServiceRequestError,
    ServiceResponseError,
)

from api.utils.syncing.azure.auth import get_azure_client_credential

from .base import (
    ConfigSchemaField,
    CredentialProvider,
    CredentialSchemaField,
    MintResult,
    OutputSchemaField,
    ResourceOption,
)
from .exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderError,
    ProviderNotFound,
    ProviderTransientError,
)
from .http import call_summary, request
from .sanitize import excerpt

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPE = "https://graph.microsoft.com/.default"

DEFAULT_NAME_TEMPLATE = "phase-rs-{id}"
DEFAULT_SECRET_LIFETIME_DAYS = 365
# Entra caps client secret lifetimes at 24 months.
MAX_SECRET_LIFETIME_DAYS = 730

_GUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)
_ENTRA_SERVER_ERROR_RE = re.compile(r"HTTP Error: 5\d\d")
_PROVIDER_ID_SEP = ":"
_MAX_LIST_PAGES = 50

_PERMISSION_HINT = (
    "Grant Phase's app the Microsoft Graph permission Application.ReadWrite.All, "
    "or Application.ReadWrite.OwnedBy and make it an owner of the app registration."
)


def _is_guid(value: Any) -> bool:
    return isinstance(value, str) and _GUID_RE.fullmatch(value) is not None


def _encode_provider_id(application_id: str, key_id: str) -> str:
    return f"{application_id}{_PROVIDER_ID_SEP}{key_id}"


def _decode_provider_id(provider_credential_id: str) -> tuple[str, str]:
    application_id, _, key_id = str(provider_credential_id or "").partition(
        _PROVIDER_ID_SEP
    )
    if not (_is_guid(application_id) and _is_guid(key_id)):
        raise ProviderConfigError(
            f"Malformed provider credential ID: {provider_credential_id!r}",
            user_message=(
                "This credential's ID isn't in the '<application ID>:<secret ID>' "
                "format. Remove the client secret manually in Entra."
            ),
        )
    return application_id, key_id


def _application_url(application_id: str) -> str:
    return f"{GRAPH_API_BASE}/applications(appId='{application_id}')"


def _entra_unreachable(e: Exception) -> ProviderTransientError:
    return ProviderTransientError(
        f"Could not get a Microsoft Graph token: {e.__class__.__name__}",
        user_message="Could not reach Microsoft Entra ID. Will retry.",
    )


def _is_transient_token_error(e: ClientAuthenticationError) -> bool:
    # azure-identity wraps transport failures and Entra 5xx responses in this error.
    cause = e.__cause__
    if isinstance(cause, (ServiceRequestError, ServiceResponseError)):
        return True
    # MSAL reports Entra 5xx responses as "HTTP Error: <status>".
    if cause is not None and _ENTRA_SERVER_ERROR_RE.match(str(cause)):
        return True
    return (e.status_code or 0) >= 500


def _graph_token(root_creds: dict) -> str:
    try:
        credential = get_azure_client_credential(
            root_creds["tenant_id"],
            root_creds["client_id"],
            root_creds["client_secret"],
        )
        try:
            return credential.get_token(GRAPH_SCOPE).token
        finally:
            credential.close()
    except ClientAuthenticationError as e:
        if _is_transient_token_error(e):
            raise _entra_unreachable(e) from e
        message = str(e.message or "")
        secret = root_creds.get("client_secret")
        if secret:
            # Entra echoes the client ID, which may be the secret if fields were swapped.
            message = message.replace(secret, "***")
        message = excerpt(message)[:300]
        raise ProviderAuthError(
            f"Microsoft Entra token request failed: {message}",
            user_message=f"Microsoft Entra rejected Phase's app credentials: {message}",
        ) from e
    except AzureError as e:
        raise _entra_unreachable(e) from e
    except (KeyError, ValueError) as e:
        raise ProviderAuthError(
            f"Invalid Azure root credentials: {e}",
            user_message=(
                "The Azure credentials are incomplete or malformed. Check the "
                "tenant ID, client ID and client secret."
            ),
        ) from e


def _graph_headers(root_creds: dict) -> dict:
    return {"Authorization": f"Bearer {_graph_token(root_creds)}"}


def _graph_request(
    method: str,
    url: str,
    headers: dict,
    *,
    forbidden_message: str,
    **kwargs: Any,
):
    try:
        return request(method, url, headers=headers, **kwargs)
    except ProviderAuthError as e:
        # With a valid token, a 403 means a missing permission or ownership.
        if (e.raw or {}).get("status") != 403:
            raise
        raise ProviderAuthError(
            str(e), user_message=forbidden_message, raw=e.raw
        ) from e


def _json(response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _reports_missing_secret(e: ProviderError) -> bool:
    if isinstance(e, ProviderNotFound):
        return True
    body = (e.raw or {}).get("body") or ""
    return (
        isinstance(e, ProviderConfigError)
        and "no password credential found" in body.lower()
    )


def _raise_for_missing_secret(
    headers: dict, application_id: str, key_id: str, error: ProviderError
) -> NoReturn:
    # Not-found can also mean Phase lost access to the app while the secret still works.
    try:
        response = request(
            "GET",
            _application_url(application_id),
            headers=headers,
            params={"$select": "id,passwordCredentials"},
        )
    except (ProviderAuthError, ProviderNotFound) as e:
        raise ProviderAuthError(
            f"Application {application_id} is not visible to Phase: {e}",
            user_message=(
                "Phase can no longer see this app registration, so the client "
                "secret may still be valid. Restore Phase's access or remove the "
                "secret in Entra."
            ),
            raw=e.raw,
        ) from e

    body = _json(response)
    credentials = body.get("passwordCredentials") if isinstance(body, dict) else None
    if not isinstance(credentials, list):
        raise ProviderConfigError(
            "Unexpected Microsoft Graph application response",
            user_message=(
                "Microsoft Graph returned an unexpected response when checking "
                "the app's client secrets."
            ),
            raw={"call": call_summary(response)},
        )
    listed = {
        str(c.get("keyId") or "").lower() for c in credentials if isinstance(c, dict)
    }
    if key_id.lower() in listed:
        # Entra replicates directory writes with a delay, so retry instead of failing.
        raise ProviderTransientError(
            f"removePassword reported {key_id} missing but {application_id} still lists it",
            user_message=(
                "Entra reported this client secret missing but still lists it "
                "on the app. Will retry."
            ),
            raw=error.raw,
        )
    raise ProviderNotFound(
        f"Client secret {key_id} not found on application {application_id}",
        user_message="The client secret was already removed in Entra.",
        raw=error.raw,
    ) from error


def _application_id(config: dict) -> str:
    value = config.get("application_id")
    return value.strip() if isinstance(value, str) else ""


def _name_template(config: dict) -> Any:
    value = config.get("name_template")
    return DEFAULT_NAME_TEMPLATE if value is None else value


def _lifetime_days(config: dict) -> Any:
    value = config.get("secret_lifetime_days")
    return DEFAULT_SECRET_LIFETIME_DAYS if value is None else value


class AzureProvider(CredentialProvider):
    id = "azure"
    name = "Azure"
    key_name_prefix = "AZURE"
    credential_id_label = "Secret ID"

    credential_schema = [
        CredentialSchemaField(
            id="tenant_id",
            label="Tenant ID",
            required=True,
            help_text="Directory (tenant) ID of your Microsoft Entra tenant.",
        ),
        CredentialSchemaField(
            id="client_id",
            label="Client ID",
            required=True,
            help_text=(
                "Application (client) ID of the app registration Phase signs in "
                "as. To rotate client secrets it needs the Microsoft Graph "
                "application permission Application.ReadWrite.OwnedBy (and must "
                "be an owner of each app it rotates) or Application.ReadWrite.All, "
                "with admin consent."
            ),
        ),
        CredentialSchemaField(
            id="client_secret",
            label="Client Secret",
            required=True,
            masked=True,
            help_text=(
                "A client secret of that app registration. Paste the secret "
                "value, not the secret ID."
            ),
        ),
    ]

    config_schema = [
        ConfigSchemaField(
            id="application_id",
            label="App registration",
            required=True,
            resource_type="entra_application",
            help_text=(
                "The app registration whose client secrets Phase rotates, by "
                "Application (client) ID. It can differ from the app Phase signs "
                "in as. New secrets can take a few minutes to replicate in Entra, "
                "so set a revocation delay of at least a few minutes."
            ),
        ),
        ConfigSchemaField(
            id="name_template",
            label="Secret Description Template",
            required=False,
            default=DEFAULT_NAME_TEMPLATE,
            help_text=(
                "A template for the client secret's description in Entra. {id} "
                "is replaced with the caller ID and a timestamp."
            ),
        ),
        ConfigSchemaField(
            id="secret_lifetime_days",
            label="Secret Lifetime (days)",
            required=False,
            field_type="int",
            default=DEFAULT_SECRET_LIFETIME_DAYS,
            help_text=(
                f"Days until each client secret expires in Entra (1-"
                f"{MAX_SECRET_LIFETIME_DAYS}). Keep it longer than the rotation "
                "interval plus the revocation delay. Your tenant's app management "
                "policy may enforce a lower limit."
            ),
        ),
    ]

    # Identifiers first, secret last, so the sensitive value sits at the bottom of UIs.
    output_schema = [
        OutputSchemaField(
            id="tenant_id",
            label="Tenant ID",
            masked=False,
            help_text="The Entra tenant to authenticate against.",
        ),
        OutputSchemaField(
            id="client_id",
            label="Client ID",
            masked=False,
            help_text="The Application (client) ID of the rotated app registration.",
        ),
        OutputSchemaField(
            id="secret_id",
            label="Secret ID",
            masked=False,
            help_text="The Entra-side ID of the client secret, used for revocation.",
        ),
        OutputSchemaField(
            id="client_secret",
            label="Client Secret",
            masked=True,
            help_text="The client secret value consumers use to authenticate.",
        ),
    ]

    @classmethod
    def validate_config(cls, config: dict) -> None:
        if not _is_guid(_application_id(config)):
            raise ProviderConfigError(
                "application_id must be a GUID",
                user_message=(
                    "Pick an app registration or enter its Application (client) "
                    "ID, a GUID."
                ),
            )
        template = _name_template(config)
        if not isinstance(template, str) or "{id}" not in template:
            raise ProviderConfigError(
                "name_template must be a string containing '{id}'",
                user_message="Secret description template must include {id}.",
            )
        try:
            template.format(id="")
        except (AttributeError, IndexError, KeyError, ValueError) as e:
            raise ProviderConfigError(
                f"Invalid name_template: {e}",
                user_message=(
                    "Secret description template can only use the {id} placeholder."
                ),
            ) from e
        days = _lifetime_days(config)
        if (
            isinstance(days, bool)
            or not isinstance(days, int)
            or not 1 <= days <= MAX_SECRET_LIFETIME_DAYS
        ):
            raise ProviderConfigError(
                f"secret_lifetime_days must be an integer from 1 to {MAX_SECRET_LIFETIME_DAYS}",
                user_message=(
                    "Secret lifetime must be a whole number of days from 1 to "
                    f"{MAX_SECRET_LIFETIME_DAYS}."
                ),
            )

    @classmethod
    def validate_root_credentials(cls, root_creds: dict) -> bool:
        # A token needs no Graph permissions, so Key Vault sync credentials pass too.
        try:
            _graph_token(root_creds)
        except Exception:
            return False
        return True

    @classmethod
    def list_resources(
        cls,
        root_creds: dict,
        resource_type: str,
        config: dict | None = None,
    ) -> list[ResourceOption]:
        if resource_type != "entra_application":
            return super().list_resources(root_creds, resource_type, config)

        headers = _graph_headers(root_creds)
        url = f"{GRAPH_API_BASE}/applications"
        params: dict | None = {"$select": "id,appId,displayName", "$top": 100}
        options: list[ResourceOption] = []
        # Hard ceiling on pagination so a misbehaving server can't loop forever.
        for _ in range(_MAX_LIST_PAGES):
            response = _graph_request(
                "GET",
                url,
                headers,
                params=params,
                forbidden_message=(
                    "Phase's app needs the Microsoft Graph permission "
                    "Application.ReadWrite.OwnedBy or Application.ReadWrite.All "
                    "to list app registrations."
                ),
            )
            body = _json(response)
            apps = body.get("value") if isinstance(body, dict) else None
            if not isinstance(apps, list):
                raise ProviderConfigError(
                    "Unexpected Microsoft Graph applications list response",
                    user_message=(
                        "Microsoft Graph returned an unexpected response when "
                        "listing app registrations."
                    ),
                    raw={"call": call_summary(response)},
                )
            for app in apps:
                app_id = app.get("appId") if isinstance(app, dict) else None
                if not app_id or not isinstance(app_id, str):
                    continue
                options.append(
                    ResourceOption(
                        id=app_id,
                        name=str(app.get("displayName") or app_id),
                        description=app_id,
                    )
                )
            next_link = body.get("@odata.nextLink")
            # Only follow Graph links so the bearer token never leaves Graph.
            if not isinstance(next_link, str) or not next_link.startswith(
                f"{GRAPH_API_BASE}/"
            ):
                break
            url, params = next_link, None
        return sorted(options, key=lambda o: o.name.lower())

    @classmethod
    def mint(
        cls,
        root_creds: dict,
        config: dict,
        *,
        caller_id: str,
    ) -> MintResult:
        cls.validate_config(config)
        application_id = _application_id(config)
        name = _name_template(config).format(id=f"{caller_id}-{int(time.time())}")
        end_date_time = (
            datetime.now(timezone.utc) + timedelta(days=_lifetime_days(config))
        ).strftime("%Y-%m-%dT%H:%M:%SZ")

        headers = _graph_headers(root_creds)
        try:
            response = _graph_request(
                "POST",
                f"{_application_url(application_id)}/addPassword",
                headers,
                json={
                    "passwordCredential": {
                        "displayName": name,
                        "endDateTime": end_date_time,
                    }
                },
                forbidden_message=(
                    "Phase can't add client secrets to this app registration. "
                    f"{_PERMISSION_HINT}"
                ),
            )
        except ProviderNotFound as e:
            raise ProviderConfigError(
                str(e),
                user_message=(
                    "App registration not found. Check the Application (client) "
                    "ID and that the app is in the same tenant as Phase's app."
                ),
                raw=e.raw,
            ) from e

        body = _json(response)
        key_id = body.get("keyId") if isinstance(body, dict) else None
        secret_text = body.get("secretText") if isinstance(body, dict) else None
        if not _is_guid(key_id) or not isinstance(secret_text, str) or not secret_text:
            raise ProviderConfigError(
                "Unexpected Microsoft Graph addPassword response",
                user_message=(
                    "Microsoft Graph returned an unexpected response when adding "
                    "the client secret."
                ),
                # Never echo the body: it can contain secretText.
                raw={
                    "call": call_summary(response),
                    "key_id": key_id if _is_guid(key_id) else None,
                    "fields": sorted(body) if isinstance(body, dict) else None,
                },
            )

        returned_end = body.get("endDateTime")
        return MintResult(
            provider_credential_id=_encode_provider_id(application_id, key_id),
            values={
                "tenant_id": root_creds["tenant_id"],
                "client_id": application_id,
                "secret_id": key_id,
                "client_secret": secret_text,
            },
            metadata={
                "display_name": name,
                "end_date_time": (
                    returned_end if isinstance(returned_end, str) else end_date_time
                ),
                "application_id": application_id,
                "display_id": key_id,
                "call": call_summary(response),
            },
        )

    @classmethod
    def revoke(cls, root_creds: dict, provider_credential_id: str) -> dict | None:
        application_id, key_id = _decode_provider_id(provider_credential_id)
        headers = _graph_headers(root_creds)
        try:
            response = _graph_request(
                "POST",
                f"{_application_url(application_id)}/removePassword",
                headers,
                json={"keyId": key_id},
                forbidden_message=(
                    "Phase can't remove this client secret, so it may still be "
                    f"valid. {_PERMISSION_HINT} Or remove the secret in Entra."
                ),
            )
        except ProviderError as e:
            if not _reports_missing_secret(e):
                raise
            _raise_for_missing_secret(headers, application_id, key_id, e)
        return {
            "application_id": application_id,
            "key_id": key_id,
            "call": call_summary(response),
        }
