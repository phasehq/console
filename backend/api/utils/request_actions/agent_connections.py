"""Request actions that change the Connections of an Agent Workflow.

A request can only name a Connection its Workflow is granted, and never carries a secret:
the approver enters one where needed.
"""

from contextlib import contextmanager
import hashlib
import json
import re

from django.core.exceptions import ValidationError
from django.db.models import F, Q

from api.models import AgentConnection, AgentRequest, AgentWorkflowGrant
from api.utils.access.permissions import role_has_permission
from api.utils.agent_access import (
    DurationError,
    access_record,
    end_connection_access,
    grant_connection_access,
    granted_duration,
)
from api.utils.agent_config import (
    HTTP_SERVICE_TYPE,
    ConfigRegistryError,
    PresetError,
    expand_preset,
    is_app_service,
    is_custom_service,
    upgrade_definition,
    validate_definition,
)
from api.utils.agent_config.http_definition import bound_hosts, secret_field_names
from api.utils.agent_connection_values import (
    SealedValueError,
    activate_custom_connection,
    adds_agent_visible_text,
    update_custom_connection,
    write_custom_connection_value,
)
from api.utils.agent_sessions import refresh_workflow_sessions

from . import (
    ActionError,
    ActionHandler,
    AppliedAction,
    contains_credential_text,
    fit_title,
    register,
)


_ID = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
_CONTROL_CHARACTER = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_MAX_NAME_LENGTH = 255
# The request row keeps a short display name beside the action.
_MAX_DISPLAY_NAME_LENGTH = 64


def _members(action, *, required=(), optional=()):
    allowed = {"type", "version", *required, *optional}
    unknown = sorted(str(key) for key in set(action) - allowed)
    if unknown:
        raise ActionError(
            f"action.{unknown[0]} is not accepted for {action['type']}."
        )
    missing = sorted(key for key in required if action.get(key) is None)
    if missing:
        raise ActionError(f"action.{missing[0]} is required for {action['type']}.")


def _name(value):
    name = value.strip() if isinstance(value, str) else ""
    if (
        not name
        or len(name) > _MAX_NAME_LENGTH
        or _CONTROL_CHARACTER.search(name)
    ):
        raise ActionError(
            f"action.name must contain 1-{_MAX_NAME_LENGTH} characters."
        )
    return name


def _definition(value):
    try:
        return validate_definition(value)
    except ConfigRegistryError as exc:
        raise ActionError(str(exc), code="invalid_connection_definition") from exc


def _refuse_credential_text(action):
    if contains_credential_text(action):
        raise ActionError(
            "An action must not contain credential-shaped values.",
            code="credential_in_request_action",
        )


def _granted(request, connection_id):
    """The request's Workflow's active grant of the Connection an action names."""

    if not isinstance(connection_id, str) or not _ID.fullmatch(connection_id):
        raise ActionError(
            "action.connectionId must be a Connection identifier.",
            code="connection_id_required",
        )
    grant = (
        AgentWorkflowGrant.objects.select_related("connection__authentication")
        .active()
        .filter(
            workflow_id=request.workflow_id,
            organisation_id=request.organisation_id,
            connection_id=connection_id,
            connection__deleted_at__isnull=True,
        )
        .first()
    )
    if grant is None:
        raise ActionError(
            "The requested Connection is not bound to this Workflow.",
            code="connection_not_in_workflow",
            not_found=True,
        )
    if not request._state.adding and str(request.connection_id) != connection_id:
        raise ActionError("An approved action must keep the Connection it named.")
    return grant


def _custom(grant):
    if not is_custom_service(grant.connection.service_type):
        raise ActionError(
            "This action applies only to custom HTTP Connections.",
            code="connection_not_custom",
        )
    return grant


def _digest(config):
    return hashlib.blake2b(
        json.dumps(config, sort_keys=True, separators=(",", ":")).encode(),
        digest_size=16,
    ).hexdigest()


def _point_at(request, grant):
    """Record the target on a request that is about to be filed."""

    if not request._state.adding:
        return
    connection = grant.connection
    request.connection = connection
    request.grant = grant
    request.service_type = connection.service_type
    request.credential_provider = (
        connection.authentication.provider
        if connection.authentication_id
        else connection.service_type
    )
    request.credential_name = connection.name[:_MAX_DISPLAY_NAME_LENGTH]
    request.progress = {
        **(request.progress or {}),
        "connection_id": str(connection.id),
        "baseline_grant_id": str(grant.id),
        "baseline_definition": _digest(connection.config),
    }
    if is_app_service(connection.service_type):
        # What the Connection covered when the request was made.
        request.progress["baseline_environments"] = _environment_ids(connection)


