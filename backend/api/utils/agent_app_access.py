"""Application secrets for Agents, through app Connections.

The Console decides each Agent token call from the active grants, so a revocation
applies to the next call.
"""

from dataclasses import dataclass

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.models import (
    AgentConnection,
    AgentConnectionEnvironment,
    AgentWorkflowGrant,
    App,
    Environment,
    ServerEnvironmentKey,
)
from api.utils.access.permissions import (
    role_has_global_access,
    role_has_permission,
    user_has_permission,
)
from api.utils.agent_access import RENEWAL_WINDOW, iso_timestamp
from api.utils.asset_visibility import asset_visibility
from api.utils.agent_config import APP_SERVICE_TYPE
from api.utils.agent_config.access_policy import (
    PolicyError,
    full_policy,
    live_temporary_allows,
    validate_policy,
)


APP_CLASSES = ("read", "create", "update", "delete")
WRITE_CLASSES = ("create", "update", "delete")
# The class of a call to the secrets API, from its method.
METHOD_CLASSES = {"GET": "read", "POST": "create", "PUT": "update", "DELETE": "delete"}
# What each access level an Agent may ask for covers.
ACCESS_LEVELS = {"read": ("read",), "read_write": APP_CLASSES}
MAX_ENVIRONMENTS = 20
# Reads allowed, writes ask: what a new app Connection starts with.
DEFAULT_POLICY = {
    "version": 1,
    "default": "allow",
    "rules": [{"class": name, "effect": "ask"} for name in WRITE_CLASSES],
}
SSE_REQUIRED_MESSAGE = (
    "This app does not have server-side encryption enabled, which Agent access "
    "needs. A member can enable it in the app's settings."
)
_EFFECT_ORDER = ("block", "ask", "allow")


class AppAccessError(ValueError):
    """An app Connection, or access to one, cannot be given as asked."""

    def __init__(self, message, *, code="invalid_app_access", not_found=False):
        super().__init__(message)
        self.code = code
        self.not_found = not_found


def ordered_classes(classes):
    return [name for name in APP_CLASSES if name in set(classes)]


def describe_classes(classes):
    """``create, update and delete`` for a reader."""

    names = ordered_classes(classes)
    if len(names) < 2:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def validate_app_policy(policy):
    """An app Connection's policy: rules by class, and only the four classes
    the secrets API has."""

    checked = validate_policy(policy)
    for index, rule in enumerate(checked.get("rules", [])):
        if rule.get("class") not in APP_CLASSES:
            raise PolicyError(
                f"policy.rules[{index}]: an app Connection's rules each name "
                "one class: read, create, update or delete"
            )
    return checked


def class_effect(stored_policy, name):
    """What a Connection's policy says about one class: the strictest rule
    that names it, or the default."""

    policy = full_policy(stored_policy)
    effects = {
        rule["effect"] for rule in policy["rules"] if rule.get("class") == name
    }
    for effect in _EFFECT_ORDER:
        if effect in effects:
            return effect
    return policy["default"]


def blocked_classes(stored_policy, classes):
    return [
        name
        for name in ordered_classes(classes)
        if class_effect(stored_policy, name) == "block"
    ]


def released_classes(stored_policy, temporary_classes=()):
    """The classes a grant gives: what the policy allows, and what a temporary
    allow lifts from ``ask``."""

    return {
        name
        for name in APP_CLASSES
        if class_effect(stored_policy, name) == "allow"
        or (name in temporary_classes and class_effect(stored_policy, name) == "ask")
    }


def _allow_expiry(entry):
    value = entry.get("expiresAt")
    try:
        return parse_datetime(value) if isinstance(value, str) else None
    except ValueError:
        return None


def grant_access(grant, now=None):
    """The effect of each class on one grant at this moment.

    A temporary allow lifts an ``ask`` (reported with ``until``) but never a ``block``.
    """

    now = now or timezone.now()
    allows = live_temporary_allows(grant.temporary_allows, now)
    access = {}
    for name in APP_CLASSES:
        effect = class_effect(grant.connection.policy, name)
        entry = {"effect": effect}
        if effect == "ask":
            until = max(
                (
                    _allow_expiry(allow)
                    for allow in allows
                    if allow.get("class") == name
                ),
                default=None,
            )
            if until is not None:
                entry = {"effect": "allow", "until": iso_timestamp(until)}
        access[name] = entry
    return access


def app_grants(workflow, now=None):
    """The Workflow's grants of app Connections that are in force."""

    return AgentWorkflowGrant.objects.active(now or timezone.now()).filter(
        workflow=workflow,
        organisation_id=workflow.organisation_id,
        connection__service_type=APP_SERVICE_TYPE,
        connection__deleted_at__isnull=True,
        connection__state=AgentConnection.ACTIVE,
        connection__app__isnull=False,
        connection__app__organisation_id=workflow.organisation_id,
    )


