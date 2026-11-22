"""Request actions that change a Workflow's access to a Connection it has, or
recently had: a renewal, and a temporary allow for a call the Connection's
policy stopped.
"""

import re
from uuid import uuid4

from django.db import transaction
from django.utils import timezone

from api.models import AgentRequest, AgentWorkflowGrant
from api.utils.agent_access import (
    AccessError,
    access_record,
    connection_takes_policy,
    grant_connection_access,
    iso_timestamp,
    lock_grantable_connection,
    renewable_grant,
)
from api.utils.agent_app_access import (
    APP_CLASSES,
    AppAccessError,
    blocked_classes,
    check_app_connection,
    describe_classes,
    ordered_classes,
    require_member_can_release,
)
from api.utils.agent_config import (
    ConfigRegistryError,
    is_app_service,
    is_custom_service,
    service_for_connection,
)
from api.utils.agent_config.access_policy import (
    CREDENTIAL_MINTING,
    USER_CLASSES,
    PolicyError,
    allow_is_blocked,
    full_policy,
    is_minting_operation,
    live_temporary_allows,
    takes_operations,
    validate_allow,
)
from api.utils.agent_sessions import refresh_workflow_sessions

from . import ActionError, ActionHandler, AppliedAction, fit_title, register
from .agent_connections import (
    _ID,
    _app_asset,
    _connection_name,
    _connection_errors,
    _granted,
    _granted_access,
    _inputs,
    _locked_target,
    _members,
    _point_at,
    _references,
    _refuse_added_environments,
    _refuse_credential_text,
    _refuse_removed_since,
    _require,
)


# A grant holds at most this many temporary allows that have not expired.
MAX_TEMPORARY_ALLOWS = 50

_CONTROL_CHARACTER = re.compile(r"[\x00-\x1f\x7f-\x9f]")
# The members of ``blockedCall`` and the longest value each may have.
_BLOCKED_CALL_MEMBERS = {
    "method": 32,
    "host": 512,
    "path": 4096,
    "class": 32,
    # The AWS action of the call, when the proxy could name it.
    "operation": 200,
}
_BLOCKED_CALL_CLASSES = frozenset({*USER_CLASSES, CREDENTIAL_MINTING})


def _refresh_after_commit(workflow_id):
    """Tell the Workflow's live sessions to fetch their config again once the
    approval commits. The runtime locks a session and then a grant, so touching
    session rows while this transaction holds the grant lock would take the two
    in the opposite order."""

    transaction.on_commit(lambda: refresh_workflow_sessions([workflow_id]))


def _blocked_call(value):
    """The call the proxy stopped: context for the reviewer, kept as given."""

    if not isinstance(value, dict):
        raise ActionError("action.blockedCall must be an object.")
    unknown = sorted(str(key) for key in set(value) - set(_BLOCKED_CALL_MEMBERS))
    if unknown:
        raise ActionError(f"action.blockedCall.{unknown[0]} is not accepted.")
    checked = {}
    for key, maximum in _BLOCKED_CALL_MEMBERS.items():
        item = value.get(key)
        if item is None:
            continue
        if (
            not isinstance(item, str)
            or not item
            or len(item) > maximum
            or _CONTROL_CHARACTER.search(item)
        ):
            raise ActionError(
                f"action.blockedCall.{key} must be 1-{maximum} characters of "
                "plain text."
            )
        checked[key] = item
    if "class" in checked and checked["class"] not in _BLOCKED_CALL_CLASSES:
        raise ActionError("action.blockedCall.class is not a known class.")
    return checked


def _operation_classes(connection):
    """How the calls of an HTTP Connection are classified by method and path,
    which the Console can apply. None for AWS, whose calls only the proxy
    classifies, by their action."""

    if takes_operations(connection.service_type):
        return None
    try:
        return service_for_connection(connection).get("operation_classes", [])
    except ConfigRegistryError:
        return None


def _app_allow(value):
    """What a temporary allow on an app Connection covers: one class, or
    several that end together."""

    if not isinstance(value, dict):
        raise ActionError("action.allow must be an object.", code="invalid_access_allow")
    if set(value) == {"class"}:
        names = [value["class"]]
    elif set(value) == {"classes"} and isinstance(value["classes"], list):
        names = value["classes"]
    else:
        raise ActionError(
            "action.allow on an app Connection is {\"classes\": [...]} or "
            "{\"class\": ...}, naming read, create, update or delete.",
            code="invalid_access_allow",
        )
    if (
        not names
        or any(not isinstance(name, str) or name not in APP_CLASSES for name in names)
        or len(set(names)) != len(names)
    ):
        raise ActionError(
            "action.allow names each of read, create, update or delete at most once.",
            code="invalid_access_allow",
        )
    if "class" in value:
        return {"class": names[0]}
    return {"classes": ordered_classes(names)}


def _allow_classes(allow):
    return [allow["class"]] if "class" in allow else list(allow["classes"])