def _environment_ids(connection):
    return sorted(
        str(value)
        for value in connection.app_environments.values_list(
            "environment_id", flat=True
        )
    )


def _refuse_added_environments(request, connection):
    """An approval covers the environments the request was made for. One added
    to the Connection since then needs a request of its own."""

    asked = (request.progress or {}).get("baseline_environments")
    if not isinstance(asked, list) or set(_environment_ids(connection)) - set(asked):
        raise ActionError(
            "This Connection covers environments it did not when this request "
            "was made; start a new request"
        )


def _app_asset(request):
    connection = request.connection
    if connection is None or not is_app_service(connection.service_type):
        return None
    from api.utils.agent_app_access import connection_environments

    return connection.app, connection_environments(connection)


def _connection_name(connection, view, *, in_title=False):
    if connection is None:
        return "a Connection"
    if view is None or not view.mentions_withheld(connection.name):
        return connection.name
    if in_title and view.app is None:
        from api.utils.asset_visibility import WITHHELD_APP

        return f"a Connection to {WITHHELD_APP}"
    return view.connection_name(connection.name)


def _current(connection):
    if connection is None:
        return None
    current = {"name": connection.name}
    if is_custom_service(connection.service_type):
        try:
            current["definition"] = upgrade_definition(connection.config)
        except ConfigRegistryError:
            current["definition"] = None
    return current


def _require(member, action, resource="AgentConnections"):
    if member is None or not role_has_permission(member.role, action, resource):
        raise ActionError(
            f"You don't have permission to {action} {resource}", code="forbidden"
        )


def _inputs(inputs, *, required=(), optional=()):
    unknown = sorted(str(key) for key in set(inputs) - {*required, *optional})
    if unknown:
        raise ActionError(f"inputs.{unknown[0]} is not accepted for this action.")
    values = {}
    for key in (*required, *optional):
        value = inputs.get(key)
        if value is None and key in optional:
            continue
        if not isinstance(value, str) or not value:
            raise ActionError(f"inputs.{key} is required to approve this action.")
        values[key] = value
    return values


_DURATION_INPUTS = ("durationSeconds", "untilRevoked")


def _granted_access(request, inputs, **rules):
    """Split what a reviewer supplied into the duration they grant and the
    rest. Returns ``(seconds, expires_at, other_inputs)``."""

    try:
        seconds, expires_at = granted_duration(request, inputs, **rules)
    except DurationError as exc:
        raise ActionError(str(exc), code="invalid_duration") from exc
    return (
        seconds,
        expires_at,
        {key: value for key, value in inputs.items() if key not in _DURATION_INPUTS},
    )


@contextmanager
def _connection_errors():
    try:
        yield
    except (SealedValueError, ConfigRegistryError) as exc:
        raise ActionError(str(exc)) from exc
    except ValidationError as exc:
        raise ActionError("; ".join(exc.messages)) from exc


def _locked_target(request):
    """Lock the Connection a filed request targets and recheck its grant."""

    try:
        connection = AgentConnection.objects.select_for_update(of=("self",)).get(
            id=request.connection_id,
            organisation_id=request.organisation_id,
            deleted_at__isnull=True,
        )
    except AgentConnection.DoesNotExist as exc:
        raise ActionError(
            "The Agent Connection was deleted; start a new request"
        ) from exc
    baseline_grant_id = (request.progress or {}).get("baseline_grant_id")
    if (
        not baseline_grant_id
        or str(request.grant_id) != str(baseline_grant_id)
        or not AgentWorkflowGrant.objects.active()
        .filter(
            id=request.grant_id,
            workflow_id=request.workflow_id,
            connection_id=connection.id,
        )
        .exists()
    ):
        raise ActionError("The Agent Workflow Grant changed; start a new request")
    return connection


def _refuse_removed_since(request, connection=None, **scope):
    """Access a member took away after a request was made stays away: only a
    request made since then can give it back. ``scope`` picks the Workflow's
    grants that count.

    The Workflow's grant of ``connection`` in force is locked first, so a revoke of it that is
    still committing is waited for and then seen.
    """

    grants = AgentWorkflowGrant.objects.filter(workflow_id=request.workflow_id)
    if connection is not None:
        list(
            grants.filter(connection_id=connection.id)
            .active()
            .select_for_update(of=("self",))
            .values_list("id", flat=True)
        )
    if (
        grants.filter(deleted_at__gt=request.created_at, **scope)
        # Ended before it would have expired: a member's doing, not the clock's.
        .filter(Q(expires_at__isnull=True) | Q(deleted_at__lt=F("expires_at")))
        .exists()
    ):
        raise ActionError(
            "A member removed this access after this request was made; "
            "start a new request"
        )


