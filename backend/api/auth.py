import logging
from datetime import timedelta
from api.utils.rest import (
    get_token_from_header,
    get_token_type,
    token_is_expired_or_deleted,
)
from api.models import DynamicSecret, Environment, Secret, ServiceAccountToken
from api.utils.access.permissions import (
    service_account_can_access_environment,
    user_can_access_app,
    user_can_access_environment,
)
from rest_framework import authentication, exceptions
from django.apps import apps
from django.db.models import Q
from django.utils import timezone

logger = logging.getLogger(__name__)

# "Last used" needs minute precision at most, so a token's last_used_at is
# written at most this often instead of on every request it authenticates.
LAST_USED_AT_WRITE_INTERVAL = timedelta(seconds=60)


class ServiceAccountUser:
    """Mock ServiceAccount user"""

    def __init__(self, service_account):
        self.userId = service_account.id
        self.id = service_account.id
        self.is_authenticated = True
        self.is_active = True
        self.username = service_account.name
        self.service_account = service_account


def _resolve_caller_org(token_type, token):
    """Best-effort lookup of the calling principal's organisation, read
    off the token row from get_token_from_header(). Used to scope
    subsequent Secret/Environment/App lookups so an unrelated UUID from
    another org can't act as an existence oracle. Failures here are
    deferred — the principal-loading branches below raise the canonical
    errors."""
    try:
        if token_type == "User":
            om = token.user
            if om and getattr(om, "deleted_at", None) is None:
                return om.organisation
        elif token_type == "ServiceAccount":
            sa = token.service_account
            if sa and getattr(sa, "deleted_at", None) is None:
                return sa.organisation
    except Exception:
        pass
    return None


def _bump_last_used_at(service_account_token):
    """Set last_used_at to now if it is unset or older than
    LAST_USED_AT_WRITE_INTERVAL. The token row was loaded by this request,
    so a recent value skips the write without a query. The UPDATE repeats
    the staleness check, so concurrent requests that all loaded a stale
    value write the row once between them."""
    now = timezone.now()
    stale_before = now - LAST_USED_AT_WRITE_INTERVAL
    last_used_at = service_account_token.last_used_at
    if last_used_at is not None and last_used_at >= stale_before:
        return

    ServiceAccountToken.objects.filter(
        Q(last_used_at__isnull=True) | Q(last_used_at__lt=stale_before),
        id=service_account_token.id,
    ).update(last_used_at=now)


