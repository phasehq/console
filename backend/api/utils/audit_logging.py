import logging
from uuid import uuid4

from django.utils import timezone
from django.db import transaction
from django.db.models import prefetch_related_objects

from api.models import AuditEvent, SecretEvent


logger = logging.getLogger(__name__)


def get_member_display_name(org_member):
    """
    Return the best human-readable display name for an OrganisationMember.
    Prefers the social account full name, falls back to email.
    """
    try:
        social_acc = org_member.user.socialaccount_set.first()
        if social_acc:
            name = social_acc.extra_data.get("name")
            if name:
                return name
    except Exception:
        pass
    return getattr(org_member.user, "email", str(org_member.id))


def log_secret_event(
    secret,
    event_type,
    user=None,
    service_account_token=None,
    ip_address=None,
    user_agent=None,
):
    """
    Utility function to log secret events.
    """
    log_secret_events_bulk(
        [secret],
        event_type,
        user=user,
        service_account_token=service_account_token,
        ip_address=ip_address,
        user_agent=user_agent,
    )


def log_audit_event(
    organisation,
    event_type,
    resource_type,
    resource_id,
    actor_type,
    actor_id,
    actor_metadata=None,
    resource_metadata=None,
    old_values=None,
    new_values=None,
    description="",
    ip_address=None,
    user_agent="",
):
    """
    Log a generic audit event. Fire-and-forget — never raises.
    """
    try:
        AuditEvent.objects.create(
            organisation=organisation,
            event_type=event_type,
            resource_type=resource_type,
            resource_id=str(resource_id),
            actor_type=actor_type,
            actor_id=str(actor_id),
            actor_metadata=actor_metadata or {},
            resource_metadata=resource_metadata or {},
            old_values=old_values,
            new_values=new_values,
            description=description,
            ip_address=ip_address,
            user_agent=user_agent or "",
        )
    except Exception:
        logger.exception("Failed to write audit event: %s %s %s", event_type, resource_type, resource_id)


def get_actor_info(request):
    """
    Extract actor info from request.auth (REST views).
    Returns (actor_type, actor_id, actor_metadata).

    `actor_metadata["token"]` is populated when the request is
    authenticated via a PAT or service-account token, so audit consumers
    can distinguish which specific token drove the action. Console-UI /
    GraphQL traffic uses a session and has no token attribution.
    """
    auth = request.auth
    if auth.get("auth_type") == "User":
        org_member = auth["org_member"]
        metadata = {
            "email": getattr(org_member.user, "email", ""),
            "username": getattr(org_member.user, "username", ""),
        }
        user_token = auth.get("user_token")
        if user_token is not None:
            metadata["token"] = {
                "id": str(user_token.id),
                "name": user_token.name,
                "type": "user_token",
            }
        return ("user", str(org_member.id), metadata)
    elif auth.get("auth_type") == "ServiceAccount":
        sa = auth["service_account"]
        metadata = {"name": sa.name}
        sa_token = auth.get("service_account_token")
        if sa_token is not None:
            metadata["token"] = {
                "id": str(sa_token.id),
                "name": sa_token.name,
                "type": "sa_token",
            }
        return ("sa", str(sa.id), metadata)
    return ("user", "", {})


def get_actor_info_from_graphql(info, organisation=None):
    """
    Extract actor info from GraphQL info.context.
    GraphQL mutations are user-only today.
    Returns (actor_type, actor_id, actor_metadata).

    `organisation` scopes the OrganisationMember lookup. Without it, a user
    in multiple orgs would land an arbitrary cross-tenant member UUID into
    the audit log, leaking identifiers across orgs and breaking
    actor-based audit-log filtering.
    """
    user = info.context.user
    if hasattr(user, "userId"):
        from api.models import OrganisationMember

        org_member = getattr(info.context, "_org_member", None)
        if org_member is None:
            lookup = {"user": user, "deleted_at": None}
            if organisation is not None:
                lookup["organisation"] = organisation
            try:
                org_member = OrganisationMember.objects.filter(**lookup).first()
            except Exception:
                pass
        if org_member:
            return (
                "user",
                str(org_member.id),
                {
                    "email": getattr(user, "email", ""),
                    "username": getattr(user, "username", ""),
                },
            )
    return ("user", "", {})


def build_change_values(instance, fields, new_data):
    """
    Compare model instance fields against incoming new_data dict.
    Returns (old_values, new_values) with only changed fields.
    Returns (None, None) if nothing changed.
    """
    old = {}
    new = {}
    for field in fields:
        old_val = getattr(instance, field, None)
        new_val = new_data.get(field)
        if new_val is not None and old_val != new_val:
            # Serialize to JSON-safe types
            old[field] = _serialize_value(old_val)
            new[field] = _serialize_value(new_val)
    return (old or None, new or None)


def _serialize_value(val):
    """Make a value JSON-serializable."""
    if val is None:
        return None
    if isinstance(val, (str, int, float, bool, list, dict)):
        return val
    return str(val)