def _custom_target(request):
    """Lock the custom Connection a filed request targets, and check it is
    still as it was when the request was made: a reviewer approves the
    definition they were shown."""

    connection = _locked_target(request)
    if (
        not is_custom_service(connection.service_type)
        or connection.state != AgentConnection.ACTIVE
    ):
        raise ActionError("The Agent Connection changed; start a new request")
    if _digest(connection.config) != (request.progress or {}).get(
        "baseline_definition"
    ):
        raise ActionError(
            "The Connection changed after this request was made; start a "
            "new request"
        )
    return connection


def _references(connection_id, grant_id):
    return {"connection_id": str(connection_id), "grant_id": str(grant_id)}


class CreateConnection(ActionHandler):
    type = "agent_connection.create"
    kind = AgentRequest.SETUP
    takes_duration = True

    def validate(self, request, action, member):
        _members(
            action,
            required=("serviceType", "name"),
            optional=("definition", "preset", "hosts"),
        )
        if action["serviceType"] != HTTP_SERVICE_TYPE:
            raise ActionError(
                "action.serviceType must be http; ask for a packaged service "
                "with a setup request that carries no action.",
                code="service_not_supported",
            )
        if (action.get("definition") is None) == (action.get("preset") is None):
            raise ActionError(
                "action must carry either a definition or a preset."
            )
        if action.get("preset") is not None:
            # Expanded when the request is filed, so the reviewer is shown an
            # ordinary definition and the stored action names no preset.
            try:
                definition = expand_preset(action["preset"], action.get("hosts"))
            except PresetError as exc:
                raise ActionError(
                    str(exc), code="invalid_connection_preset"
                ) from exc
            except ConfigRegistryError as exc:
                raise ActionError(
                    str(exc), code="invalid_connection_definition"
                ) from exc
        elif action.get("hosts") is not None:
            raise ActionError("action.hosts is accepted only with a preset.")
        else:
            definition = _definition(action["definition"])
        checked = {
            "type": self.type,
            "version": action["version"],
            "serviceType": HTTP_SERVICE_TYPE,
            "name": _name(action["name"]),
            "definition": definition,
        }
        _refuse_credential_text(checked)
        if request._state.adding:
            request.service_type = HTTP_SERVICE_TYPE
            request.credential_provider = HTTP_SERVICE_TYPE
            request.credential_name = checked["name"][:_MAX_DISPLAY_NAME_LENGTH]
        return checked

    def describe(self, request, action, member, view=None):
        return {
            "type": self.type,
            "title": fit_title(f"Add Connection: {action['name']}"),
            "requiresSecret": True,
            "current": None,
            "requested": {
                "name": action["name"],
                "definition": action["definition"],
                "durationSeconds": request.duration_seconds,
            },
        }

    def apply(self, request, action, member, inputs):
        _require(member, "create")
        seconds, expires_at, inputs = _granted_access(request, inputs)
        values = _inputs(
            inputs,
            required=("encryptionPublicKey", "sealedValue", "serverWrappedKey"),
        )
        connection = AgentConnection(
            organisation=request.organisation,
            name=action["name"],
            service_type=HTTP_SERVICE_TYPE,
        )
        with _connection_errors():
            activate_custom_connection(
                connection,
                definition=action["definition"],
                encryption_public_key=values["encryptionPublicKey"],
                server_wrapped_key=values["serverWrappedKey"],
                sealed_value=values["sealedValue"],
                member=member,
            )
            grant, _ = grant_connection_access(
                request.workflow, connection, member, expires_at=expires_at
            )
        refresh_workflow_sessions([request.workflow_id])
        request.connection = connection
        request.grant = grant
        request.credential_name = connection.name[:_MAX_DISPLAY_NAME_LENGTH]
        return AppliedAction(
            action={**action, "access": access_record(request, seconds, expires_at)},
            runtime_action="restart_required",
            references=_references(connection.id, grant.id),
        )