class PhaseTokenAuthentication(authentication.BaseAuthentication):
    def authenticate_header(self, request):
        # DRF needs this to return a value for AuthenticationFailed to map
        # to HTTP 401 (RFC 7235 requires WWW-Authenticate on a 401 response).
        # Without it DRF silently downgrades 401 → 403, which contradicts
        # our docs ("401 = no creds / token expired or deleted").
        return "Bearer"

    def authenticate(self, request):

        # Legacy Service tokens are retired, including bootstrap requests.
        # Reject them before loading any persisted token or target resource.
        token_types = ["User", "ServiceAccount"]

        parser_context = getattr(request, "parser_context", {}) or {}
        view = parser_context.get("view")
        contextless_token_bootstrap = bool(
            getattr(view, "allow_contextless_token_bootstrap", False)
        )

        auth_token = request.headers.get("Authorization")

        if not auth_token:
            return None  # No authentication attempted

        token_type = get_token_type(auth_token)

        if token_type not in token_types:
            raise exceptions.AuthenticationFailed("Invalid token")

        auth = {
            "token": auth_token,
            "auth_type": token_type,
            "org_member": None,
            "service_account": None,
            "service_account_token": None,
        }

        # The only token lookup: the checks below read the principal, its
        # organisation and the token's creator off this row.
        token = get_token_from_header(auth_token)

        if token_is_expired_or_deleted(token):
            raise exceptions.AuthenticationFailed("Token expired or deleted")

        # Resolve the caller's org early so subsequent lookups can be
        # scoped to it — without this an unrelated UUID from another org
        # acts as a cross-tenant existence oracle (404 = doesn't exist,
        # 401/403 = exists in another org).
        caller_org = _resolve_caller_org(token_type, token)

        if getattr(caller_org, "deleted_at", None) is not None:
            raise exceptions.PermissionDenied(
                "This organisation is scheduled for deletion."
            )

        url_kwargs = (
            request.resolver_match.kwargs
            if hasattr(request, "resolver_match") and request.resolver_match
            else {}
        )
        # Detail endpoints address the target via URL kwargs. When those
        # are present, Secret-Id / Environment headers must NOT redirect
        # the request to a different resource — otherwise
        # `PUT /v1/apps/<Y>/` with `Secret-Id: <secret-in-X>` silently
        # operates on X instead of Y.
        url_has_target = bool(
            url_kwargs.get("app_id") or url_kwargs.get("env_id")
        )

        env = None

        # Try resolving secret_id from header OR query params (supports Secret or DynamicSecret)
        secret_id = (
            None
            if url_has_target or contextless_token_bootstrap
            else (request.headers.get("secret_id") or request.GET.get("secret_id"))
        )
        if secret_id:
            secret_qs = Secret.objects.select_related(
                "environment__app__organisation"
            )
            dyn_qs = DynamicSecret.objects.select_related(
                "environment__app__organisation"
            )
            if caller_org is not None:
                secret_qs = secret_qs.filter(
                    environment__app__organisation=caller_org
                )
                dyn_qs = dyn_qs.filter(
                    environment__app__organisation=caller_org
                )
            found = False
            try:
                env = secret_qs.get(id=secret_id).environment
                found = True
            except (Secret.DoesNotExist, ValueError):
                pass
            if not found:
                try:
                    env = dyn_qs.get(id=secret_id).environment
                    found = True
                except (DynamicSecret.DoesNotExist, ValueError):
                    pass
            if not found:
                raise exceptions.NotFound("Secret not found")

        # If env is still None, try resolving from header or query params
        if env is None:
            env_id = (
                None
                if url_has_target or contextless_token_bootstrap
                else request.headers.get("environment")
            )
            # Try resolving env from header
            if env_id:
                env_qs = Environment.objects.select_related("app__organisation")
                if caller_org is not None:
                    env_qs = env_qs.filter(app__organisation=caller_org)
                try:
                    env = env_qs.get(id=env_id)
                except (Environment.DoesNotExist, ValueError):
                    raise exceptions.AuthenticationFailed("Environment not found")

            # Try resolving env from query params
            else:
                app_id = (
                    None if contextless_token_bootstrap else request.GET.get("app_id")
                )
                env_name = (
                    None if contextless_token_bootstrap else request.GET.get("env")
                )

                App = apps.get_model("api", "App")

                def _app_qs():
                    qs = App.objects.select_related("organisation")
                    if caller_org is not None:
                        qs = qs.filter(organisation=caller_org)
                    return qs

                def _env_qs():
                    qs = Environment.objects.select_related("app__organisation")
                    if caller_org is not None:
                        qs = qs.filter(app__organisation=caller_org)
                    return qs

                if app_id and env_name:
                    try:
                        env = _env_qs().get(
                            app_id=app_id, name__iexact=env_name
                        )
                    except (Environment.DoesNotExist, ValueError):
                        if not _app_qs().filter(id=app_id).exists():
                            raise exceptions.NotFound(
                                f"App with ID {app_id} not found"
                            )
                        else:
                            raise exceptions.NotFound(
                                f"Environment '{env_name}' not found in App {app_id}"
                            )

                elif app_id and not env_name:
                    try:
                        auth["app"] = _app_qs().get(id=app_id)
                    except (App.DoesNotExist, ValueError):
                        raise exceptions.NotFound(
                            f"App with ID {app_id} not found"
                        )

                else:
                    env_id_from_url = url_kwargs.get("env_id")
                    app_id_from_url = url_kwargs.get("app_id")

                    if env_id_from_url:
                        try:
                            env_lookup = _env_qs().get(id=env_id_from_url)
                            auth["app"] = env_lookup.app
                        except (Environment.DoesNotExist, ValueError):
                            raise exceptions.NotFound("Environment not found")
                    elif app_id_from_url:
                        try:
                            auth["app"] = _app_qs().get(id=app_id_from_url)
                        except (App.DoesNotExist, ValueError):
                            raise exceptions.NotFound(
                                f"App with ID {app_id_from_url} not found"
                            )
                    else:
                        # Org-only mode: no app, no env (resolved from token below).
                        auth["org_only"] = True

        auth["environment"] = env

        # When env is resolved, also populate auth["app"] for convenience
        if env is not None:
            auth["app"] = env.app

        if token_type == "User":
            org_member = token.user
            if org_member is None or org_member.deleted_at is not None:
                raise exceptions.NotFound("User not found")

            # Capture the UserToken row for audit attribution. Without this,
            # audit events from PAT-driven REST calls can't distinguish the
            # specific token used (vs. a console UI session, which has none).
            auth["user_token"] = token

            auth["org_member"] = org_member
            user = org_member.user

            if auth.get("org_only"):
                # Org-only mode: resolve organisation from the member
                auth["organisation"] = org_member.organisation
            elif env:
                if not user_can_access_environment(user.userId, env.id):
                    raise exceptions.PermissionDenied(
                        "User cannot access this environment"
                    )
            else:
                # App-only mode
                if not user_can_access_app(user.userId, auth["app"].id):
                    raise exceptions.PermissionDenied(
                        "User cannot access this app"
                    )

        if token_type == "ServiceAccount":

            try:
                service_account_token = token
                service_account = token.service_account

                creator = getattr(service_account_token, "created_by", None)
                if creator:
                    user = creator.user
                else:
                    user = ServiceAccountUser(service_account)

                auth["service_account"] = service_account
                auth["service_account_token"] = service_account_token

                # Track last-used timestamp for SA tokens used against the
                # REST/management API. Without this the GraphQL resolver
                # falls back to SecretEvent history which only records
                # E2EE secret operations, so tokens actively hitting
                # management endpoints showed "never used".
                _bump_last_used_at(service_account_token)

                if auth.get("org_only"):
                    # Org-only mode: resolve organisation from the SA
                    auth["organisation"] = service_account.organisation
                elif env:
                    if not service_account_can_access_environment(
                        service_account.id, env.id
                    ):
                        raise exceptions.AuthenticationFailed(
                            "Service account cannot access this environment"
                        )
                else:
                    # App-only mode: team-aware app access check. The
                    # inline M2M filter only catches direct-member SAs,
                    # so team-owned SAs that reach the app via team
                    # membership would fail closed at the auth layer
                    # even though service_account_can_access_app
                    # accepts them in views.
                    from api.utils.access.permissions import (
                        service_account_can_access_app,
                    )
                    if not service_account_can_access_app(
                        service_account.id, auth["app"].id
                    ):
                        raise exceptions.AuthenticationFailed(
                            "Service account cannot access this app"
                        )
            except (exceptions.AuthenticationFailed, exceptions.NotFound):
                raise  # Let DRF exceptions propagate with their specific messages
            except Exception as ex:
                logger.debug(f"ServiceAccount authentication error: {ex}")
                raise exceptions.AuthenticationFailed(
                    "Authentication error. Please check your authentication token or App / Environment access."
                )

        return (user, auth)
