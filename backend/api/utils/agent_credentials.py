"""Resolve third-party integration credentials for Agent proxy runtimes.

Only this boundary decrypts credential ciphertext, after rechecking the grant, Connection,
session and organisation bindings under row locks.
"""

from collections import OrderedDict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
import re
import threading
from urllib.parse import urlsplit

from botocore.config import Config
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from api.models import (
    Agent,
    AgentConnection,
    AgentSession,
    AgentToken,
    AgentWorkflowGrant,
)
from api.services import Providers
from api.utils.access.permissions import account_can_access_workflow
from api.utils.agent_config import ConfigRegistryError, get_config_registry
from api.utils.agent_config.http_definition import (
    HTTP_SERVICE_TYPE,
    load_definition,
)
from api.utils.agent_connection_values import (
    SealedValueError,
    open_value_with_server_copy,
    sealed_material_for_agent,
    server_key_copy_for_release,
)
from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from api.utils.syncing.auth import get_credentials
from api.utils.syncing.github.actions import GITHUB_CLOUD_API_URL


@dataclass(frozen=True)
class ResolvedCredential:
    material: dict[str, str]
    expires_at: object = None
    generation: str = ""
    # Custom Connections only. ``sealed_material`` replaces ``material`` when
    # the value is released still sealed, with the token's wrapped key share
    # the proxy needs to open it.
    revision: str = ""
    sealed_material: dict | None = None
    wrapped_key_share: str = ""
    # The Workflow Grant as it was when the release was checked, with its
    # Connection, for whatever else the session is sent beside the material.
    grant: object = None


class CredentialResolutionError(ValueError):
    pass


def _postgres_material_and_config(material):
    """Return the live PostgreSQL fields and their safe routing projection."""

    def required_text(field, *, maximum):
        value = material.get(field)
        if not isinstance(value, str) or not value.strip() or len(value) > maximum:
            raise CredentialResolutionError(
                f"PostgreSQL credential field {field!r} is missing or invalid"
            )
        if "\x00" in value:
            raise CredentialResolutionError(
                f"PostgreSQL credential field {field!r} is invalid"
            )
        return value

    username = required_text("username", maximum=256)
    password = required_text("password", maximum=8192)
    host = required_text("host", maximum=253).strip().casefold().rstrip(".")
    raw_port = material.get("port")
    if raw_port in (None, ""):
        port = 5432
    else:
        try:
            port = int(str(raw_port).strip())
        except (TypeError, ValueError) as exc:
            raise CredentialResolutionError(
                "PostgreSQL credential port must be an integer"
            ) from exc
        if not 1 <= port <= 65535:
            raise CredentialResolutionError(
                "PostgreSQL credential port must be between 1 and 65535"
            )

    config = {
        "hosts": [{"match": "exact", "value": host, "port": port}],
    }
    database = material.get("database")
    if database not in (None, ""):
        if (
            not isinstance(database, str)
            or not database.strip()
            or len(database) > 256
            or "\x00" in database
        ):
            raise CredentialResolutionError(
                "PostgreSQL credential field 'database' is invalid"
            )
        config["database"] = database

    return {"username": username, "password": password}, config


# A token provider's service manifest says which stored credential field fills
# each of its fields (``credential_fields``): the token, and any non-secret
# value the Agent sees beside it.
_MAX_TOKEN_LENGTH = 16384
_MAX_IDENTIFIER_LENGTH = 256
_CONTROL_CHARACTER = re.compile(r"[\x00-\x1f\x7f]")
# A path below which a self-hosted instance serves its API. It becomes part
# of a host rule's path pattern, so nothing a pattern reads specially.
_ENDPOINT_PATH = re.compile(r"^(?:/[A-Za-z0-9._~-]+)*$")
# An Enterprise Server's API path once /v3 is removed, below at most one
# segment: as deep as the GitHub manifest's guard paths reach.
_GITHUB_API_PATH = re.compile(r"^(?:/[^/]+)?/api$")


def _provider_name(provider):
    return Providers.get_provider_config(provider)["name"]