class UpdateConnection(ActionHandler):
    type = "agent_connection.update"
    kind = AgentRequest.CONNECTION_UPDATE

    def validate(self, request, action, member):
        _members(
            action, required=("connectionId",), optional=("name", "definition")
        )
        if action.get("name") is None and action.get("definition") is None:
            raise ActionError(
                "action must include a name, a definition, or both."
            )
        grant = _custom(_granted(request, action["connectionId"]))
        checked = {
            "type": self.type,
            "version": action["version"],
            "connectionId": action["connectionId"],
        }
        if action.get("name") is not None:
            checked["name"] = _name(action["name"])
        if action.get("definition") is not None:
            checked["definition"] = _definition(action["definition"])
        _refuse_credential_text(checked)
        _point_at(request, grant)
        return checked

    def _requested(self, action, current):
        return {
            "name": action.get("name", current["name"]),
            "definition": action.get("definition", current.get("definition")),
        }

    def describe(self, request, action, member, view=None):
        current = _current(request.connection)
        if current is None:
            return {
                "type": self.type,
                "title": "Change a Connection",
                "requiresSecret": False,
                "current": None,
                "requested": None,
            }
        requested = self._requested(action, current)
        before, after = current.get("definition"), requested["definition"]
        rebound = bool(
            before
            and after
            and (
                bound_hosts(before) != bound_hosts(after)
                or set(secret_field_names(before)) != set(secret_field_names(after))
                or (
                    bool(after.get("allowPlainHttp"))
                    and not before.get("allowPlainHttp")
                )
                or adds_agent_visible_text(before, after)
            )
        )
        if before and after and before["hosts"] != after["hosts"]:
            title = f"Change hosts on {current['name']}"
        elif before != after:
            title = f"Change {current['name']}"
        else:
            title = f"Rename {current['name']}"
        return {
            "type": self.type,
            "title": fit_title(title),
            "requiresSecret": rebound,
            "current": current,
            "requested": requested,
        }

    def apply(self, request, action, member, inputs):
        _require(member, "update")
        values = _inputs(inputs, optional=("sealedValue",))
        connection = _custom_target(request)
        with _connection_errors():
            changes = update_custom_connection(
                connection,
                member=member,
                name=action.get("name"),
                definition=action.get("definition"),
                sealed_value=values.get("sealedValue"),
            )
        request.credential_name = connection.name[:_MAX_DISPLAY_NAME_LENGTH]
        return AppliedAction(
            action=action,
            runtime_action=(
                "restart_required" if changes["environment_changed"] else "retry"
            ),
            references=_references(connection.id, request.grant_id),
        )


class UpdateConnectionSecret(ActionHandler):
    type = "agent_connection.secret_update"
    kind = AgentRequest.CREDENTIAL_UPDATE

    def validate(self, request, action, member):
        # No other member is accepted: this action asks for a secret and never
        # carries one.
        _members(action, required=("connectionId",))
        grant = _custom(_granted(request, action["connectionId"]))
        _point_at(request, grant)
        return {
            "type": self.type,
            "version": action["version"],
            "connectionId": action["connectionId"],
        }

    def describe(self, request, action, member, view=None):
        current = _current(request.connection)
        name = current["name"] if current else "a Connection"
        return {
            "type": self.type,
            "title": fit_title(f"Update the secret for {name}"),
            "requiresSecret": True,
            "current": current,
            "requested": None,
        }

    def apply(self, request, action, member, inputs):
        _require(member, "update")
        values = _inputs(inputs, required=("sealedValue",))
        connection = _custom_target(request)
        with _connection_errors():
            write_custom_connection_value(connection, values["sealedValue"], member)
        return AppliedAction(
            action=action,
            runtime_action="retry",
            references=_references(connection.id, request.grant_id),
        )


class RemoveConnection(ActionHandler):
    type = "agent_connection.remove"
    kind = AgentRequest.CONNECTION_REMOVAL

    def validate(self, request, action, member):
        _members(action, required=("connectionId",))
        _point_at(request, _granted(request, action["connectionId"]))
        return {
            "type": self.type,
            "version": action["version"],
            "connectionId": action["connectionId"],
        }

    def asset(self, request, action):
        return _app_asset(request)

    def describe(self, request, action, member, view=None):
        current = _current(request.connection)
        if current is not None:
            current["name"] = _connection_name(request.connection, view)
        name = _connection_name(request.connection, view, in_title=True)
        return {
            "type": self.type,
            "title": fit_title(f"Remove {name} from {request.workflow.name}"),
            "requiresSecret": False,
            "current": current,
            "requested": None,
        }

    def apply(self, request, action, member, inputs):
        # What revoking the grant directly needs.
        _require(member, "read")
        _inputs(inputs)
        # Only this Workflow's grant goes; the Connection and its other grants
        # stay as they are.
        ended = str(request.grant_id) == str(
            (request.progress or {}).get("baseline_grant_id")
        ) and end_connection_access(
            AgentWorkflowGrant.objects.filter(
                id=request.grant_id,
                workflow_id=request.workflow_id,
                connection_id=request.connection_id,
            )
        )
        if not ended:
            raise ActionError(
                "The Agent Workflow Grant changed; start a new request"
            )
        return AppliedAction(
            action=action,
            runtime_action="retry",
            references=_references(request.connection_id, request.grant_id),
        )


for _handler in (
    CreateConnection(),
    UpdateConnection(),
    UpdateConnectionSecret(),
    RemoveConnection(),
):
    register(_handler)
