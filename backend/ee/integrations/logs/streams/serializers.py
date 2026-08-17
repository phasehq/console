"""Neutral, versioned envelopes for exported log events.

Attribute names follow OpenTelemetry semantic conventions where one exists
(``client.address``, ``user_agent.original``, ``user.*``); Phase domain data
lives under ``phase.*``. Destination-specific reserved fields and attribute
remapping (e.g. Datadog's ``network.client.ip`` / ``usr.*``) belong in the
adapters, never here.

Hard rule: ``key``, ``key_digest``, ``value`` and ``comment`` from
SecretEvent are E2EE ciphertext (and the digest is a blind index over the key
name) — they must never appear in an envelope. Secrets are identified by id,
path and their app/environment; the console's global search resolves a bare
secret id back to the exact secret. Envelopes deliberately carry no console
URLs — a baked hostname rots in the destination's records when a self-hosted
console moves or serves multiple origins.
"""

SCHEMA_VERSION = 1

EVENT_TYPE_NAMES = {
    "C": "create",
    "R": "read",
    "U": "update",
    "D": "delete",
    "A": "access",
}

ACTOR_TYPE_NAMES = {
    "user": "user",
    "sa": "service_account",
}

SECRET_EVENT_VERBS = {
    "C": "created",
    "R": "read",
    "U": "updated",
    "D": "deleted",
}

VERB_LABELS = {
    "C": "Created",
    "R": "Read",
    "U": "Updated",
    "D": "Deleted",
    "A": "Accessed",
}

# The DB stores compact resource codes; exports ship readable slugs so SIEM
# queries and facets don't need a Phase-internal decoder ring.
RESOURCE_TYPE_NAMES = {
    "app": "app",
    "env": "environment",
    "role": "role",
    "sa": "service_account",
    "member": "member",
    "policy": "network_access_policy",
    "pat": "personal_access_token",
    "sa_token": "service_account_token",
    "svc_token": "service_token",
    "invite": "invite",
    "team": "team",
    "rs": "rotating_secret",
    "stream": "log_stream",
}

RESOURCE_LABELS = {
    "app": "app",
    "env": "environment",
    "role": "role",
    "sa": "service account",
    "member": "member",
    "policy": "network access policy",
    "pat": "personal access token",
    "sa_token": "service account token",
    "svc_token": "service token",
    "invite": "invite",
    "team": "team",
    "rs": "rotating secret",
    "stream": "log stream",
}


def _organisation_block(organisation):
    return {"id": str(organisation.id), "name": organisation.name}


def audit_event_to_envelope(event, organisation):
    actor_metadata = event.actor_metadata or {}

    # Call-site descriptions win; otherwise synthesize one so the
    # destination's content line is never a bare "org_audit.update".
    description = event.description or ""
    if not description:
        resource_label = RESOURCE_LABELS.get(event.resource_type, event.resource_type)
        resource_name = (event.resource_metadata or {}).get("name")
        description = (
            f"{VERB_LABELS.get(event.event_type, event.event_type)} {resource_label}"
        )
        if resource_name:
            description += f" '{resource_name}'"

    envelope = {
        "schema_version": SCHEMA_VERSION,
        "event": {
            "id": str(event.id),
            "category": "org_audit",
            "type": EVENT_TYPE_NAMES.get(event.event_type, event.event_type),
        },
        "timestamp": event.timestamp.isoformat(),
        "actor": {
            "type": ACTOR_TYPE_NAMES.get(event.actor_type, event.actor_type),
            "id": event.actor_id,
            "name": actor_metadata.get("email")
            or actor_metadata.get("name")
            or actor_metadata.get("username")
            or "",
        },
        "client": {"address": event.ip_address},
        "user_agent": {"original": event.user_agent or ""},
        "phase": {
            "organisation": _organisation_block(organisation),
            "resource": {
                "type": RESOURCE_TYPE_NAMES.get(event.resource_type, event.resource_type),
                "id": event.resource_id,
                "metadata": event.resource_metadata or {},
            },
            "old_values": event.old_values,
            "new_values": event.new_values,
            # Capped: the Datadog adapter duplicates this into the top-level
            # `message`, so an unbounded description would double its weight
            # against the 1MB wire limit.
            "description": description[:2000],
        },
    }

    if event.actor_type == "user":
        envelope["user"] = {
            "id": event.actor_id,
            "email": actor_metadata.get("email", ""),
            "name": actor_metadata.get("username", ""),
        }
    token = actor_metadata.get("token")
    if token:
        envelope["actor"]["token"] = {
            "id": token.get("id", ""),
            "name": token.get("name", ""),
            "type": token.get("type", ""),
        }

    return envelope


def _secret_event_actor(event):
    """Resolve the SecretEvent actor FKs into (actor_block, user_block).

    Engine-driven events (e.g. rotations) have no actor at all — mirrored
    here as type "phase", matching how the console renders them.
    """
    user_block = None
    if event.user_id and event.user:
        user = event.user.user
        actor = {
            "type": "user",
            "id": str(event.user_id),
            "name": getattr(user, "full_name", "") or getattr(user, "email", ""),
        }
        user_block = {
            "id": str(event.user_id),
            "email": getattr(user, "email", ""),
            "name": getattr(user, "full_name", "") or getattr(user, "email", ""),
        }
    elif event.service_account_id and event.service_account:
        actor = {
            "type": "service_account",
            "id": str(event.service_account_id),
            "name": event.service_account.name,
        }
        if event.service_account_token_id and event.service_account_token:
            actor["token"] = {
                "id": str(event.service_account_token_id),
                "name": event.service_account_token.name,
                "type": "sa_token",
            }
    elif event.service_token_id and event.service_token:
        actor = {
            "type": "service_token",
            "id": str(event.service_token_id),
            "name": event.service_token.name,
        }
    else:
        actor = {"type": "phase", "id": "", "name": "Phase"}

    return actor, user_block


def secret_event_to_envelope(event, organisation):
    environment = event.environment
    app = environment.app

    actor, user_block = _secret_event_actor(event)

    # Human-readable summary — becomes the destination's message/content line.
    # The secret name is E2EE and never included; app/env/path locate it.
    verb = SECRET_EVENT_VERBS.get(event.event_type, event.event_type)
    location = f"{app.name} / {environment.name}"
    path = event.path or "/"
    if path != "/":
        location += f" at {path}"
    description = f"Secret {verb} in {location} by {actor['name']}"

    envelope = {
        "schema_version": SCHEMA_VERSION,
        "event": {
            "id": str(event.id),
            "category": "secrets",
            "type": EVENT_TYPE_NAMES.get(event.event_type, event.event_type),
        },
        "timestamp": event.timestamp.isoformat(),
        "actor": actor,
        "client": {"address": event.ip_address},
        "user_agent": {"original": event.user_agent or ""},
        "phase": {
            "organisation": _organisation_block(organisation),
            "app": {"id": str(app.id), "name": app.name},
            "environment": {
                "id": str(environment.id),
                "name": environment.name,
                "type": environment.env_type,
            },
            "secret": {
                "id": str(event.secret_id),
                "path": event.path or "/",
                "version": event.version,
                "type": event.type,
            },
            # Capped: the Datadog adapter duplicates this into the top-level
            # `message`, so an unbounded description would double its weight
            # against the 1MB wire limit.
            "description": description[:2000],
        },
    }

    if user_block:
        envelope["user"] = user_block

    return envelope
