import logging

from django.utils import timezone

from api.models import AuditEvent, SecretEvent

logger = logging.getLogger(__name__)


def log_secret_event(
    secret,
    event_type,
    user=None,
    service_token=None,
    service_account_token=None,
    ip_address=None,
    user_agent=None,
):
    """
    Utility function to log secret events.
    """

    service_account = None
    if service_account_token is not None:
        service_account = service_account_token.service_account

    event = SecretEvent.objects.create(
        secret=secret,
        environment=secret.environment,
        folder=secret.folder,
        path=secret.path,
        user=user,
        service_token=service_token,
        service_account=service_account,
        service_account_token=service_account_token,
        key=secret.key,
        key_digest=secret.key_digest,
        value=secret.value,
        version=secret.version,
        comment=secret.comment,
        event_type=event_type,
        timestamp=timezone.now(),
        ip_address=ip_address,
        user_agent=user_agent,
    )

    event.tags.set(secret.tags.all())


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
    """
    auth = request.auth
    if auth.get("auth_type") == "User":
        org_member = auth["org_member"]
        return (
            "user",
            str(org_member.id),
            {
                "email": getattr(org_member.user, "email", ""),
                "username": getattr(org_member.user, "username", ""),
            },
        )
    elif auth.get("auth_type") == "ServiceAccount":
        sa = auth["service_account"]
        return (
            "sa",
            str(sa.id),
            {"name": sa.name},
        )
    return ("user", "", {})


def get_actor_info_from_graphql(info):
    """
    Extract actor info from GraphQL info.context.
    GraphQL mutations are user-only today.
    Returns (actor_type, actor_id, actor_metadata).
    """
    user = info.context.user
    if hasattr(user, "userId"):
        # user is a CustomUser; find the org_member from context if available
        from api.models import OrganisationMember

        # Try to get org_member from the info context or look it up
        org_member = getattr(info.context, "_org_member", None)
        if org_member is None:
            try:
                org_member = OrganisationMember.objects.filter(
                    user=user, deleted_at=None
                ).first()
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
