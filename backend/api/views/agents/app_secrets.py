"""App secrets for Agent tokens on the public secrets API.

Every call an Agent token makes leaves one event naming the app, environment and class,
never a key or value.
"""

import json
import logging
from uuid import uuid4

from django.utils import timezone
from djangorestframework_camel_case.render import CamelCaseJSONRenderer
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.auth import SecretsAPIAuthentication
from api.models import AgentEvent, App, Environment
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed
from api.utils.agent_app_access import (
    METHOD_CLASSES,
    SSE_REQUIRED_MESSAGE,
    AgentSecretsReader,
    allow_request,
    app_access_entries,
    app_access_request,
    decide,
    expired_app_access,
    renew_request,
)
from api.utils.agent_config import APP_SERVICE_TYPE
from api.utils.rest import get_token_type
from api.utils.secrets import reference_target_environments


logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
INVALID_TOKEN_MESSAGE = (
    "The Agent token is unknown or revoked, or its Agent or Workflow is disabled."
)
DYNAMIC_UNSUPPORTED_MESSAGE = "Dynamic secrets are not available to Agents yet."
# Query parameters of the secrets API that ask for dynamic secrets or leases.
_DYNAMIC_PARAMETERS = ("dynamic", "include_dynamic", "lease", "lease_ttl")


class AgentSecretsRefusal(Exception):
    """A call by an Agent token that is refused, with what to tell it."""

    def __init__(self, http_status, code, message, **extra):
        super().__init__(message)
        self.http_status = http_status
        self.code = code
        self.message = message
        self.extra = extra

    def payload(self):
        return {"error": self.message, "code": self.code, **self.extra}


def is_agent_request(request):
    auth = getattr(request, "_auth", None)
    if isinstance(auth, dict) and auth.get("auth_type") == "Agent":
        return True
    return get_token_type(request.headers.get("Authorization")) == "Agent"


