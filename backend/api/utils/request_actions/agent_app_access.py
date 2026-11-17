"""The request action that gives a Workflow an app's secrets.

The Agent names an app and some of its environments and asks to read, or to
read and write. A member approving it may narrow the environments, change the
access level and set how long it lasts. Approval grants the Workflow an app
Connection covering exactly those environments with the default rules,
reusing one the organisation already has only when its rules are still the
default, so the Agent gets what the reviewer saw.
"""

from datetime import timedelta
from uuid import uuid4

from django.utils import timezone

from api.models import AgentConnection, AgentOrganisationSettings, AgentRequest
from api.utils.agent_access import (
    MIN_DURATION_SECONDS,
    access_record,
    grant_connection_access,
    iso_timestamp,
)
from api.utils.agent_app_access import (
    ACCESS_LEVELS,
    DEFAULT_POLICY,
    WRITE_CLASSES,
    AppAccessError,
    connection_name,
    released_classes,
    require_member_can_release,
    require_sse,
    resolve_app,
    resolve_environments,
    reusable_connection,
    set_connection_environments,
)
from api.utils.agent_config import APP_SERVICE_TYPE
from api.utils.asset_visibility import WITHHELD_APP, AppView
from api.utils.agent_config.access_policy import full_policy, live_temporary_allows

from . import ActionError, ActionHandler, AppliedAction, fit_title, register
from .agent_connections import (
    _MAX_DISPLAY_NAME_LENGTH,
    _connection_errors,
    _granted_access,
    _members,
    _references,
    _refuse_credential_text,
    _require,
)
from .agent_grants import _refresh_after_commit


def _app_error(exc):
    return ActionError(str(exc), code=exc.code, not_found=exc.not_found)


def _level_title(access):
    return "Read and write" if access == "read_write" else "Read"


def merge_temporary_allows(grant, classes, expires_at, request_id, now):
    """Add one temporary allow per class, ending at ``expires_at``. A class
    keeps one entry: an approval never shortens the allow it already has."""

    allows = live_temporary_allows(grant.temporary_allows, now)
    stamp = iso_timestamp(expires_at)
    kept = []
    for allow in allows:
        name = allow.get("class")
        if name in classes and allow.get("expiresAt", "") <= stamp:
            continue
        kept.append(allow)
    present = {allow.get("class") for allow in kept}
    added = [
        {"id": str(uuid4()), "class": name, "expiresAt": stamp, "requestId": request_id}
        for name in classes
        if name not in present
    ]
    grant.temporary_allows = [*kept, *added]
    return added


def write_expiry(grant, seconds, now):
    """When write access ends: after its own duration, never after the grant."""

    expires_at = now + timedelta(seconds=seconds)
    if grant.expires_at is not None and grant.expires_at < expires_at:
        expires_at = grant.expires_at
    return expires_at


