"""Request actions that change a Workflow's access to a Connection it has, or
recently had: a renewal, and a temporary allow for a call its policy stopped.
"""

import re
from uuid import uuid4

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
from api.utils.agent_config import ConfigRegistryError, is_custom_service, load_definition
from api.utils.agent_config.access_policy import (
    CREDENTIAL_MINTING,
    USER_CLASSES,
    PolicyError,
    allow_is_blocked,
    full_policy,
    live_temporary_allows,
    validate_allow,
)
from api.utils.agent_sessions import refresh_workflow_sessions

from . import ActionError, ActionHandler, AppliedAction, fit_title, register
from .agent_connections import (
    _ID,
    _connection_errors,
    _granted,
    _granted_access,
    _inputs,
    _locked_target,
    _members,
    _point_at,
    _references,
    _refuse_credential_text,
    _require,
)


# A grant holds at most this many temporary allows that have not expired.
MAX_TEMPORARY_ALLOWS = 50

_CONTROL_CHARACTER = re.compile(r"[\x00-\x1f\x7f-\x9f]")
# The members of ``blockedCall`` and the longest value each may have.
_BLOCKED_CALL_MEMBERS = {"method": 32, "host": 512, "path": 4096, "class": 32}
_BLOCKED_CALL_CLASSES = frozenset({*USER_CLASSES, CREDENTIAL_MINTING})


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
    """A custom Connection's own classification, which the Console can apply.
    None for a packaged service, whose calls only the proxy classifies."""

    if not is_custom_service(connection.service_type):
        return None
    try:
        return load_definition(connection.config).get("operationClasses", [])
    except ConfigRegistryError:
        return None


def _refuse_blocked(grant, allow):
    if allow_is_blocked(
        grant.policy, allow, operation_classes=_operation_classes(grant.connection)
    ):
        raise ActionError(
            "This grant's access policy blocks that call, and a temporary "
            "allow never changes a block. A member has to change the policy.",
            code="access_policy_blocks_allow",
        )


def _describe_allow(allow):
    if "class" in allow:
        return f"{allow['class']} calls"
    match = allow["match"]
    return " ".join(
        part
        for part in ("/".join(match.get("methods", [])), match.get("path", ""))
        if part
    )


class AllowCall(ActionHandler):
    """Let a call through that the grant's policy answers with ``ask``."""

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
        try:
            allow = validate_allow(action["allow"], "action.allow")
        except PolicyError as exc:
            raise ActionError(str(exc), code="invalid_access_allow") from exc
        checked = {
            "type": self.type,
            "version": action["version"],
            "connectionId": action["connectionId"],
            "allow": allow,
        }
        if action.get("blockedCall") is not None:
            checked["blockedCall"] = _blocked_call(action["blockedCall"])
            if checked["blockedCall"].get("class") == CREDENTIAL_MINTING:
                raise ActionError(
                    "The secret guard blocks calls that mint credentials, and "
                    "nothing overrides it.",
                    code="secret_guard_blocks_call",
                )
        _refuse_blocked(grant, allow)
        _refuse_credential_text(checked)
        _point_at(request, grant)
        return checked

    def describe(self, request, action, member):
        connection, grant = request.connection, request.grant
        name = connection.name if connection else "a Connection"
        return {
            "type": self.type,
            "title": fit_title(f"Allow {_describe_allow(action['allow'])} on {name}"),
            "requiresSecret": False,
            "current": (
                None
                if grant is None
                else {
                    "name": name,
                    "policy": full_policy(grant.policy),
                    "temporaryAllows": live_temporary_allows(
                        grant.temporary_allows, timezone.now()
                    ),
                }
            ),
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
        _locked_target(request)
        grant = (
            AgentWorkflowGrant.objects.select_for_update(of=("self",))
            .select_related("connection")
            .active()
            .get(id=request.grant_id)
        )
        # The policy may have changed since the request was filed.
        _refuse_blocked(grant, action["allow"])
        allows = live_temporary_allows(grant.temporary_allows, timezone.now())
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
        refresh_workflow_sessions([request.workflow_id])
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

    def describe(self, request, action, member):
        connection = request.connection
        name = connection.name if connection else "a Connection"
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
            "title": fit_title(f"Renew access to {name}"),
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
        previous = self._target(request, action["connectionId"])
        with _connection_errors():
            # A grant given back keeps the policy the one before it had.
            grant, created = grant_connection_access(
                request.workflow,
                connection,
                member,
                expires_at=expires_at,
                policy=previous.policy,
                extend=True,
            )
        refresh_workflow_sessions([request.workflow_id])
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
