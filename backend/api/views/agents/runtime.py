"""Build the per-Connection configuration an Agent proxy session receives."""

from collections import Counter
from copy import deepcopy
import re
from uuid import uuid4

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.models import (
    AgentDecoy,
    AgentEvent,
    AgentConnection,
    AgentSession,
    AgentWorkflowGrant,
)
from api.utils.agent_credentials import (
    CredentialResolutionError,
    resolve_agent_credential,
)
from api.utils.agent_sessions import create_decoy
from api.utils.agent_config import (
    ConfigCompatibilityError,
    ConfigRegistryError,
    get_config_registry,
    host_rules_require_independent_approval,
)
from api.views.agents.base import AgentRuntimeError, SCHEMA_VERSION


_RUNTIME_SNAPSHOT_VERSION = 1


def _normalise_material_key(value):
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def _material_value(material, field):
    if field in material:
        return str(material[field])
    wanted = _normalise_material_key(field)
    for key, value in material.items():
        if _normalise_material_key(key) == wanted:
            return str(value)
    return None


def connection_authorization(grant):
    """Return the authorization block the proxy receives for one Grant."""

    connection = grant.connection
    active = bool(
        grant.deleted_at is None
        and grant.workflow.deleted_at is None
        and grant.workflow.agent.deleted_at is None
        and grant.workflow.agent.status == grant.workflow.agent.ACTIVE
        and connection.deleted_at is None
        and connection.state == AgentConnection.ACTIVE
        and connection.authentication_id
        and connection.authentication.deleted_at is None
    )
    return {
        "version": 1,
        "mode": "connection",
        "access_mode": "allow" if active else "deny",
        "state": "allowed" if active else "denied",
        "approval": None,
    }


def connection_host_rules_are_approved(connection, service):
    """A custom host override needs approval from someone other than its author."""

    if not host_rules_require_independent_approval(
        service, connection.config or {}
    ):
        return True
    return bool(
        connection.host_rules_authored_by_id
        and connection.host_rules_approved_by_id
        and str(connection.host_rules_version)
        == str(connection.host_rules_approved_version)
        and connection.host_rules_authored_by.user_id
        != connection.host_rules_approved_by.user_id
    )


def _workflow_config_env(connections):
    """Settings such as AWS_REGION from services with a single Connection.

    With several Connections for one service, each command picks one, so no
    workflow-wide default exists.
    """

    counts = Counter(connection["service_type"] for connection in connections)
    config_env = {}
    for connection in connections:
        if counts[connection["service_type"]] == 1:
            config_env.update(connection["config_env"])
    return config_env


# A CLI that doesn't list the environment-binding sources it supports is
# assumed to support the four that schema 1 shipped with. Any newer source must
# be listed, so an older CLI is refused when the session opens rather than
# failing partway through it.
BASELINE_ENVIRONMENT_BINDING_SOURCES = frozenset(
    {"connection_config", "decoy", "identifier", "runtime"}
)


def negotiate_client(client, prepared_grants):
    if not isinstance(client, dict):
        raise AgentRuntimeError("invalid_client", "client must be an object.")
    versions = client.get("supported_schema_versions")
    if versions is None:
        versions = client.get("supportedSchemaVersions")
    if not isinstance(versions, list) or SCHEMA_VERSION not in versions:
        raise AgentRuntimeError(
            "unsupported_schema_version",
            "The client does not advertise Agent schemaVersion 1.",
            details={"supported": [SCHEMA_VERSION]},
        )
    protocols = set(client.get("protocols") or [])
    actions = set(
        client.get("injection_actions")
        or client.get("injectionActions")
        or []
    )
    declared_sources = (
        client.get("environment_binding_sources")
        or client.get("environmentBindingSources")
    )
    sources = (
        set(declared_sources)
        if isinstance(declared_sources, list)
        else set(BASELINE_ENVIRONMENT_BINDING_SOURCES)
    )
    required_protocols = {item["service"]["protocol"] for item in prepared_grants}
    required_actions = {
        item["service"]["injection"]["action"] for item in prepared_grants
    }
    required_sources = {
        binding["source"]
        for item in prepared_grants
        for binding in item["service"]["environment_bindings"]
    }
    missing_protocols = sorted(required_protocols - protocols)
    missing_actions = sorted(required_actions - actions)
    missing_sources = sorted(required_sources - sources)
    if missing_protocols or missing_actions or missing_sources:
        raise AgentRuntimeError(
            "client_capability_mismatch",
            "The client cannot enforce every Workflow connection.",
            details={
                "missingProtocols": missing_protocols,
                "missingInjectionActions": missing_actions,
                "missingEnvironmentBindingSources": missing_sources,
            },
        )