def _token_material(provider, service, material):
    """The live fields of a token provider's service, from its credential."""

    name = _provider_name(provider)

    def required_text(field, *, maximum):
        value = material.get(field)
        text = value.strip() if isinstance(value, str) else ""
        # Pasted tokens can carry surrounding whitespace, which is no part of
        # them and is not valid in a header.
        if not text or len(text) > maximum or _CONTROL_CHARACTER.search(text):
            raise CredentialResolutionError(
                f"{name} credential field {field!r} is missing or invalid"
            )
        return text

    # The token is checked first, so a credential missing both names it.
    ordered = sorted(
        service["credential_fields"].items(),
        key=lambda item: service["fields"][item[0]]["class"] != "secret",
    )
    return {
        service_field: required_text(
            field,
            maximum=(
                _MAX_TOKEN_LENGTH
                if service["fields"][service_field]["class"] == "secret"
                else _MAX_IDENTIFIER_LENGTH
            ),
        )
        for service_field, field in ordered
    }


def _https_endpoint(value, label):
    """The host, port and path of an HTTPS endpoint a credential names.

    The proxy never sends a credential over plain HTTP, so other endpoints are refused.
    """

    text = value.strip()
    try:
        url = urlsplit(text if "://" in text else f"https://{text}")
        port = url.port
    except ValueError as exc:
        raise CredentialResolutionError(f"{label} is not a valid URL") from exc
    if url.scheme.lower() != "https":
        raise CredentialResolutionError(
            f"{label} must be an https URL to be used by an Agent Connection"
        )
    path = url.path.rstrip("/")
    if (
        not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or not _ENDPOINT_PATH.fullmatch(path)
    ):
        raise CredentialResolutionError(
            f"{label} must be a host, with an optional port and path, to be "
            "used by an Agent Connection"
        )
    return url.hostname.lower().rstrip("."), port or 443, path


def _github_config(material):
    """Where a GitHub credential's API is: github.com's, unless the credential
    names the API of a GitHub Enterprise instance."""

    api_url = material.get("api_url")
    if not isinstance(api_url, str) or not api_url.strip():
        api_url = GITHUB_CLOUD_API_URL
    host, port, path = _https_endpoint(api_url, "The GitHub API URL of this credential")
    # An Enterprise Server serves REST below /api/v3 and GraphQL at
    # /api/graphql, so the rule covers what they share.
    path = path.removesuffix("/v3")
    if path and not _GITHUB_API_PATH.fullmatch(path):
        raise CredentialResolutionError(
            "The GitHub API URL of this credential must have no path, or end in "
            "/api/v3 with at most one path segment before it (such as "
            "https://example.com/github/api/v3), to be used by an Agent Connection"
        )
    rule = {"match": "exact", "value": host, "port": port}
    if path:
        rule["path"] = f"{path}/*"
    return {"hosts": [rule]}


def _gitlab_config(material):
    """Where a GitLab credential's API is: below /api on the instance it names."""

    gitlab_host = material.get("gitlab_host")
    if not isinstance(gitlab_host, str) or not gitlab_host.strip():
        raise CredentialResolutionError(
            "GitLab credential field 'gitlab_host' is missing or invalid"
        )
    host, port, path = _https_endpoint(
        gitlab_host, "The GitLab host of this credential"
    )
    # The GitLab manifest's guard paths reach the API at the root or below
    # one segment, so an instance served deeper is refused.
    if path.count("/") > 1:
        raise CredentialResolutionError(
            "The GitLab host of this credential must be the instance's address "
            "with at most one path segment (such as https://example.com/gitlab), "
            "to be used by an Agent Connection"
        )
    return {
        "hosts": [
            {"match": "exact", "value": host, "port": port, "path": f"{path}/api/*"}
        ]
    }


# The providers whose credential says where its service is. A Connection of
# such a provider takes its hosts from the credential, never from a member,
# and moves when the credential does.
_ENDPOINT_CONFIG = {
    "postgres": lambda material: _postgres_material_and_config(material)[1],
    "github": _github_config,
    "gitlab": _gitlab_config,
}


