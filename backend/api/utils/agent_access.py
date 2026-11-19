"""How a Workflow's access to a Connection starts, is time-limited and ends.

``end_connection_access`` is the one path that ends a grant; ``grant_connection_access``
is the one that starts or extends it.
"""

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from api.models import (
    AgentConnection,
    AgentOrganisationSettings,
    AgentWorkflowGrant,
)
from api.utils.agent_config.access_policy import live_temporary_allows
from api.utils.agent_connection_values import (
    ensure_agent_key_copy,
    prune_agent_key_copies,
)
from api.utils.agent_sessions import refresh_workflow_sessions


# The bounds of an organisation's request-duration settings, and of what an
# Agent may ask for.
MIN_DURATION_SECONDS = 300
MAX_DURATION_SECONDS = 2592000
# How long after a grant ended its Workflow may still ask to renew it, and how
# long the runtime keeps telling the Agent that it expired.
RENEWAL_WINDOW = timedelta(days=30)
# The longest a member may grant when approving.
_MAX_GRANTED_SECONDS = 10 * 365 * 86400


class DurationError(ValueError):
    """A requested or granted duration is outside what is allowed."""


def end_connection_access(grants, *, ended_at=None):
    """End the open grants in a queryset, and tell the sessions of their Workflows to refetch.

    Call inside a transaction. Returns the grants it ended.
    """

    now = ended_at or timezone.now()
    candidates = list(grants.not_ended().values_list("id", "workflow_id"))
    if not candidates:
        return []
    # Sessions before grants: the runtime locks a session before its grant.
    refresh_workflow_sessions({workflow_id for _, workflow_id in candidates})
    ended = list(
        AgentWorkflowGrant.objects.select_for_update(of=("self",))
        .not_ended()
        .filter(id__in=[grant_id for grant_id, _ in candidates])
        .order_by("id")
    )
    if not ended:
        return []
    AgentWorkflowGrant.objects.filter(id__in=[grant.id for grant in ended]).update(
        deleted_at=now, updated_at=now
    )
    for grant in ended:
        grant.deleted_at = now
    prune_agent_key_copies({grant.connection_id for grant in ended})
    return ended


def end_lapsed_access(grants, *, now=None):
    """End the grants in a queryset whose expiry has passed.

    Run whenever grants are next read, since there is no scheduler.
    """

    now = now or timezone.now()
    lapsed = grants.lapsed(now)
    if not lapsed.exists():
        return []
    with transaction.atomic():
        return end_connection_access(lapsed, ended_at=now)


def prune_temporary_allows(grants, *, now=None):
    """Drop expired temporary allows from the grants in a queryset.

    Expired allows are ignored wherever a policy is read; this only keeps the list short.
    """

    now = now or timezone.now()
    stale = [
        grant_id
        for grant_id, allows in grants.not_ended()
        .exclude(temporary_allows=[])
        .values_list("id", "temporary_allows")
        if len(live_temporary_allows(allows, now)) != len(allows or [])
    ]
    if not stale:
        return
    with transaction.atomic():
        for grant in (
            AgentWorkflowGrant.objects.select_for_update(of=("self",))
            .filter(id__in=stale)
            .order_by("id")
        ):
            grant.temporary_allows = live_temporary_allows(
                grant.temporary_allows, now
            )
            grant.save(update_fields=["temporary_allows", "updated_at"])


def _exported_names(connection):
    """The environment variables a custom Connection gives an Agent, keyed
    without regard to case."""

    from api.utils.agent_config import ConfigRegistryError, load_definition

    try:
        fields = load_definition(connection.config)["fields"]
    except ConfigRegistryError:
        return {}
    return {
        field["env"].casefold(): field["env"] for field in fields if field.get("env")
    }


def _refuse_contested_names(workflow, connection, now):
    """Refuse a custom Connection that exports a variable another custom
    Connection of the Workflow already exports: an Agent's environment holds
    one value per name, so neither would reach it."""

    from api.utils.agent_config import HTTP_SERVICE_TYPE, is_custom_service

    if not is_custom_service(connection.service_type):
        return
    names = _exported_names(connection)
    if not names:
        return
    held = (
        AgentWorkflowGrant.objects.active(now)
        .filter(
            workflow=workflow,
            connection__service_type=HTTP_SERVICE_TYPE,
            connection__deleted_at__isnull=True,
        )
        .exclude(connection=connection)
        .select_related("connection")
        .order_by("created_at", "id")
    )
    for other in held:
        shared = sorted(set(names) & set(_exported_names(other.connection)))
        if shared:
            raise ValidationError(
                f"'{connection.name}' and '{other.connection.name}' both export "
                f"the variable {names[shared[0]]}, and this Workflow already has "
                f"'{other.connection.name}'. Change the variable's name on one of "
                "them, or remove the other from this Workflow first."
            )