def _covering(queryset, environment):
    return (
        queryset.filter(
            connection__app_id=environment.app_id,
            connection__app_environments__environment=environment,
        )
        .select_related("connection")
        .distinct()
        .order_by("created_at", "id")
    )


def connection_environments(connection):
    return list(
        Environment.objects.filter(agent_connections__connection=connection).order_by(
            "index", "name", "id"
        )
    )


def _environment_entry(environment):
    return {
        "id": str(environment.id),
        "name": environment.name,
        "env_type": environment.env_type,
    }


def app_access_entries(workflow, now=None):
    """What a Workflow can use right now, one entry per grant, in the
    runtime API's snake_case spelling."""

    now = now or timezone.now()
    grants = (
        app_grants(workflow, now)
        .select_related("connection__app")
        .order_by("created_at", "id")
    )
    return [
        {
            "connection_id": str(grant.connection_id),
            "connection_name": grant.connection.name,
            "grant_id": str(grant.id),
            "app": {
                "id": str(grant.connection.app_id),
                "name": grant.connection.app.name,
            },
            "environments": [
                _environment_entry(environment)
                for environment in connection_environments(grant.connection)
            ],
            "access": grant_access(grant, now),
            "grant_expires_at": iso_timestamp(grant.expires_at),
        }
        for grant in grants
    ]


def _expired_grants(workflow, now):
    return (
        AgentWorkflowGrant.objects.filter(workflow=workflow)
        .expired(now)
        .filter(
            expires_at__gt=now - RENEWAL_WINDOW,
            connection__service_type=APP_SERVICE_TYPE,
            connection__deleted_at__isnull=True,
            connection__state=AgentConnection.ACTIVE,
            connection__app__isnull=False,
        )
    )


def expired_app_access(workflow, now=None):
    """App Connections this Workflow lost to an expiry in the renewal window
    and has not been granted again, newest first."""

    now = now or timezone.now()
    held = set(app_grants(workflow, now).values_list("connection_id", flat=True))
    listed = {}
    for grant in (
        _expired_grants(workflow, now)
        .select_related("connection__app")
        .order_by("-expires_at", "id")
    ):
        if grant.connection_id in held or grant.connection_id in listed:
            continue
        listed[grant.connection_id] = {
            "connection_id": str(grant.connection_id),
            "connection_name": grant.connection.name,
            "app": {
                "id": str(grant.connection.app_id),
                "name": grant.connection.app.name,
            },
            "expired_at": iso_timestamp(grant.expires_at),
        }
    return list(listed.values())


@dataclass
class Decision:
    """The answer to one call: ``allow``, ``ask``, ``block``, or ``missing``
    / ``expired`` when no grant covers the environment."""

    effect: str
    access_class: str
    grant: AgentWorkflowGrant | None = None
    until: str | None = None


def decide(workflow, environment, access_class, now=None):
    """Decide one call of a class in an environment for a Workflow.

    Allowed if any covering grant allows it, else ``ask`` if any asks, else blocked.
    """

    now = now or timezone.now()
    grants = list(_covering(app_grants(workflow, now), environment))
    if not grants:
        expired = (
            _covering(_expired_grants(workflow, now), environment)
            .order_by("-expires_at", "id")
            .first()
        )
        if expired is not None:
            return Decision("expired", access_class, expired)
        return Decision("missing", access_class)
    answers = [(grant, grant_access(grant, now)[access_class]) for grant in grants]
    for effect in ("allow", "ask", "block"):
        for grant, entry in answers:
            if entry["effect"] == effect:
                return Decision(effect, access_class, grant, entry.get("until"))
    raise AssertionError("unreachable")


def readable_environment_ids(workflow, now=None):
    """Environments whose secrets this Workflow may read right now."""

    now = now or timezone.now()
    readable = set()
    for grant in app_grants(workflow, now).select_related("connection"):
        if grant_access(grant, now)["read"]["effect"] == "allow":
            readable.update(
                str(environment_id)
                for environment_id in AgentConnectionEnvironment.objects.filter(
                    connection_id=grant.connection_id,
                    environment__app_id=grant.connection.app_id,
                ).values_list("environment_id", flat=True)
            )
    return readable


class AgentSecretsReader:
    """The account a secret reference is checked against for an Agent: it
    reaches an environment only while the Workflow may read it."""

    def __init__(self, workflow, now=None):
        self.workflow = workflow
        self.now = now or timezone.now()
        self._readable = None

    def can_read_environment(self, environment_id):
        if self._readable is None:
            self._readable = readable_environment_ids(self.workflow, self.now)
        return str(environment_id) in self._readable