def credential_sets_endpoint(provider):
    """Whether Connections of this credential provider derive their config."""

    return provider in _ENDPOINT_CONFIG


def resolve_connection_config(authentication):
    """Derive non-secret Connection config from a credential that carries its
    own endpoint."""

    derive = _ENDPOINT_CONFIG.get(authentication.provider)
    if derive is None:
        raise CredentialResolutionError(
            "This credential does not say where its service is"
        )
    try:
        material = get_credentials(authentication.id)
    except Exception as exc:
        raise CredentialResolutionError(
            f"{_provider_name(authentication.provider)} credential material "
            "could not be decrypted"
        ) from exc
    return derive(material)


def resolve_encrypted_connection_config(provider, credentials):
    """Validate an encrypted credential form payload of a provider that
    carries its own endpoint, and return the Connection config it implies."""

    derive = _ENDPOINT_CONFIG.get(provider)
    if derive is None:
        raise CredentialResolutionError(
            "This credential does not say where its service is"
        )
    name = _provider_name(provider)
    if not isinstance(credentials, Mapping):
        raise CredentialResolutionError(f"{name} credentials must be an object")
    declared = Providers.get_provider_config(provider)
    public_key, private_key = get_server_keypair()
    material = {}
    try:
        for field in (
            *declared["expected_credentials"],
            *declared["optional_credentials"],
        ):
            ciphertext = credentials.get(field)
            if ciphertext is not None:
                material[field] = decrypt_asymmetric(
                    ciphertext, private_key.hex(), public_key.hex()
                )
    except Exception as exc:
        raise CredentialResolutionError(
            f"{name} credential material could not be decrypted"
        ) from exc
    return derive(material)


def resolve_agent_credential(authentication, session, *, grant=None):
    """Decrypt one Connection's integration credential for its proxy session."""

    if grant is None:
        raise CredentialResolutionError("Credential resolution requires a Workflow Grant")

    # STS is called after the authorizing transaction releases its row locks.
    authentication, locked_grant, material = _authorized_material(
        authentication, session, grant
    )
    connection_config = locked_grant.connection.config or {}

    if authentication.provider == "aws":
        required = ("access_key_id", "secret_access_key", "region")
        if any(not material.get(field) for field in required):
            raise CredentialResolutionError("AWS credentials are incomplete")
        return ResolvedCredential(
            material={field: str(material[field]) for field in required},
            generation=str(authentication.revision),
            grant=locked_grant,
        )

    if authentication.provider == "aws_assume_role":
        try:
            assumed = _assumed_role_for_session(
                material, authentication, session, grant
            )
            resolved = {
                "access_key_id": str(assumed["AccessKeyId"]),
                "secret_access_key": str(assumed["SecretAccessKey"]),
                "session_token": str(assumed["SessionToken"]),
                "region": str(material.get("region") or "us-east-1"),
            }
        except Exception as exc:
            raise CredentialResolutionError("AWS role could not be assumed") from exc
        # The call to AWS ran outside the locks, and access may have ended
        # while it did.
        locked_grant = _recheck_release(authentication, session, grant)
        # An edit committed meanwhile may name another role or account, so
        # these keys belong to a revision that is no longer the credential's.
        if str(locked_grant.connection.authentication.revision) != str(
            authentication.revision
        ):
            raise CredentialResolutionError(
                "The AWS credential changed while its role was being assumed; "
                "fetch the session configuration again to use the new one"
            )
        # The runtime reprovisions the session before these keys lapse.
        return ResolvedCredential(
            material=resolved,
            expires_at=assumed.get("Expiration"),
            generation=str(authentication.revision),
            grant=locked_grant,
        )

    if authentication.provider == "postgres":
        resolved, derived_config = _postgres_material_and_config(material)
        if connection_config != derived_config:
            raise CredentialResolutionError(
                "PostgreSQL credential routing does not match its Connection"
            )
        return ResolvedCredential(
            material=resolved,
            generation=str(authentication.revision),
            grant=locked_grant,
        )

    token_service = get_config_registry().token_service(authentication.provider)
    if token_service is not None:
        resolved = _token_material(authentication.provider, token_service, material)
        derive = _ENDPOINT_CONFIG.get(authentication.provider)
        # The token goes only to the endpoint its own credential names.
        if derive is not None and connection_config != derive(material):
            raise CredentialResolutionError(
                f"{_provider_name(authentication.provider)} credential routing "
                "does not match its Connection"
            )
        return ResolvedCredential(
            material=resolved,
            generation=str(authentication.revision),
            grant=locked_grant,
        )

    raise CredentialResolutionError(
        f"Credential provider {authentication.provider!r} is not available for Agents"
    )