def audit_app_cascade_envs(
    app, actor_type, actor_id, actor_metadata, ip_address, user_agent
):
    """Emit a D event per environment that's about to be hard-cascaded by
    `app.delete()`. Without this, wiping an app shows as one audit line
    even though N envs and all their secret history die with it. Secret-
    level events are intentionally out of scope — the SecretEvent rows
    are CASCADE-tied to Secret and disappear with them; replicating that
    history into AuditEvent would flood the log."""
    from api.models import Environment

    for env in Environment.objects.filter(app=app):
        log_audit_event(
            organisation=app.organisation,
            event_type="D",
            resource_type="env",
            resource_id=env.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={
                "name": env.name,
                "app_id": str(app.id),
                "app_name": app.name,
            },
            old_values={"name": env.name},
            description=(
                f"Cascade-deleted environment '{env.name}' "
                f"(parent app '{app.name}' deleted)"
            ),
            ip_address=ip_address,
            user_agent=user_agent,
        )


def audit_team_cascade_sas(
    team, actor_type, actor_id, actor_metadata, ip_address, user_agent
):
    """Emit D events for each team-owned SA and its active tokens before
    they're soft-deleted by the team-delete cascade. Without this, the
    team-delete audit trail looks like a single 'D team' row even when
    several SAs and their tokens go with it."""
    from api.models import ServiceAccount, ServiceAccountToken

    sas = list(ServiceAccount.objects.filter(team=team, deleted_at__isnull=True))
    for sa in sas:
        tokens = list(
            ServiceAccountToken.objects.filter(
                service_account=sa, deleted_at__isnull=True
            )
        )
        for token in tokens:
            log_audit_event(
                organisation=team.organisation,
                event_type="D",
                resource_type="sa_token",
                resource_id=token.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_metadata,
                resource_metadata={
                    "name": token.name,
                    "service_account_id": str(sa.id),
                    "service_account_name": sa.name,
                },
                old_values={
                    "name": token.name,
                    "expires_at": token.expires_at.isoformat() if token.expires_at else None,
                },
                description=(
                    f"Cascade-deleted SA token '{token.name}' "
                    f"(team '{team.name}' deleted)"
                ),
                ip_address=ip_address,
                user_agent=user_agent,
            )
        log_audit_event(
            organisation=team.organisation,
            event_type="D",
            resource_type="sa",
            resource_id=sa.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={
                "name": sa.name,
                "team_id": str(team.id),
                "team_name": team.name,
            },
            old_values={"name": sa.name},
            description=(
                f"Cascade-deleted service account '{sa.name}' "
                f"(team '{team.name}' deleted)"
            ),
            ip_address=ip_address,
            user_agent=user_agent,
        )


def log_secret_events_bulk(
    secrets,
    event_type,
    user=None,
    service_account_token=None,
    ip_address=None,
    user_agent=None,
):
    """
    Log one event per secret.

    With SECRET_EVENT_BUFFER_ENABLED (and the event type listed in
    SECRET_EVENT_BUFFER_EVENT_TYPES) the rows are written to the Redis
    write-behind buffer (one round trip for the whole batch) and bulk-inserted
    later by the ``flush_secret_events`` consumer; if Redis is unavailable or
    over budget they are inserted synchronously instead. Otherwise they are
    inserted synchronously in one multi-row INSERT.
    """
    from api.utils import secret_event_buffer as buffer

    secrets = list(secrets)
    if not secrets:
        return

    prefetch_related_objects(secrets, "tags")

    header = buffer.build_header(
        event_type,
        timezone.now(),
        user,
        service_account_token,
        ip_address,
        user_agent,
    )
    rows = [
        buffer.build_row(str(uuid4()), secret, [tag.id for tag in secret.tags.all()])
        for secret in secrets
    ]

    if buffer.should_buffer(event_type):
        buffer.buffer_or_insert(header, rows, _insert_secret_event_rows)
    else:
        _insert_secret_event_rows(header, rows)


def _insert_secret_event_rows(header, rows):
    from api.utils import secret_event_buffer as buffer

    return insert_secret_events(buffer.rows_to_event_kwargs(header, rows))


def insert_secret_events(pairs, batch_size=1000):
    """
    Insert ``(SecretEvent kwargs, tag ids)`` pairs in one transaction.

    Event ids are minted by the caller, so ON CONFLICT DO NOTHING makes the
    insert idempotent: replaying the same rows (buffer redelivery, or a
    buffered write that also fell back to a synchronous insert) is a no-op.
    """
    if not pairs:
        return 0

    events = [SecretEvent(**kwargs) for kwargs, _ in pairs]
    through_model = SecretEvent.tags.through
    m2m_rows = [
        through_model(secretevent_id=kwargs["id"], secrettag_id=tag_id)
        for kwargs, tag_ids in pairs
        for tag_id in tag_ids
    ]

    with transaction.atomic():
        SecretEvent.objects.bulk_create(
            events, batch_size=batch_size, ignore_conflicts=True
        )
        if m2m_rows:
            through_model.objects.bulk_create(
                m2m_rows, batch_size=batch_size, ignore_conflicts=True
            )

    return len(events)