# Requests an Agent can send to get past a refusal, in the wire's spelling.


def _title(text):
    # Request titles are capped at 120 characters.
    return text if len(text) <= 120 else f"{text[:119].rstrip()}…"


def app_access_request(environment, access_class):
    level = "Read" if access_class == "read" else "Read and write"
    return {
        "kind": "setup",
        "title": _title(
            f"{level} secrets in {environment.app.name} ({environment.name})"
        ),
        "action": {
            "type": "agent_connection.app_access",
            "version": 1,
            "appId": str(environment.app_id),
            "environments": [environment.name],
            "access": "read" if access_class == "read" else "read_write",
        },
    }


def renew_request(grant):
    return {
        "kind": "access_change",
        "title": _title(f"Renew access to {grant.connection.name}"),
        "action": {
            "type": "agent_grant.renew",
            "version": 1,
            "connectionId": str(grant.connection_id),
        },
    }


def allow_request(grant, classes):
    return {
        "kind": "access_change",
        "title": _title(
            f"Allow {describe_classes(classes)} secrets on {grant.connection.name}"
        ),
        "action": {
            "type": "agent_grant.allow",
            "version": 1,
            "connectionId": str(grant.connection_id),
            "allow": {"classes": list(classes)},
        },
    }


# Choosing an app and its environments, and who may give an Agent access.


def resolve_app(organisation_id, *, app_id=None, app_name=None):
    """The organisation's app named by id, or by an exact name in any case."""

    apps = App.objects.filter(
        organisation_id=organisation_id, is_deleted=False, deleted_at__isnull=True
    )
    if app_id is not None:
        if not isinstance(app_id, str) or not app_id or len(app_id) > 64:
            raise AppAccessError("appId must be an app identifier.")
        app = apps.filter(id=app_id).first()
    else:
        if not isinstance(app_name, str) or not app_name.strip() or len(app_name) > 64:
            raise AppAccessError("appName must contain 1-64 characters.")
        matches = list(apps.filter(name__iexact=app_name.strip())[:2])
        if len(matches) > 1:
            raise AppAccessError(
                f"More than one app is named '{app_name.strip()}'; name it by appId.",
                code="app_name_ambiguous",
            )
        app = matches[0] if matches else None
    if app is None:
        raise AppAccessError(
            "No app with that name or id exists in this organisation.",
            code="app_not_found",
            not_found=True,
        )
    return app


def require_sse(app):
    if not app.sse_enabled:
        raise AppAccessError(SSE_REQUIRED_MESSAGE, code="sse_required")
    return app


def resolve_environments(app, values, *, names=False, name_app=False):
    """The app's environments a list names, by id or, with ``names``, by
    exact name in any case. Each needs a server key. A refusal names the app
    only with ``name_app``, for a caller known to see it."""

    label = "environments" if names else "environmentIds"
    if (
        not isinstance(values, list)
        or not values
        or any(not isinstance(value, str) or not value or len(value) > 64 for value in values)
    ):
        raise AppAccessError(f"{label} must list at least one environment.")
    if len(values) > MAX_ENVIRONMENTS:
        raise AppAccessError(
            f"{label} may list at most {MAX_ENVIRONMENTS} environments.",
            code="too_many_environments",
        )
    candidates = list(Environment.objects.filter(app=app, deleted_at__isnull=True))
    chosen = []
    for value in values:
        match = next(
            (environment for environment in candidates if str(environment.id) == value),
            None,
        )
        if match is None and names:
            match = next(
                (
                    environment
                    for environment in candidates
                    if environment.name.lower() == value.strip().lower()
                ),
                None,
            )
        if match is None:
            named = f"The app '{app.name}'" if name_app else "The app"
            raise AppAccessError(
                f"{named} has no environment '{value}'.",
                code="environment_not_found",
                not_found=True,
            )
        if match in chosen:
            raise AppAccessError(f"{label} names '{match.name}' more than once.")
        chosen.append(match)
    keyed = set(
        ServerEnvironmentKey.objects.filter(
            environment__in=chosen, deleted_at__isnull=True
        ).values_list("environment_id", flat=True)
    )
    for environment in chosen:
        if environment.id not in keyed:
            raise AppAccessError(
                f"The environment '{environment.name}' has no server-side key, "
                "which Agent access needs.",
                code="sse_required",
            )
    return sorted(chosen, key=lambda environment: (environment.index, environment.name))


