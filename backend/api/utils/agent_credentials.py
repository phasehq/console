"""Resolve third-party integration credentials for Agent proxy runtimes.

Credential ciphertext remains in ``ProviderCredentials``. Only this server-side
runtime boundary decrypts it, after rechecking the persistent Workflow Grant,
Connection, session, and organisation bindings under row locks.
"""

from collections.abc import Mapping
from dataclasses import dataclass

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
from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from api.utils.syncing.auth import get_credentials


@dataclass(frozen=True)
class ResolvedCredential:
    material: dict[str, str]
    expires_at: object = None
    generation: str = ""


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

    _, config = resolve_postgres_encrypted_identity_and_config(credentials)
    return config


def resolve_postgres_encrypted_identity_and_config(credentials):
    """Return the safe identity/routing projection of an encrypted form."""

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
    runtime_material, config = _postgres_material_and_config(material)
    return runtime_material["username"], config


@transaction.atomic
def resolve_agent_credential(authentication, session, *, grant=None):
    """Decrypt one Connection's integration credential for its proxy session."""

    if grant is None:
        raise CredentialResolutionError("Credential resolution requires a Workflow Grant")

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
            .get(
                id=grant.id,
                organisation_id=locked_session.organisation_id,
                workflow_id=locked_session.workflow_id,
                deleted_at__isnull=True,
                connection__deleted_at__isnull=True,
                connection__state=AgentConnection.ACTIVE,
                connection__authentication_id=authentication.id,
                connection__authentication__deleted_at__isnull=True,
            )
        )
    except (AgentSession.DoesNotExist, AgentWorkflowGrant.DoesNotExist) as exc:
        raise CredentialResolutionError(
            "Workflow Grant, Connection, authentication, or Agent session is unavailable"
        ) from exc

    authentication = locked_grant.connection.authentication
    if str(authentication.organisation_id) != str(locked_session.organisation_id):
        raise CredentialResolutionError("Credential and session organisation mismatch")

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

    try:
        material = get_credentials(authentication.id)
    except Exception as exc:
        raise CredentialResolutionError("Credential material could not be decrypted") from exc

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
            from api.utils.syncing.aws.auth import get_aws_sts_session

            assumed = get_aws_sts_session(
                material["role_arn"],
                material.get("region"),
                material.get("external_id"),
            )
            provider_credentials = assumed.get_credentials()
            frozen = provider_credentials.get_frozen_credentials()
        except Exception as exc:
            raise CredentialResolutionError("AWS role could not be assumed") from exc
        resolved = {
            "access_key_id": frozen.access_key,
            "secret_access_key": frozen.secret_key,
            "session_token": frozen.token,
            "region": str(material.get("region") or "us-east-1"),
        }
        return ResolvedCredential(
            material=resolved,
            expires_at=getattr(provider_credentials, "_expiry_time", None),
            generation=str(authentication.revision),
        )

    if authentication.provider == "postgres":
        resolved, derived_config = _postgres_material_and_config(material)
        if (locked_grant.connection.config or {}) != derived_config:
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