def reject_duplicate_connections(prepared):
    """A Workflow may grant each Connection only once."""

    ids = [str(item["grant"].connection_id) for item in prepared]
    if len(ids) != len(set(ids)):
        raise AgentRuntimeError(
            "ambiguous_workflow_bindings", "Duplicate Connection grant"
        )


def prepare_workflow(workflow, *, service_type=None):
    registry = get_config_registry()
    grants_query = (
        workflow.grants.select_related(
            "created_by",
            "workflow__agent",
            "connection__authentication",
            "connection__host_rules_authored_by",
            "connection__host_rules_approved_by",
        )
        .filter(
            deleted_at__isnull=True,
            connection__deleted_at__isnull=True,
            connection__state=AgentConnection.ACTIVE,
            connection__authentication__deleted_at__isnull=True,
        )
        .order_by("created_at", "id")
    )
    if service_type is not None:
        grants_query = grants_query.filter(connection__service_type=service_type)
    grants = list(grants_query)
    prepared = []
    for grant in grants:
        connection = grant.connection
        authentication = connection.authentication
        if (
            str(grant.organisation_id) != str(workflow.organisation_id)
            or str(connection.organisation_id) != str(workflow.organisation_id)
            or str(authentication.organisation_id) != str(workflow.organisation_id)
        ):
            raise AgentRuntimeError(
                "invalid_workflow_grant",
                "A Workflow Grant crosses an organisation or service boundary.",
            )
        try:
            service = registry.get_service(connection.service_type)
            allowed_providers = set(service.get("credential_providers") or [])
            if authentication.provider not in allowed_providers:
                raise ConfigCompatibilityError(
                    "Credential provider is incompatible with the service"
                )
            hosts = registry.resolve_host_rules(
                connection.service_type, connection.config or {}
            )
        except (ConfigRegistryError, ConfigCompatibilityError) as exc:
            raise AgentRuntimeError(
                "invalid_workflow_configuration", str(exc)
            ) from exc
        if not connection_host_rules_are_approved(connection, service):
            raise AgentRuntimeError(
                "host_rule_approval_required",
                "This Connection's custom host override needs independent approval.",
            )
        prepared.append(
            {
                "grant": grant,
                "service": service,
                "hosts": hosts,
                "authorization": connection_authorization(grant),
            }
        )
    reject_duplicate_connections(prepared)
    return prepared


def _decoy_for(session, authentication, field, format_string, *, grant):
    existing = AgentDecoy.objects.filter(
        session=session, grant=grant, field_name=field
    ).first()
    if existing is not None:
        return existing.decoy_value
    return create_decoy(
        session=session,
        authentication=authentication,
        field_name=field,
        kind=field,
        format_string=format_string,
        grant=grant,
    ).decoy_value


def _existing_decoy_for(session, field, *, grant):
    """Read an already-issued decoy without resolving credential material."""

    decoy = AgentDecoy.objects.filter(
        session=session, grant=grant, field_name=field
    ).first()
    return decoy.decoy_value if decoy is not None else None