def check_app_connection(connection):
    """What an app Connection must still satisfy to be granted: an SSE app
    of its organisation, and environments of that app with server keys."""

    app = connection.app
    if app is None or app.is_deleted or app.deleted_at is not None:
        raise AppAccessError("The app this Connection covers no longer exists.")
    if str(app.organisation_id) != str(connection.organisation_id):
        raise AppAccessError("The app belongs to another organisation.")
    require_sse(app)
    environments = connection_environments(connection)
    if not environments:
        raise AppAccessError("This Connection covers no environment.")
    return app, resolve_environments(
        app, [str(environment.id) for environment in environments]
    )


def require_member_can_release(member, app, environments, classes):
    """A member may give an Agent only secrets they can reach themselves.

    That needs access to the app and every environment, and the ``Secrets`` permission per class.
    """

    if member is None:
        raise AppAccessError(
            "Only a member can give an Agent access to secrets.", code="forbidden"
        )
    if role_has_global_access(member.role):

        def permitted(name):
            return role_has_permission(member.role, name, "Secrets", True)

    else:
        # The same check decides which names the member sees, so these
        # messages name nothing they could not see.
        visibility = asset_visibility(member)
        if not visibility.can_see_app(app.id):
            raise AppAccessError(
                "You don't have access to this app.", code="forbidden"
            )
        for environment in environments:
            if not visibility.can_see_environment(app.id, environment.id):
                raise AppAccessError(
                    "You don't have access to every environment this covers "
                    f"in '{app.name}'.",
                    code="forbidden",
                )

        def permitted(name):
            return user_has_permission(
                member.user, name, "Secrets", app.organisation, True, app=app
            )

    for name in ordered_classes({"read", *classes}):
        if not permitted(name):
            raise AppAccessError(
                f"You don't have permission to {name} secrets in '{app.name}', "
                "which this would let an Agent do.",
                code="forbidden",
            )


def require_member_can_release_grant(member, connection, temporary_classes=()):
    """``require_member_can_release`` for granting an app Connection as its
    policy stands, plus any temporary allows the grant will carry."""

    app, environments = check_app_connection(connection)
    require_member_can_release(
        member,
        app,
        environments,
        released_classes(connection.policy, temporary_classes),
    )
    return app, environments


def set_connection_environments(connection, environments):
    """Make a Connection cover exactly these environments."""

    wanted = {str(environment.id) for environment in environments}
    connection.app_environments.exclude(environment_id__in=wanted).delete()
    have = set(
        str(value)
        for value in connection.app_environments.values_list(
            "environment_id", flat=True
        )
    )
    AgentConnectionEnvironment.objects.bulk_create(
        [
            AgentConnectionEnvironment(connection=connection, environment=environment)
            for environment in environments
            if str(environment.id) not in have
        ]
    )


def _rule_key(rule):
    return sorted((str(name), str(value)) for name, value in rule.items())


def has_default_policy(stored_policy):
    """Whether a Connection's rules are exactly those a new app Connection
    starts with, in any order."""

    policy = full_policy(stored_policy)
    default = full_policy(DEFAULT_POLICY)
    return policy["default"] == default["default"] and sorted(
        map(_rule_key, policy["rules"])
    ) == sorted(map(_rule_key, default["rules"]))


def reusable_connection(organisation_id, app, environments, *, lock=False):
    """An active app Connection of the organisation with the same app,
    exactly these environments and the default rules, if there is one; locked
    with ``lock``. Approving app access reuses only such a Connection, so the
    Agent gets the access the reviewer saw."""

    connections = AgentConnection.objects.filter(
        organisation_id=organisation_id,
        service_type=APP_SERVICE_TYPE,
        app=app,
        deleted_at__isnull=True,
        state=AgentConnection.ACTIVE,
    ).order_by("created_at", "id")
    if lock:
        connections = connections.select_for_update(of=("self",))
    wanted = {str(environment.id) for environment in environments}
    for connection in connections:
        if not has_default_policy(connection.policy):
            continue
        have = {
            str(value)
            for value in connection.app_environments.values_list(
                "environment_id", flat=True
            )
        }
        if have == wanted:
            return connection
    return None


_NAME_LENGTH = 255


def connection_name(app, environments):
    """A name for a new app Connection, unique among the organisation's
    Connections: a number follows the name when it is taken."""

    names = ", ".join(environment.name for environment in environments)
    base = f"{app.name} secrets ({names})"
    taken = {
        name.lower()
        for name in AgentConnection.objects.filter(
            organisation_id=app.organisation_id,
            deleted_at__isnull=True,
            name__istartswith=base[: _NAME_LENGTH - 16],
        ).values_list("name", flat=True)
    }
    number = 1
    while True:
        suffix = "" if number == 1 else f" {number}"
        limit = _NAME_LENGTH - len(suffix)
        name = (base if len(base) <= limit else f"{base[: limit - 1]}…") + suffix
        if name.lower() not in taken:
            return name
        number += 1