# Reused per (session, grant, revision): the proxy refreshes every few seconds.
_ASSUMED_ROLES = OrderedDict()
_ASSUMED_ROLES_LOCK = threading.Lock()
_ASSUMED_ROLES_MAX_ENTRIES = 1024
_ASSUMED_ROLE_RENEWAL_MARGIN = timedelta(minutes=10)
_STS_CLIENT_CONFIG = Config(
    connect_timeout=5,
    read_timeout=10,
    retries={"max_attempts": 2, "mode": "standard"},
)


def _assumed_role_for_session(material, authentication, session, grant):
    from api.utils.syncing.aws.auth import assume_aws_role

    key = (str(session.pk), str(grant.id), str(authentication.revision))
    now = timezone.now()
    with _ASSUMED_ROLES_LOCK:
        cached = _ASSUMED_ROLES.get(key)
        if cached is not None:
            if cached["Expiration"] - now > _ASSUMED_ROLE_RENEWAL_MARGIN:
                _ASSUMED_ROLES.move_to_end(key)
                return cached
            del _ASSUMED_ROLES[key]

    assumed = assume_aws_role(
        material["role_arn"],
        material.get("region"),
        material.get("external_id"),
        role_session_name=f"phase-agent-{session.pk}",
        client_config=_STS_CLIENT_CONFIG,
    )
    if isinstance(assumed.get("Expiration"), datetime):
        with _ASSUMED_ROLES_LOCK:
            _ASSUMED_ROLES[key] = assumed
            _ASSUMED_ROLES.move_to_end(key)
            while len(_ASSUMED_ROLES) > _ASSUMED_ROLES_MAX_ENTRIES:
                _ASSUMED_ROLES.popitem(last=False)
    return assumed


def _recheck_bindings(session, grant, connection_filter):
    """Lock and recheck the token, session and Workflow Grant of a release."""

    now = timezone.now()
    locked_token = None
    if session.agent_token_id is not None:
        try:
            locked_token = (
                AgentToken.objects.select_for_update(of=("self",))
                .select_related("created_by__role")
                .filter(
                    id=session.agent_token_id,
                    workflow_id=session.workflow_id,
                    deleted_at__isnull=True,
                )
                .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
                .get()
            )
        except AgentToken.DoesNotExist as exc:
            raise CredentialResolutionError(
                "The Agent token that opened this session is no longer active"
            ) from exc
    try:
        locked_session = (
            AgentSession.objects.select_for_update(of=("self",))
            .select_related(
                "workflow__agent",
                "opened_by_member__role",
            )
            .get(
                pk=session.pk,
                organisation_id=session.organisation_id,
                workflow_id=session.workflow_id,
                revoked_at__isnull=True,
                expires_at__gt=now,
                workflow__deleted_at__isnull=True,
                workflow__agent__deleted_at__isnull=True,
                workflow__agent__status=Agent.ACTIVE,
            )
        )
        if locked_session.agent_token_id != getattr(locked_token, "id", None):
            raise AgentSession.DoesNotExist
        locked_grant = (
            AgentWorkflowGrant.objects.select_for_update(of=("self",))
            .select_related("connection__authentication")
            .active(now)
            .get(
                id=grant.id,
                organisation_id=locked_session.organisation_id,
                workflow_id=locked_session.workflow_id,
                connection__deleted_at__isnull=True,
                connection__state=AgentConnection.ACTIVE,
                **connection_filter,
            )
        )
    except (AgentSession.DoesNotExist, AgentWorkflowGrant.DoesNotExist) as exc:
        raise CredentialResolutionError(
            "Workflow Grant, Connection, authentication, or Agent session is unavailable"
        ) from exc
    return locked_token, locked_session, locked_grant


