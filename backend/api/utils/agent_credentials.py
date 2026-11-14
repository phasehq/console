"""Resolve third-party integration credentials for Agent proxy runtimes.

Credential ciphertext remains in ``ProviderCredentials``. Only this server-side
runtime boundary decrypts it, after rechecking the persistent Workflow Grant,
Connection, session, and organisation bindings under row locks. A custom
Connection's sealed value is released here too, behind the same rechecks.
"""

from collections import OrderedDict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
import threading

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
from api.utils.access.permissions import account_can_access_workflow
from api.utils.agent_config import ConfigRegistryError
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


def resolve_postgres_connection_config(authentication):
    """Derive non-secret Connection config from a PostgreSQL credential."""

    if authentication.provider != "postgres":
        raise CredentialResolutionError(
            "PostgreSQL Connection config requires a PostgreSQL credential"
        )
    try:
        material = get_credentials(authentication.id)
    except Exception as exc:
        raise CredentialResolutionError(
            "PostgreSQL credential material could not be decrypted"
        ) from exc
    _, config = _postgres_material_and_config(material)
    return config


def resolve_postgres_encrypted_connection_config(credentials):
    """Validate an encrypted PostgreSQL form payload and return safe config."""

    if not isinstance(credentials, Mapping):
        raise CredentialResolutionError("PostgreSQL credentials must be an object")
    public_key, private_key = get_server_keypair()
    material = {}
    try:
        for field in ("username", "password", "host", "port", "database"):
            ciphertext = credentials.get(field)
            if ciphertext is not None:
                material[field] = decrypt_asymmetric(
                    ciphertext, private_key.hex(), public_key.hex()
                )
    except Exception as exc:
        raise CredentialResolutionError(
            "PostgreSQL credential material could not be decrypted"
        ) from exc
    _, config = _postgres_material_and_config(material)
    return config


def resolve_agent_credential(authentication, session, *, grant=None):
    """Decrypt one Connection's integration credential for its proxy session."""

    if grant is None:
        raise CredentialResolutionError("Credential resolution requires a Workflow Grant")

    # STS is called after the authorizing transaction releases its row locks.
    authentication, connection_config, material = _authorized_material(
        authentication, session, grant
    )

    if authentication.provider == "aws":
        required = ("access_key_id", "secret_access_key", "region")
        if any(not material.get(field) for field in required):
            raise CredentialResolutionError("AWS credentials are incomplete")
        return ResolvedCredential(
            material={field: str(material[field]) for field in required},
            generation=str(authentication.revision),
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
        # The runtime reprovisions the session before these keys lapse.
        return ResolvedCredential(
            material=resolved,
            expires_at=assumed.get("Expiration"),
            generation=str(authentication.revision),
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

    ``definition`` is the one the caller is about to hand the proxy. With
    ``sealed`` the stored ciphertext is released with the Agent's wrapped key,
    which only the Agent token's holder can open; otherwise, or when the Agent
    holds no current key copy, the server opens the value itself. Both lanes
    sit behind the rechecks that guard integration credentials.
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
    )


@transaction.atomic
def _authorized_material(authentication, session, grant):
    """Recheck every binding under row locks and decrypt the stored material."""

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

    try:
        material = get_credentials(authentication.id)
    except Exception as exc:
        raise CredentialResolutionError("Credential material could not be decrypted") from exc

    return authentication, (locked_grant.connection.config or {}), material