def _refuse_blocked(connection, allow):
    if is_app_service(connection.service_type):
        blocked = blocked_classes(connection.policy, _allow_classes(allow))
        if blocked:
            raise ActionError(
                f"The access rules of '{connection.name}' block "
                f"{describe_classes(blocked)} calls, and a temporary allow never "
                "changes a block. A member has to change those rules first.",
                code="access_policy_blocks_allow",
            )
        return
    if allow_is_blocked(
        connection.policy, allow, operation_classes=_operation_classes(connection)
    ):
        raise ActionError(
            "This Connection's access policy blocks that call, and a temporary "
            "allow never changes a block. A member has to change the policy.",
            code="access_policy_blocks_allow",
        )


def _require_app_release(member, connection, classes):
    """Section of the approver check for an app Connection: the member must
    reach its app and environments and may do what the Agent is allowed."""

    try:
        app, environments = check_app_connection(connection)
        require_member_can_release(member, app, environments, classes)
    except AppAccessError as exc:
        raise ActionError(str(exc), code=exc.code) from exc


def _describe_allow(allow, connection=None):
    if connection is not None and is_app_service(connection.service_type):
        return f"{describe_classes(_allow_classes(allow))} secrets"
    if "class" in allow:
        return f"{allow['class']} calls"
    if "operation" in allow:
        return f"AWS action {allow['operation']}"
    match = allow["match"]
    return " ".join(
        part
        for part in ("/".join(match.get("methods", [])), match.get("path", ""))
        if part
    )


def _app_summary(connection, view):
    if view is None:
        from api.utils.agent_app_access import connection_environments
        from api.utils.asset_visibility import AppView

        view = AppView(
            app=connection.app,
            environments=tuple(connection_environments(connection)),
        )
    return {
        "app": (
            None if view.app is None else {"id": str(view.app.id), "name": view.app.name}
        ),
        "appRestricted": view.app_restricted,
        "environments": [
            {
                "id": str(environment.id),
                "name": environment.name,
                "envType": environment.env_type,
            }
            for environment in view.environments
        ],
        "hiddenEnvironmentCount": view.hidden_environment_count,
    }


class AllowCall(ActionHandler):
    """Let a call through, for one Workflow, that the Connection's policy
    answers with ``ask``."""

    type = "agent_grant.allow"
    kind = AgentRequest.ACCESS_CHANGE
    takes_duration = True

    def validate(self, request, action, member):
        _members(action, required=("connectionId", "allow"), optional=("blockedCall",))
        grant = _granted(request, action["connectionId"])
        if not connection_takes_policy(grant.connection):
            raise ActionError(
                "Access policies apply only to HTTP Connections.",
                code="access_policy_not_supported",
            )
        if is_app_service(grant.connection.service_type):
            allow = _app_allow(action["allow"])
        else:
            try:
                allow = validate_allow(
                    action["allow"],
                    "action.allow",
                    operations=takes_operations(grant.connection.service_type),
                )
            except PolicyError as exc:
                raise ActionError(str(exc), code="invalid_access_allow") from exc
        checked = {
            "type": self.type,
            "version": action["version"],
            "connectionId": action["connectionId"],
            "allow": allow,
        }
        if action.get("blockedCall") is not None:
            checked["blockedCall"] = blocked = _blocked_call(action["blockedCall"])
            if blocked.get("class") == CREDENTIAL_MINTING or is_minting_operation(
                blocked.get("operation")
            ):
                raise ActionError(
                    "The secret guard blocks calls that mint credentials, and "
                    "nothing overrides it.",
                    code="secret_guard_blocks_call",
                )
        _refuse_blocked(grant.connection, allow)
        _refuse_credential_text(checked)
        _point_at(request, grant)
        return checked

    def asset(self, request, action):
        return _app_asset(request)

    def describe(self, request, action, member, view=None):
        connection, grant = request.connection, request.grant
        name = _connection_name(connection, view)
        current = None
        if grant is not None and connection is not None:
            current = {
                "name": name,
                # The Connection's rules, and what this Workflow has already
                # been allowed past them.
                "policy": full_policy(connection.policy),
                "temporaryAllows": live_temporary_allows(
                    grant.temporary_allows, timezone.now()
                ),
            }
            if is_app_service(connection.service_type):
                current.update(_app_summary(connection, view))
        return {
            "type": self.type,
            "title": fit_title(
                f"Allow {_describe_allow(action['allow'], connection)} on "
                f"{_connection_name(connection, view, in_title=True)}"
            ),
            "requiresSecret": False,
            "current": current,
            "requested": {
                "allow": action["allow"],
                "blockedCall": action.get("blockedCall"),
                "durationSeconds": request.duration_seconds,
            },
        }

    def apply(self, request, action, member, inputs):
        _require(member, "read")
        # A temporary allow always expires, within what an Agent may ask for.
        seconds, expires_at, inputs = _granted_access(
            request, inputs, allow_until_revoked=False, organisation_maximum=True
        )
        _inputs(inputs)
        connection = _locked_target(request)
        grant = (
            AgentWorkflowGrant.objects.select_for_update(of=("self",))
            .active()
            .get(id=request.grant_id)
        )
        # The policy may have changed since the request was filed.
        _refuse_blocked(connection, action["allow"])
        now = timezone.now()
        allows = live_temporary_allows(grant.temporary_allows, now)
        if is_app_service(connection.service_type):
            from .agent_app_access import merge_temporary_allows, write_expiry

            classes = _allow_classes(action["allow"])
            _refuse_added_environments(request, connection)
            _require_app_release(member, connection, classes)
            # One entry per class, all ending together and never after the
            # grant.
            expires_at = write_expiry(grant, seconds, now)
            merge_temporary_allows(grant, classes, expires_at, str(request.id), now)
        else:
            if len(allows) >= MAX_TEMPORARY_ALLOWS:
                raise ActionError(
                    f"This grant already has {MAX_TEMPORARY_ALLOWS} temporary allows."
                )
            grant.temporary_allows = [
                *allows,
                {
                    "id": str(uuid4()),
                    **action["allow"],
                    "expiresAt": iso_timestamp(expires_at),
                    "requestId": str(request.id),
                },
            ]
        grant.save(update_fields=["temporary_allows", "updated_at"])
        _refresh_after_commit(request.workflow_id)
        return AppliedAction(
            action={**action, "access": access_record(request, seconds, expires_at)},
            runtime_action="retry",
            references=_references(request.connection_id, grant.id),
        )