def _recheck_membership(locked_token, locked_session):
    # Membership and RBAC are live authorization state, not token/session claims.
    # Recheck immediately before decrypting so removing a user or Workflow grant
    # stops both their PAT sessions and any Agent tokens they created.
    if locked_token is not None:
        member = locked_token.created_by
    else:
        member = locked_session.opened_by_member
    if not account_can_access_workflow(
        member,
        locked_session.workflow,
        "create",
        resource="AgentSessions",
    ):
        raise CredentialResolutionError("Agent Workflow access has been revoked")


@transaction.atomic
def resolve_custom_connection(session, grant, definition, *, sealed):
    """Release a custom Connection's value to its proxy session.

    With ``sealed``, the ciphertext goes out under the Agent's wrapped key, behind the rechecks.
    """

    locked_token, locked_session, locked_grant = _recheck_bindings(
        session,
        grant,
        {
            "connection__service_type": HTTP_SERVICE_TYPE,
            "connection__organisation_id": session.organisation_id,
            "connection__authentication__isnull": True,
        },
    )
    _recheck_membership(locked_token, locked_session)

    connection_id = locked_grant.connection_id
    try:
        sealed_release = None
        if sealed and locked_token is not None and locked_token.wrapped_key_share:
            sealed_release = sealed_material_for_agent(
                connection_id, locked_session.workflow.agent_id
            )
        if sealed_release is not None:
            connection, sealed_material = sealed_release
        else:
            sealed_material = None
            server_copy = server_key_copy_for_release(connection_id)
            if server_copy is None:
                raise CredentialResolutionError(
                    "This Connection's value cannot be released to this session: "
                    "the server holds no copy of its key and the client cannot "
                    "open a sealed value"
                )
            connection = server_copy.connection
        # A change committed since the caller read the definition would pair
        # this value with hosts it was not sealed for.
        if load_definition(connection.config) != definition:
            raise CredentialResolutionError(
                "The Connection changed while its value was being released"
            )
        fields = (
            open_value_with_server_copy(server_copy, definition)
            if sealed_material is None
            else {}
        )
    except (SealedValueError, ConfigRegistryError) as exc:
        raise CredentialResolutionError(str(exc)) from exc

    return ResolvedCredential(
        material=fields,
        generation=f"{connection.key_version}.{connection.value_revision}",
        revision=str(connection.value_revision),
        sealed_material=sealed_material,
        wrapped_key_share=(
            locked_token.wrapped_key_share if sealed_material is not None else ""
        ),
        grant=locked_grant,
    )


@transaction.atomic
def _recheck_release(authentication, session, grant):
    """Recheck every binding of a release under row locks, and return the
    Workflow Grant as it is now."""

    locked_token, locked_session, locked_grant = _recheck_bindings(
        session,
        grant,
        {
            "connection__authentication_id": authentication.id,
            "connection__authentication__deleted_at__isnull": True,
        },
    )
    authentication = locked_grant.connection.authentication
    if str(authentication.organisation_id) != str(locked_session.organisation_id):
        raise CredentialResolutionError("Credential and session organisation mismatch")
    _recheck_membership(locked_token, locked_session)
    return locked_grant


@transaction.atomic
def _authorized_material(authentication, session, grant):
    """Recheck every binding under row locks and decrypt the stored material."""

    locked_grant = _recheck_release(authentication, session, grant)
    authentication = locked_grant.connection.authentication
    try:
        material = get_credentials(authentication.id)
    except Exception as exc:
        raise CredentialResolutionError("Credential material could not be decrypted") from exc

    return authentication, locked_grant, material