class AgentSecretsMixin:
    """Renders refusals of Agent calls and records each call as an event."""

    def handle_exception(self, exc):
        if isinstance(exc, AgentSecretsRefusal):
            return Response(exc.payload(), status=exc.http_status)
        if isinstance(exc, (AuthenticationFailed, NotAuthenticated)) and is_agent_request(
            self.request
        ):
            response = Response(
                {"error": INVALID_TOKEN_MESSAGE, "code": "invalid_token"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            response["WWW-Authenticate"] = "Bearer"
            return response
        return super().handle_exception(exc)

    def finalize_response(self, request, response, *args, **kwargs):
        record_agent_secrets_call(request, response)
        return super().finalize_response(request, response, *args, **kwargs)


def refuse_agent_dynamic_secrets(request):
    """Dynamic secrets need their own design for Agents (lease ownership,
    plan checks, a lease outliving its grant), so every such call is refused."""

    if request.auth.get("auth_type") == "Agent":
        call = getattr(request, "_agent_secrets_call", None)
        if call is None:
            request._agent_secrets_call = {"class": METHOD_CLASSES.get(request.method)}
        raise AgentSecretsRefusal(
            status.HTTP_403_FORBIDDEN,
            "agent_dynamic_unsupported",
            DYNAMIC_UNSUPPORTED_MESSAGE,
        )


def _environment_label(environment):
    return f"{environment.app.name} ({environment.name})"


def _body_secrets(request):
    try:
        body = json.loads(request.body or b"{}")
    except (ValueError, RecursionError):
        # The view answers a malformed body itself.
        return []
    secrets = body.get("secrets") if isinstance(body, dict) else None
    if not isinstance(secrets, list):
        return []
    return [secret for secret in secrets if isinstance(secret, dict)]


def _body_has_override(request):
    return any("override" in secret for secret in _body_secrets(request))


def _refers_outside_readable(request, workflow, environment):
    """Whether a submitted value refers to a secret in an environment the
    Workflow cannot read. Other readers of this environment, such as a sync,
    resolve references without an account check, so such a reference would
    carry that secret where the Agent might see it."""

    reader = AgentSecretsReader(workflow)
    for secret in _body_secrets(request):
        value = secret.get("value")
        if not isinstance(value, str):
            continue
        for target in reference_target_environments(value, environment):
            if target is None or not reader.can_read_environment(target.id):
                return True
    return False


def authorize_agent_secrets_call(request):
    """Decide a call to the public secrets API made with an Agent token.

    Allowed only under an active grant covering the environment, whose policy lets the class through.
    """

    auth = request.auth
    access_class = METHOD_CLASSES.get(request.method)
    call = {"class": access_class}
    request._agent_secrets_call = call
    if access_class is None:
        raise AgentSecretsRefusal(
            status.HTTP_405_METHOD_NOT_ALLOWED,
            "method_not_allowed",
            f"{request.method} is not supported here.",
        )
    if any(name in request.GET for name in _DYNAMIC_PARAMETERS):
        refuse_agent_dynamic_secrets(request)
    if (
        request.GET.get("secret_id")
        or request.headers.get("secret_id")
        or request.headers.get("environment")
        or not request.GET.get("app_id")
        or not request.GET.get("env")
    ):
        raise AgentSecretsRefusal(
            status.HTTP_400_BAD_REQUEST,
            "environment_required",
            "Name the environment with the app_id and env query parameters.",
        )
    app = App.objects.filter(
        id=request.GET["app_id"],
        organisation=auth["organisation"],
        is_deleted=False,
        deleted_at__isnull=True,
    ).first()
    environment = (
        Environment.objects.select_related("app__organisation")
        .filter(app=app, name__iexact=request.GET["env"], deleted_at__isnull=True)
        .first()
        if app is not None
        else None
    )
    if environment is None:
        raise AgentSecretsRefusal(
            status.HTTP_404_NOT_FOUND,
            "environment_not_found",
            "No app with that id, or no environment with that name in it, "
            "exists in this organisation.",
        )
    call["environment"] = environment
    if not environment.app.sse_enabled:
        raise AgentSecretsRefusal(
            status.HTTP_409_CONFLICT, "sse_required", SSE_REQUIRED_MESSAGE
        )

    decision = decide(auth["workflow"], environment, access_class)
    call["decision"] = decision
    label = _environment_label(environment)
    if decision.effect == "missing":
        raise AgentSecretsRefusal(
            status.HTTP_403_FORBIDDEN,
            "agent_grant_missing",
            f"This Workflow has no access to the secrets of {label}. Send the "
            "request below to ask a member for it.",
            request=app_access_request(environment, access_class),
        )
    connection = decision.grant.connection
    if decision.effect == "expired":
        raise AgentSecretsRefusal(
            status.HTTP_403_FORBIDDEN,
            "agent_grant_expired",
            f"This Workflow's access to the secrets of {label} through "
            f"'{connection.name}' expired. Send the request below to ask a "
            "member to renew it.",
            request=renew_request(decision.grant),
        )
    if decision.effect == "ask":
        raise AgentSecretsRefusal(
            status.HTTP_403_FORBIDDEN,
            "agent_access_ask",
            f"'{connection.name}' needs a member's approval before this Workflow "
            f"can {access_class} secrets in {label}. Send the request below to "
            "ask for it.",
            # Only the refused class: other writes ask when they are tried.
            request=allow_request(decision.grant, [access_class]),
        )
    if decision.effect == "block":
        raise AgentSecretsRefusal(
            status.HTTP_403_FORBIDDEN,
            "agent_access_blocked",
            f"The access rules of '{connection.name}' block {access_class} "
            f"calls to the secrets of {label}. Only a member can change them.",
            connectionName=connection.name,
            **{"class": access_class},
        )
    if access_class in ("create", "update") and _body_has_override(request):
        raise AgentSecretsRefusal(
            status.HTTP_400_BAD_REQUEST,
            "agent_override_unsupported",
            "Personal overrides belong to members; an Agent cannot set one.",
        )
    if access_class in ("create", "update") and _refers_outside_readable(
        request, auth["workflow"], environment
    ):
        call["refused"] = True
        raise AgentSecretsRefusal(
            status.HTTP_403_FORBIDDEN,
            "agent_reference_not_readable",
            "A value refers to a secret in an environment this Agent cannot read.",
        )
    auth["environment"] = environment
    auth["app"] = environment.app


_DECISIONS = {
    "allow": AgentEvent.ALLOW,
    "ask": AgentEvent.ASK,
    "block": AgentEvent.BLOCK,
    "missing": AgentEvent.BLOCK,
    "expired": AgentEvent.BLOCK,
}


def record_agent_secrets_call(request, response):
    """One Agent event per call, so the Agent's Logs tab shows it. A failure
    to record never changes the answer."""

    call = getattr(request, "_agent_secrets_call", None)
    auth = getattr(request, "_auth", None)
    if call is None or not isinstance(auth, dict) or auth.get("agent") is None:
        return
    try:
        decision = call.get("decision")
        environment = call.get("environment")
        code = response.data.get("code", "") if isinstance(response.data, dict) else ""
        if call.get("refused"):
            # Allowed by the grant, refused for what the call carries.
            proxy_decision = AgentEvent.BLOCK
        elif decision is not None:
            proxy_decision = _DECISIONS[decision.effect]
        else:
            proxy_decision = AgentEvent.BLOCK if code else AgentEvent.ERROR
        if response.status_code < 400:
            outcome = "allowed"
        elif proxy_decision == AgentEvent.ALLOW:
            outcome = "error"
        else:
            outcome = "denied"
        detail = {"class": call.get("class") or ""}
        if environment is not None:
            detail.update(
                {
                    "app_id": str(environment.app_id),
                    "app_name": environment.app.name,
                    "environment_id": str(environment.id),
                    "environment_name": environment.name,
                }
            )
        grant = getattr(decision, "grant", None)
        if grant is not None:
            detail["grant_id"] = str(grant.id)
        if getattr(decision, "until", None):
            detail["temporary_allow_until"] = decision.until
        AgentEvent.objects.create(
            event_id=f"app-secrets-{uuid4()}",
            organisation=auth["organisation"],
            agent=auth["agent"],
            workflow=auth["workflow"],
            connection=grant.connection if grant is not None else None,
            session=None,
            proxy_created_at=timezone.now(),
            event_type="app_secrets",
            protocol="http",
            method=request.method[:32],
            host="",
            # The path only: the query names keys and folders.
            path=request.path[:1024],
            provider=APP_SERVICE_TYPE,
            status_code=response.status_code,
            proxy_decision=proxy_decision,
            outcome=outcome,
            reason=str(code)[:512],
            detail=detail,
        )
    except Exception:
        logger.exception("Could not record an Agent's app secrets call")


class AgentAppAccessView(AgentSecretsMixin, APIView):
    """``GET /v1/agents/app-access/``: what this token's Workflow can use."""

    authentication_classes = [SecretsAPIAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def get(self, request):
        if request.auth.get("auth_type") != "Agent":
            raise AgentSecretsRefusal(
                status.HTTP_403_FORBIDDEN,
                "agent_token_required",
                "App access is listed for Agent tokens only.",
            )
        workflow = request.auth["workflow"]
        now = timezone.now()
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "apps": app_access_entries(workflow, now),
                "expired": expired_app_access(workflow, now),
            }
        )