class RenewAccess(ActionHandler):
    """Extend a Workflow's grant of a Connection, or give back one that
    ended within the renewal window."""

    type = "agent_grant.renew"
    kind = AgentRequest.ACCESS_CHANGE
    takes_duration = True

    def _target(self, request, connection_id):
        if not isinstance(connection_id, str) or not _ID.fullmatch(connection_id):
            raise ActionError(
                "action.connectionId must be a Connection identifier.",
                code="connection_id_required",
            )
        grant = renewable_grant(request.workflow_id, connection_id)
        if grant is None or str(grant.organisation_id) != str(request.organisation_id):
            raise ActionError(
                "This Workflow has not had that Connection in the last 30 days.",
                code="connection_not_renewable",
                not_found=True,
            )
        if not request._state.adding and str(request.connection_id) != connection_id:
            raise ActionError("An approved action must keep the Connection it named.")
        return grant

    def validate(self, request, action, member):
        _members(action, required=("connectionId",))
        _point_at(request, self._target(request, action["connectionId"]))
        return {
            "type": self.type,
            "version": action["version"],
            "connectionId": action["connectionId"],
        }

    def asset(self, request, action):
        return _app_asset(request)

    def describe(self, request, action, member, view=None):
        connection = request.connection
        name = _connection_name(connection, view)
        current = None
        if connection is not None:
            grant = renewable_grant(request.workflow_id, connection.id)
            current = {
                "name": name,
                "state": (
                    "none"
                    if grant is None
                    else "active" if grant.is_active else "expired"
                    if grant.expires_at and grant.expires_at <= timezone.now()
                    else "revoked"
                ),
                "expiresAt": iso_timestamp(grant.expires_at) if grant else None,
            }
        return {
            "type": self.type,
            "title": fit_title(
                f"Renew access to {_connection_name(connection, view, in_title=True)}"
            ),
            "requiresSecret": False,
            "current": current,
            "requested": {"durationSeconds": request.duration_seconds},
        }

    def apply(self, request, action, member, inputs):
        _require(member, "read")
        seconds, expires_at, inputs = _granted_access(request, inputs)
        _inputs(inputs)
        try:
            connection = lock_grantable_connection(
                request.organisation_id, request.connection_id
            )
        except AccessError as exc:
            raise ActionError(
                "The Agent Connection changed; start a new request"
            ) from exc
        if not is_app_service(connection.service_type) and not is_custom_service(
            connection.service_type
        ):
            # The Workflow keeps the Connection's Integration Credential.
            _require(member, "read", "IntegrationCredentials")
        _refuse_removed_since(request, connection, connection_id=connection.id)
        renewed = self._target(request, action["connectionId"])
        if is_app_service(connection.service_type):
            # Renewing gives back what the policy allows and any temporary
            # allow still running.
            from api.utils.agent_app_access import released_classes

            _require_app_release(
                member,
                connection,
                released_classes(
                    connection.policy,
                    [
                        allow.get("class")
                        for allow in live_temporary_allows(
                            renewed.temporary_allows, timezone.now()
                        )
                    ],
                ),
            )
        with _connection_errors():
            grant, created = grant_connection_access(
                request.workflow,
                connection,
                member,
                expires_at=expires_at,
                extend=True,
            )
        _refresh_after_commit(request.workflow_id)
        request.grant = grant
        return AppliedAction(
            action={
                **action,
                # An extension never brings an expiry forward, so this is what
                # the grant ends up with.
                "access": access_record(request, seconds, grant.expires_at),
            },
            runtime_action="restart_required" if created else "retry",
            references=_references(connection.id, grant.id),
        )


for _handler in (AllowCall(), RenewAccess()):
    register(_handler)