def grant_connection_access(
    workflow, connection, member, *, expires_at=None, extend=False
):
    """Give a Workflow a Connection, or return its existing grant. Call with the Connection row locked.

    With ``extend``, an expiry only moves later. Returns ``(grant, created)``.
    """

    now = timezone.now()
    pair = AgentWorkflowGrant.objects.filter(workflow=workflow, connection=connection)
    end_connection_access(pair.lapsed(now), ended_at=now)
    grant = pair.select_for_update(of=("self",)).active(now).first()
    created = grant is None
    if created:
        _refuse_contested_names(workflow, connection, now)
        grant = AgentWorkflowGrant(
            organisation=workflow.organisation,
            workflow=workflow,
            connection=connection,
            created_by=member,
            expires_at=expires_at,
        )
        grant.full_clean()
        grant.save()
    elif extend and grant.expires_at is not None and (
        expires_at is None or expires_at > grant.expires_at
    ):
        grant.expires_at = expires_at
        grant.save(update_fields=["expires_at", "updated_at"])
    ensure_agent_key_copy(connection, workflow.agent)
    return grant, created


def renewable_grant(workflow_id, connection_id, *, now=None):
    """The grant a Workflow may ask to renew: the one in force, or the one
    that most recently ended within the renewal window."""

    now = now or timezone.now()
    pair = AgentWorkflowGrant.objects.select_related(
        "connection__authentication"
    ).filter(
        workflow_id=workflow_id,
        connection_id=connection_id,
        connection__deleted_at__isnull=True,
        connection__state=AgentConnection.ACTIVE,
    )
    active = pair.active(now).first()
    if active is not None:
        return active
    recent = [
        grant
        for grant in pair.order_by("-created_at")[:20]
        if grant_ended_at(grant, now) > now - RENEWAL_WINDOW
    ]
    return max(recent, key=lambda grant: grant_ended_at(grant, now), default=None)


def grant_ended_at(grant, now):
    """When a grant that is no longer in force stopped giving access."""

    moments = [
        moment for moment in (grant.deleted_at, grant.expires_at) if moment is not None
    ]
    return min(moments) if moments else now


def expired_connections(workflow, *, now=None):
    """Connections this Workflow lost to an expiry within the renewal window
    and has not been granted again, newest expiry first."""

    now = now or timezone.now()
    grants = AgentWorkflowGrant.objects.filter(workflow=workflow)
    held = set(grants.active(now).values_list("connection_id", flat=True))
    listed = {}
    for grant in (
        grants.expired(now)
        .filter(
            expires_at__gt=now - RENEWAL_WINDOW,
            connection__deleted_at__isnull=True,
            connection__state=AgentConnection.ACTIVE,
        )
        .select_related("connection")
        .order_by("-expires_at", "id")
    ):
        if grant.connection_id in held or grant.connection_id in listed:
            continue
        listed[grant.connection_id] = {
            "connection_id": str(grant.connection_id),
            "connection_name": grant.connection.name,
            "service_type": grant.connection.service_type,
            "expired_at": grant.expires_at,
        }
    return list(listed.values())


def _seconds(value, label):
    if isinstance(value, bool) or not isinstance(value, int):
        raise DurationError(f"{label} must be a whole number of seconds.")
    return value


def requested_duration(organisation, value):
    """The duration a request asks for: the organisation's default when it
    names none, and never outside what an Agent may ask for."""

    settings = AgentOrganisationSettings.for_organisation(organisation)
    if value is None:
        return settings.default_request_duration_seconds
    seconds = _seconds(value, "durationSeconds")
    if seconds < MIN_DURATION_SECONDS:
        raise DurationError(
            f"durationSeconds must be at least {MIN_DURATION_SECONDS}."
        )
    maximum = settings.max_request_duration_seconds
    if seconds > maximum:
        raise DurationError(
            f"durationSeconds must be at most {maximum}, the maximum this "
            "organisation lets an Agent ask for."
        )
    return seconds


