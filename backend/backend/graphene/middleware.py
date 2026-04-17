from graphql import GraphQLResolveInfo
from graphql import GraphQLError
from api.models import App, Environment, NetworkAccessPolicy, Organisation, OrganisationMember

from itertools import chain
from api.utils.access.ip import get_client_ip


class IPRestrictedError(GraphQLError):
    def __init__(self, organisation_name: str):
        super().__init__(
            message=f"Your IP address is not allowed to access {organisation_name}",
            extensions={
                "code": "IP_RESTRICTED",
                "organisation_name": organisation_name,
            },
        )


class SSORequiredError(GraphQLError):
    def __init__(self, organisation_name: str, organisation_id: str):
        super().__init__(
            message=f"{organisation_name} requires Single Sign-On. Please sign in via SSO to continue.",
            extensions={
                "code": "SSO_REQUIRED",
                "organisation_name": organisation_name,
                "organisation_id": organisation_id,
            },
        )


class OrgSSOEnforcementMiddleware:
    """
    Graphene middleware to enforce per-org SSO requirements.

    When org.require_sso=True, the session must have been established via the
    org-level SSO flow *for this specific org*. Instance-level SSO (Google,
    GitHub, GitLab) sets auth_method="sso" but does NOT set auth_sso_org_id,
    so those sessions are blocked — they cannot bypass org-level enforcement.

    Provider rotation (admin swaps Entra→Okta) is not yet enforced; sessions
    authenticated against the previous provider for this org still pass.
    auth_sso_provider_id is stored on the session for a future tightening.

    Resolves org from: organisation_id | org_id | app_id | env_id |
    environment_id kwargs. Other resolvers fall through (membership-scoped
    lists like `organisations` show all memberships, including locked orgs,
    so the user can see them and re-auth via SSO).

    Per-request caching: a single GraphQL document often pulls many
    org-scoped fields. Without caching, each resolver hit re-queries
    Organisation (and for app_id/env_id, App and Environment too). The
    middleware caches org_id resolution by kind + id, and the (blocked,
    org_name) decision by org_id, on the request object — so the heavy
    work happens once per org per HTTP request.
    """

    _ORG_CACHE_ATTR = "_org_sso_cache"
    _APP_CACHE_ATTR = "_org_sso_app_to_org"
    _ENV_CACHE_ATTR = "_org_sso_env_to_org"

    def resolve(self, next, root, info: GraphQLResolveInfo, **kwargs):
        request = info.context
        user = getattr(request, "user", None)

        if not user or not user.is_authenticated:
            return next(root, info, **kwargs)

        org_id = self._resolve_org_id(request, kwargs)
        if not org_id:
            return next(root, info, **kwargs)

        decision = self._get_org_decision(request, org_id)
        if decision is None:
            # Org didn't exist / couldn't be loaded — let the resolver decide.
            return next(root, info, **kwargs)

        blocked, org_name = decision
        if not blocked:
            return next(root, info, **kwargs)

        session = getattr(request, "session", None)
        auth_method = session.get("auth_method") if session else None
        session_org_id = session.get("auth_sso_org_id") if session else None

        if auth_method == "sso" and session_org_id == str(org_id):
            return next(root, info, **kwargs)

        raise SSORequiredError(org_name, str(org_id))

    @classmethod
    def _get_org_decision(cls, request, org_id):
        """Return (blocked, org_name) tuple, or None if the org can't be
        loaded. Cached per request."""
        cache = getattr(request, cls._ORG_CACHE_ATTR, None)
        if cache is None:
            cache = {}
            setattr(request, cls._ORG_CACHE_ATTR, cache)

        key = str(org_id)
        if key in cache:
            return cache[key]

        try:
            org = Organisation.objects.only("require_sso", "name").get(id=org_id)
        except Organisation.DoesNotExist:
            cache[key] = None
            return None

        decision = (bool(org.require_sso), org.name)
        cache[key] = decision
        return decision

    @classmethod
    def _resolve_org_id(cls, request, kwargs):
        # Direct org kwargs — no DB hit.
        for key in ("organisation_id", "org_id"):
            value = kwargs.get(key)
            if value:
                return value
        # Resolve via App — cached per request.
        app_id = kwargs.get("app_id")
        if app_id:
            return cls._lookup_app_org(request, app_id)
        # Resolve via Environment — cached per request.
        env_id = kwargs.get("env_id") or kwargs.get("environment_id")
        if env_id:
            return cls._lookup_env_org(request, env_id)
        return None

    @classmethod
    def _lookup_app_org(cls, request, app_id):
        cache = getattr(request, cls._APP_CACHE_ATTR, None)
        if cache is None:
            cache = {}
            setattr(request, cls._APP_CACHE_ATTR, cache)
        key = str(app_id)
        if key in cache:
            return cache[key]
        try:
            org_id = App.objects.only("organisation_id").get(id=app_id).organisation_id
        except App.DoesNotExist:
            org_id = None
        cache[key] = org_id
        return org_id

    @classmethod
    def _lookup_env_org(cls, request, env_id):
        cache = getattr(request, cls._ENV_CACHE_ATTR, None)
        if cache is None:
            cache = {}
            setattr(request, cls._ENV_CACHE_ATTR, cache)
        key = str(env_id)
        if key in cache:
            return cache[key]
        try:
            env = Environment.objects.only("app_id").get(id=env_id)
            org_id = cls._lookup_app_org(request, env.app_id)
        except Environment.DoesNotExist:
            org_id = None
        cache[key] = org_id
        return org_id


class IPWhitelistMiddleware:
    """
    Graphene middleware to enforce network access policy for human users
    based on their organisation membership and IP address.
    """

    def resolve(self, next, root, info: GraphQLResolveInfo, **kwargs):
        request = info.context
        user = getattr(request, "user", None)

        organisation_id = kwargs.get("organisation_id")
        if not user or not user.is_authenticated:
            raise GraphQLError("Authentication required")

        if not organisation_id:
            # If the operation doesn't involve an org, skip check
            return next(root, info, **kwargs)

        org = Organisation.objects.get(id=organisation_id)

        if org.plan == Organisation.FREE_PLAN:
            return next(root, info, **kwargs)

        else:
            from ee.access.utils.network import is_ip_allowed

            try:
                org_member = OrganisationMember.objects.get(
                    organisation_id=organisation_id,
                    user_id=user.userId,
                    deleted_at__isnull=True,
                )
            except OrganisationMember.DoesNotExist:
                raise GraphQLError("You are not a member of this organisation")

            ip = get_client_ip(request)

            account_policies = org_member.network_policies.all()
            global_policies = (
                NetworkAccessPolicy.objects.filter(
                    organisation_id=organisation_id, is_global=True
                )
                if org.plan == Organisation.ENTERPRISE_PLAN
                else []
            )

            all_policies = list(chain(account_policies, global_policies))

            if not all_policies or is_ip_allowed(ip, all_policies):
                return next(root, info, **kwargs)

            raise IPRestrictedError(org_member.organisation.name)

    def get_client_ip(self, request):
        return get_client_ip(request)