def _saved_runtime_for(session, grant, credential):
    """What the session saved for this Grant when it opened, if still current."""

    snapshot = session.runtime_snapshot or {}
    if (
        not isinstance(snapshot, dict)
        or snapshot.get("version") != _RUNTIME_SNAPSHOT_VERSION
    ):
        return {}
    connections = snapshot.get("connections", {})
    if not isinstance(connections, dict):
        return {}
    saved = connections.get(str(grant.id), {})
    if not isinstance(saved, dict):
        return {}
    expected = {
        "connection_id": str(grant.connection_id),
        "credential_id": str(credential.id),
        "credential_revision": str(credential.revision),
    }
    if any(str(saved.get(key, "")) != value for key, value in expected.items()):
        return {}
    return saved


def _snapshot_expiry(value):
    if value is None:
        return None
    isoformat = getattr(value, "isoformat", None)
    return isoformat() if callable(isoformat) else str(value)


def _resolve_environment_bindings(
    service,
    connection_config,
    identifiers,
    decoy_material,
):
    """Keep the service's environment bindings that apply to this Connection."""

    resolved = []
    for template in service["environment_bindings"]:
        binding = deepcopy(template)
        source = binding["source"]
        source_field = binding["source_field"]
        if binding["action"] == "unset":
            # Only remove the user's own provider variables when a decoy
            # replaces them.
            if source_field not in decoy_material:
                continue
            resolved.append(binding)
            continue
        if source == "identifier":
            value = identifiers.get(source_field)
        elif source == "decoy":
            value = decoy_material.get(source_field)
        elif source == "connection_config":
            value = (connection_config or {}).get(source_field)
        else:  # The registry rejects other sources; fail closed anyway.
            raise AgentRuntimeError(
                "invalid_environment_binding",
                "A service contains an unsupported process environment binding.",
            )
        if value is None:
            continue
        resolved.append(binding)
    return resolved