def granted_duration(
    request, inputs, *, allow_until_revoked=True, organisation_maximum=False
):
    """Return ``(seconds, expires_at)`` for what a member approves; both None means until revoked.

    Without ``durationSeconds`` or ``untilRevoked`` in ``inputs``, the requested duration is used.
    """

    until_revoked = inputs.get("untilRevoked")
    seconds = inputs.get("durationSeconds")
    if until_revoked not in (None, False, True):
        raise DurationError("untilRevoked must be true or false.")
    if until_revoked:
        if seconds is not None:
            raise DurationError("Give durationSeconds or untilRevoked, not both.")
        if not allow_until_revoked:
            raise DurationError("This access always has an expiry.")
        return None, None
    if seconds is None:
        seconds = request.duration_seconds
    if seconds is None:
        seconds = AgentOrganisationSettings.for_organisation(
            request.organisation_id
        ).default_request_duration_seconds
    seconds = _seconds(seconds, "durationSeconds")
    maximum = (
        AgentOrganisationSettings.for_organisation(
            request.organisation_id
        ).max_request_duration_seconds
        if organisation_maximum
        else _MAX_GRANTED_SECONDS
    )
    if not 1 <= seconds <= maximum:
        raise DurationError(f"durationSeconds must be between 1 and {maximum}.")
    return seconds, timezone.now() + timedelta(seconds=seconds)


def access_record(request, seconds, expires_at):
    """What was asked for and what was granted, as a request records it."""

    return {
        "requestedDurationSeconds": request.duration_seconds,
        "grantedDurationSeconds": seconds,
        "expiresAt": iso_timestamp(expires_at),
    }


def applied_access(applied_action):
    """The record ``access_record`` made for an approved request. An app
    access action already uses ``access`` for its level, so it keeps the
    record under ``accessRecord``."""

    applied_action = applied_action or {}
    record = applied_action.get("access")
    return record if isinstance(record, dict) else applied_action.get("accessRecord")


def iso_timestamp(value):
    """A timestamp in the spelling the runtime API renders."""

    if value is None:
        return None
    text = value.isoformat()
    return f"{text[:-6]}Z" if text.endswith("+00:00") else text


class AccessError(ValueError):
    """A Connection cannot be granted as it stands."""


def lock_grantable_connection(organisation_id, connection_id):
    """Lock a Connection and check a Workflow can be granted it: active, with
    a live integration credential or, for a custom Connection, a stored value;
    an app Connection must still cover environments of an SSE app.
    Call inside a transaction."""

    from api.utils.agent_app_access import AppAccessError, check_app_connection
    from api.utils.agent_config import (
        ConfigRegistryError,
        get_config_registry,
        is_app_service,
        is_custom_service,
    )

    try:
        # The credential join is nullable, so only the Connection row is locked.
        connection = (
            AgentConnection.objects.select_for_update(of=("self",))
            .select_related("authentication")
            .get(
                id=connection_id,
                organisation_id=organisation_id,
                deleted_at__isnull=True,
                state=AgentConnection.ACTIVE,
                authentication__deleted_at__isnull=True,
            )
        )
    except (AgentConnection.DoesNotExist, ValueError) as exc:
        raise AccessError("Active Agent Connection not found") from exc
    if is_custom_service(connection.service_type):
        if not connection.sealed_value:
            raise AccessError("Active Agent Connection not found")
        return connection
    if is_app_service(connection.service_type):
        try:
            check_app_connection(connection)
        except AppAccessError as exc:
            raise AccessError(str(exc)) from exc
        return connection
    try:
        service = get_config_registry().get_service(connection.service_type)
    except ConfigRegistryError as exc:
        raise AccessError(str(exc)) from exc
    if connection.authentication is None or connection.authentication.provider not in (
        service.get("credential_providers") or []
    ):
        raise AccessError("Connection authentication is incompatible with its service")
    return connection


def connection_takes_policy(connection):
    """Access policies apply to HTTP Connections, packaged or custom, and to
    app Connections, where the Console enforces them."""

    from api.utils.agent_config import (
        ConfigRegistryError,
        is_app_service,
        service_for_connection,
    )

    if is_app_service(connection.service_type):
        return True
    try:
        return service_for_connection(connection)["protocol"] == "http"
    except ConfigRegistryError:
        return False