class AppAccess(ActionHandler):
    type = "agent_connection.app_access"
    kind = AgentRequest.SETUP
    takes_duration = True

    def validate(self, request, action, member):
        _members(
            action,
            required=("access",),
            optional=("appId", "appName", "environments", "environmentIds"),
        )
        if (action.get("appId") is None) == (action.get("appName") is None):
            raise ActionError("action must name the app by appId or by appName.")
        if (action.get("environments") is None) == (
            action.get("environmentIds") is None
        ):
            raise ActionError(
                "action must list environments by name (environments) or by id "
                "(environmentIds)."
            )
        if action["access"] not in ACCESS_LEVELS:
            raise ActionError("action.access must be read or read_write.")
        try:
            app = require_sse(
                resolve_app(
                    request.organisation_id,
                    app_id=action.get("appId"),
                    app_name=action.get("appName"),
                )
            )
            environments = resolve_environments(
                app,
                action.get("environments") or action.get("environmentIds"),
                names=action.get("environments") is not None,
            )
        except AppAccessError as exc:
            raise _app_error(exc) from exc
        checked = {
            "type": self.type,
            "version": action["version"],
            "appId": str(app.id),
            "environmentIds": [str(environment.id) for environment in environments],
            "access": action["access"],
        }
        if not request._state.adding:
            # A reviewer may narrow what was asked for, never widen it.
            asked = request.action or {}
            if checked["appId"] != asked.get("appId") or not set(
                checked["environmentIds"]
            ) <= set(asked.get("environmentIds") or []):
                raise ActionError(
                    "An approval may only narrow the environments that were "
                    "asked for, in the same app."
                )
        _refuse_credential_text(checked)
        if request._state.adding:
            request.service_type = APP_SERVICE_TYPE
            request.credential_provider = APP_SERVICE_TYPE
            request.credential_name = app.name[:_MAX_DISPLAY_NAME_LENGTH]
        return checked

    def _target(self, request, action):
        from api.models import App, Environment

        app = App.objects.filter(
            id=action.get("appId"), organisation_id=request.organisation_id
        ).first()
        environments = list(
            Environment.objects.filter(
                app=app, id__in=action.get("environmentIds") or []
            ).order_by("index", "name")
        ) if app else []
        return app, environments

    def asset(self, request, action):
        return self._target(request, action)

    def describe(self, request, action, member, view=None):
        app, environments = self._target(request, action)
        existing = (
            reusable_connection(request.organisation_id, app, environments)
            if app is not None and environments
            else None
        )
        if view is None:
            view = AppView(app=app, environments=tuple(environments))
        if app is not None and view.app is None:
            # The member cannot access the app: say what is asked, not where.
            title = f"{_level_title(action['access'])} secrets in {WITHHELD_APP}"
        else:
            title = (
                f"{_level_title(action['access'])} secrets in "
                f"{view.app_label() if app else 'an app'} "
                f"({view.environments_label()})"
            )
        return {
            "type": self.type,
            "title": fit_title(title),
            "requiresSecret": False,
            # The Connection approval would reuse, whose rules then apply.
            "current": (
                None
                if existing is None
                else {
                    "connectionId": str(existing.id),
                    "name": view.connection_name(existing.name),
                    "policy": full_policy(existing.policy),
                }
            ),
            "requested": {
                "app": (
                    None
                    if view.app is None
                    else {
                        "id": str(view.app.id),
                        "name": view.app.name,
                        "sseEnabled": view.app.sse_enabled,
                    }
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
                "access": action["access"],
                "durationSeconds": request.duration_seconds,
            },
        }

    def _write_seconds(self, request, value):
        if value is None:
            value = request.duration_seconds
        if value is None:
            value = AgentOrganisationSettings.for_organisation(
                request.organisation_id
            ).default_request_duration_seconds
        maximum = AgentOrganisationSettings.for_organisation(
            request.organisation_id
        ).max_request_duration_seconds
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not MIN_DURATION_SECONDS <= value <= maximum
        ):
            raise ActionError(
                f"inputs.writeDurationSeconds must be between "
                f"{MIN_DURATION_SECONDS} and {maximum}.",
                code="invalid_duration",
            )
        return value

    def apply(self, request, action, member, inputs):
        _require(member, "read")
        seconds, expires_at, inputs = _granted_access(request, inputs)
        unknown = sorted(set(inputs) - {"writeDurationSeconds"})
        if unknown:
            raise ActionError(f"inputs.{unknown[0]} is not accepted for this action.")
        writes = action["access"] == "read_write"
        if not writes and inputs.get("writeDurationSeconds") is not None:
            raise ActionError(
                "inputs.writeDurationSeconds applies only to read_write access."
            )
        write_seconds = (
            self._write_seconds(request, inputs.get("writeDurationSeconds"))
            if writes
            else None
        )
        app, environments = self._target(request, action)
        if app is None or len(environments) != len(action["environmentIds"]):
            raise ActionError("The app or its environments changed; start a new request")
        connection = reusable_connection(
            request.organisation_id, app, environments, lock=True
        )
        temporary = WRITE_CLASSES if writes else ()
        try:
            require_member_can_release(
                member, app, environments, released_classes(DEFAULT_POLICY, temporary)
            )
        except AppAccessError as exc:
            raise _app_error(exc) from exc
        if connection is None:
            _require(member, "create")
            connection = AgentConnection(
                organisation=request.organisation,
                name=connection_name(app, environments),
                service_type=APP_SERVICE_TYPE,
                app=app,
                state=AgentConnection.ACTIVE,
                policy=DEFAULT_POLICY,
                created_by=member,
                updated_by=member,
            )
            with _connection_errors():
                connection.full_clean()
                connection.save()
            set_connection_environments(connection, environments)
        with _connection_errors():
            grant, _ = grant_connection_access(
                request.workflow,
                connection,
                member,
                expires_at=expires_at,
                extend=True,
            )
        applied = {
            **action,
            "accessRecord": access_record(request, seconds, grant.expires_at),
        }
        if writes:
            now = timezone.now()
            write_until = write_expiry(grant, write_seconds, now)
            merge_temporary_allows(
                grant, WRITE_CLASSES, write_until, str(request.id), now
            )
            grant.save(update_fields=["temporary_allows", "updated_at"])
            applied["writeAccess"] = {
                "grantedDurationSeconds": write_seconds,
                "expiresAt": iso_timestamp(write_until),
            }
        _refresh_after_commit(request.workflow_id)
        request.connection = connection
        request.grant = grant
        request.credential_name = connection.name[:_MAX_DISPLAY_NAME_LENGTH]
        return AppliedAction(
            action=applied,
            runtime_action="retry",
            references=_references(connection.id, grant.id),
        )


register(AppAccess())