def _connection_payload(
    item,
    session,
    *,
    include_secrets=True,
):
    grant = item["grant"]
    service = item["service"]
    connection = grant.connection
    credential = connection.authentication
    authorization = connection_authorization(grant)
    authorization_allowed = authorization["state"] == "allowed"
    should_resolve = include_secrets and authorization_allowed
    saved_runtime = (
        _saved_runtime_for(session, grant, credential)
        if not include_secrets and authorization_allowed
        else {}
    )
    material = {}
    runtime_config = deepcopy(connection.config or {})
    saved_config = saved_runtime.get("connection_config")
    if isinstance(saved_config, dict):
        # On rediscovery, restore only the settings that become environment
        # variables; everything else comes from the Connection as it is now.
        for binding in service["environment_bindings"]:
            source_field = binding["source_field"]
            if (
                binding["action"] == "set"
                and binding["source"] == "connection_config"
                and source_field in saved_config
            ):
                runtime_config[source_field] = deepcopy(saved_config[source_field])
    resolved = None
    if should_resolve:
        try:
            resolved = resolve_agent_credential(credential, session, grant=grant)
        except CredentialResolutionError as exc:
            # The proxy never sees this failure, so record it in the activity
            # log here.
            try:
                AgentEvent.objects.create(
                    event_id=f"server-credential-error-{uuid4()}",
                    organisation=session.organisation,
                    agent=session.agent,
                    workflow=session.workflow,
                    connection=grant.connection,
                    session=session,
                    proxy_created_at=timezone.now(),
                    event_type="credential_resolution_error",
                    protocol=service["protocol"],
                    host="",
                    provider=service["service_type"],
                    proxy_decision=AgentEvent.ERROR,
                    outcome="error",
                    credential_action=credential.provider,
                    reason="credential_resolution_failed",
                    detail={"credential_id": str(credential.id)},
                )
            except Exception:
                # A logging failure must never hide the real error.
                pass
            raise AgentRuntimeError(
                "credential_resolution_failed",
                f"Credential {credential.id} could not be resolved.",
                details={"credentialId": str(credential.id), "reason": str(exc)},
            ) from exc

        for field in service["fields"]:
            value = _material_value(resolved.material, field)
            if value is not None:
                material[field] = value
        region = _material_value(resolved.material, "region")
        if region:
            runtime_config["region"] = region
        source = service["injection"]["value_from"]
        required_fields = (
            [source["field"]]
            if "field" in source
            else [
                field
                for role, field in source.get("fields", {}).items()
                if role != "session_token"
            ]
        )
        missing = [
            field for field in required_fields if not material.get(field, "").strip()
        ]
        if missing:
            raise AgentRuntimeError(
                "credential_fields_missing",
                "Resolved credential material is missing required service fields.",
                details={
                    "credentialId": str(credential.id),
                    "fields": sorted(missing),
                },
            )

    identifiers = {}
    if not include_secrets and authorization_allowed:
        saved_identifiers = saved_runtime.get("identifiers", {})
        if isinstance(saved_identifiers, dict):
            identifiers = {
                field: str(saved_identifiers[field])
                for field, definition in service["fields"].items()
                if definition["class"] == "identifier"
                and saved_identifiers.get(field) is not None
            }
    decoy_material = {}
    process_decoy_fields = {
        binding["source_field"]
        for binding in service["environment_bindings"]
        if binding["action"] == "set" and binding["source"] == "decoy"
    }
    for field, definition in service["fields"].items():
        if definition["class"] == "identifier":
            # The live AWS key ID stays with the proxy; the agent sees a decoy.
            if service["service_type"] == "aws" and field == "access_key_id":
                if should_resolve:
                    value = _decoy_for(
                        session,
                        credential,
                        field,
                        service["decoy_format"][field],
                        grant=grant,
                    )
                elif not include_secrets and authorization_allowed:
                    value = _existing_decoy_for(session, field, grant=grant)
                else:
                    value = None
                if value is not None:
                    identifiers[field] = value
                continue
            value = material.get(field)
            if value is None:
                continue
            identifiers[field] = value
            continue
        if should_resolve and (
            field in material or field in process_decoy_fields
        ):
            decoy = _decoy_for(
                session,
                credential,
                field,
                service["decoy_format"][field],
                grant=grant,
            )
        elif not include_secrets and authorization_allowed:
            decoy = _existing_decoy_for(session, field, grant=grant)
        else:
            decoy = None
        if decoy is None:
            continue
        decoy_material[field] = decoy

    environment_bindings = _resolve_environment_bindings(
        service,
        runtime_config,
        identifiers,
        decoy_material,
    )
    # agentEnv carries only identifiers and decoys; connection-config values
    # belong to configEnv. The CLI's process-environment compiler requires the
    # two maps to stay disjoint.
    agent_env = {}
    for binding in environment_bindings:
        if binding["action"] != "set":
            continue
        source_field = binding["source_field"]
        if binding["source"] == "identifier":
            agent_env[binding["name"]] = identifiers[source_field]
        elif binding["source"] == "decoy":
            agent_env[binding["name"]] = decoy_material[source_field]

    generation = resolved.generation if resolved else str(credential.revision)
    credential_expiry = resolved.expires_at if resolved else None
    if resolved is None and saved_runtime:
        saved_generation = saved_runtime.get("material_generation")
        if isinstance(saved_generation, str) and saved_generation:
            generation = saved_generation
        saved_expiry = saved_runtime.get("credential_expires_at")
        if isinstance(saved_expiry, str):
            credential_expiry = parse_datetime(saved_expiry)
    payload = {
        "grant_id": str(grant.id),
        "connection_id": str(grant.connection_id),
        "connection_name": connection.name,
        "credential_id": str(credential.id),
        "credential_name": credential.name,
        "credential_provider": credential.provider,
        "credential_revision": str(credential.revision),
        "material_generation": generation,
        "config_env": {
            binding["name"]: str(runtime_config[binding["source_field"]])
            for binding in environment_bindings
            if binding["action"] == "set"
            and binding["source"] == "connection_config"
            and binding["source_field"] in runtime_config
        },
        "service_type": service["service_type"],
        "protocol": service["protocol"],
        "hosts": item["hosts"],
        "connection_config": runtime_config,
        "injection": service["injection"],
        "on_refresh": service["on_refresh"],
        "identifiers": identifiers,
        "decoy_material": decoy_material,
        "agent_env": agent_env,
        "environment_bindings": environment_bindings,
        "authorization": authorization,
    }
    if credential_expiry:
        payload["credential_expires_at"] = credential_expiry
    if should_resolve:
        payload["secret_material"] = material
    return payload


def resolve_workflow_config(
    session,
    *,
    include_secrets=True,
    prepared_grants=None,
):
    prepared = (
        prepare_workflow(session.workflow)
        if prepared_grants is None
        else prepared_grants
    )
    connections = [
        _connection_payload(
            item,
            session,
            include_secrets=include_secrets,
        )
        for item in prepared
    ]
    config_env = _workflow_config_env(connections)
    if include_secrets:
        runtime_snapshot = {
            "version": _RUNTIME_SNAPSHOT_VERSION,
            "connections": {
                connection["grant_id"]: {
                    "connection_id": connection["connection_id"],
                    "credential_id": connection["credential_id"],
                    "credential_revision": connection["credential_revision"],
                    "identifiers": deepcopy(connection["identifiers"]),
                    "connection_config": deepcopy(connection["connection_config"]),
                    "material_generation": connection["material_generation"],
                    "credential_expires_at": _snapshot_expiry(
                        connection.get("credential_expires_at")
                    ),
                }
                for connection in connections
                if connection["authorization"]["state"] == "allowed"
            },
        }
        if session.runtime_snapshot != runtime_snapshot:
            AgentSession.objects.filter(
                pk=session.pk, revoked_at__isnull=True
            ).update(runtime_snapshot=runtime_snapshot)
            session.runtime_snapshot = runtime_snapshot
    return {"config_env": config_env, "connections": connections}


def _render_context_template(template, identifiers):
    values = dict(identifiers)

    def replace(match):
        return str(values.get(match.group(1), "not disclosed"))

    return re.sub(r"\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}", replace, template)


def resolve_runtime_capabilities(session):
    """Services this Workflow can use and the Connection IDs serving each.

    Never includes credentials or Connection settings.
    """

    registry = get_config_registry()
    connection_ids = {}
    active_grants = AgentWorkflowGrant.objects.filter(
        organisation=session.organisation,
        workflow=session.workflow,
        connection__organisation=session.organisation,
        deleted_at__isnull=True,
        connection__deleted_at__isnull=True,
        connection__state=AgentConnection.ACTIVE,
    ).values_list("connection__service_type", "connection_id")
    for service_type, connection_id in active_grants:
        connection_ids.setdefault(service_type, set()).add(
            str(connection_id)
        )

    services = []
    for service_type, service in sorted(registry.services.items()):
        credential_providers = service["credential_providers"]
        if not credential_providers:
            continue
        services.append(
            {
                "service_type": service_type,
                "display_name": service["display_name"],
                "credential_providers": credential_providers,
                "client_matchers": service["client_matchers"],
                "connection_ids": sorted(connection_ids.get(service_type, set())),
            }
        )
    return services


def compose_context(session, *, service_type=None):
    """Markdown the agent reads about its Connections.

    Built from the registry and the non-secret identifiers saved when the
    session opened; never from credential material.
    """

    prepared = prepare_workflow(session.workflow, service_type=service_type)
    generated_sections = []
    if service_type is not None and not prepared:
        service = get_config_registry().get_service(service_type)
        generated_sections.append(
            f"### {service['display_name']}\n\n"
            "Phase supports this service, but this Workflow currently has "
            "no granted Connection for it."
        )
    for item in prepared:
        service = item["service"]
        grant = item["grant"]
        saved = _saved_runtime_for(session, grant, grant.connection.authentication)
        generated = _render_context_template(
            service["context_template"], saved.get("identifiers", {})
        )
        authorization_line = (
            "Connection authorization: allowed by its active Workflow Grant. "
            "Upstream permissions are controlled by the configured credential."
        )
        generated_sections.append(
            f"### {grant.connection.name}\n\n{authorization_line}\n\n{generated}"
        )
    return "\n\n".join(generated_sections)
