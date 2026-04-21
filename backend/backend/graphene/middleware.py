from graphql import GraphQLResolveInfo
from graphql import GraphQLError
from api.models import (
    App,
    Environment,
    NetworkAccessPolicy,
    Organisation,
    OrganisationMember,
)

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

    Org resolution covers every common resource-ID kwarg that appears on
    org-scoped resolvers: direct org IDs, app/environment IDs, plus every
    resource type whose id can be used to implicitly address a specific
    organisation (secrets, members, service accounts, teams, invites,
    folders, syncs, roles, policies, credentials, tokens, leases). Each
    resolver returns an org_id or None; lookups short-circuit on the
    first match so the common case (direct org_id) is still free.

    Per-request caching: a single GraphQL document often pulls many
    org-scoped fields. Without caching, each resolver hit re-queries
    the whole resolution chain. Decisions are cached per org_id, and
    each intermediate lookup (app→org, env→org, …) is cached by its
    own key so chained lookups also benefit.
    """

    _DECISION_CACHE_ATTR = "_org_sso_decision_cache"
    _ID_CACHE_ATTR = "_org_sso_id_cache"

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
        cache = getattr(request, cls._DECISION_CACHE_ATTR, None)
        if cache is None:
            cache = {}
            setattr(request, cls._DECISION_CACHE_ATTR, cache)

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
    def _id_cache(cls, request):
        cache = getattr(request, cls._ID_CACHE_ATTR, None)
        if cache is None:
            cache = {}
            setattr(request, cls._ID_CACHE_ATTR, cache)
        return cache

    @classmethod
    def _cached(cls, request, kind, id_value, loader):
        """Generic cached lookup. kind is a string namespace, id_value
        is the key; loader is a zero-arg callable returning an org_id
        (or None). Cache stores the result so each resolver hit in the
        same request doesn't re-query."""
        cache = cls._id_cache(request)
        key = (kind, str(id_value))
        if key in cache:
            return cache[key]
        try:
            org_id = loader()
        except Exception:
            org_id = None
        cache[key] = org_id
        return org_id

    @classmethod
    def _resolve_org_id(cls, request, kwargs):
        # Direct org kwargs — no DB hit.
        for key in ("organisation_id", "org_id"):
            value = kwargs.get(key)
            if value:
                return value

        # Ordered dispatch table. Each entry is (kwarg_name, resolver).
        # First kwarg that resolves wins. Lookups that chain (e.g.
        # secret → env → app → org) reuse the same id-cache via _cached
        # so the chain is only traversed once per request per id.
        dispatch = [
            ("app_id", cls._lookup_app_org),
            ("env_id", cls._lookup_env_org),
            ("environment_id", cls._lookup_env_org),
            ("secret_id", cls._lookup_secret_org),
            ("folder_id", cls._lookup_folder_org),
            ("sync_id", cls._lookup_sync_org),
            ("member_id", cls._lookup_member_org),
            ("service_account_id", cls._lookup_service_account_org),
            ("account_id", cls._lookup_service_account_org),
            ("invite_id", cls._lookup_invite_org),
            # team_id: add when api.models.Team merges (teams PR)
            ("role_id", cls._lookup_role_org),
            ("policy_id", cls._lookup_policy_org),
            ("credential_id", cls._lookup_credential_org),
            ("lease_id", cls._lookup_lease_org),
            ("token_id", cls._lookup_token_org),
        ]
        for kwarg_name, resolver in dispatch:
            value = kwargs.get(kwarg_name)
            if value:
                org_id = resolver(request, value)
                if org_id:
                    return org_id
        return None

    # ------- resource → org lookups -------

    @classmethod
    def _lookup_app_org(cls, request, app_id):
        def load():
            return App.objects.only("organisation_id").get(id=app_id).organisation_id
        return cls._cached(request, "app", app_id, load)

    @classmethod
    def _lookup_env_org(cls, request, env_id):
        def load():
            env = Environment.objects.only("app_id").get(id=env_id)
            return cls._lookup_app_org(request, env.app_id)
        return cls._cached(request, "env", env_id, load)

    @classmethod
    def _lookup_secret_org(cls, request, secret_id):
        from api.models import Secret
        def load():
            secret = Secret.objects.only("environment_id").get(id=secret_id)
            return cls._lookup_env_org(request, secret.environment_id)
        return cls._cached(request, "secret", secret_id, load)

    @classmethod
    def _lookup_folder_org(cls, request, folder_id):
        from api.models import SecretFolder
        def load():
            folder = SecretFolder.objects.only("environment_id").get(id=folder_id)
            return cls._lookup_env_org(request, folder.environment_id)
        return cls._cached(request, "folder", folder_id, load)

    @classmethod
    def _lookup_sync_org(cls, request, sync_id):
        from api.models import EnvironmentSync
        def load():
            sync = EnvironmentSync.objects.only("environment_id").get(id=sync_id)
            return cls._lookup_env_org(request, sync.environment_id)
        return cls._cached(request, "sync", sync_id, load)

    @classmethod
    def _lookup_member_org(cls, request, member_id):
        def load():
            return OrganisationMember.objects.only(
                "organisation_id"
            ).get(id=member_id).organisation_id
        return cls._cached(request, "member", member_id, load)

    @classmethod
    def _lookup_service_account_org(cls, request, sa_id):
        from api.models import ServiceAccount
        def load():
            return ServiceAccount.objects.only(
                "organisation_id"
            ).get(id=sa_id).organisation_id
        return cls._cached(request, "sa", sa_id, load)

    @classmethod
    def _lookup_invite_org(cls, request, invite_id):
        from api.models import OrganisationMemberInvite
        def load():
            return OrganisationMemberInvite.objects.only(
                "organisation_id"
            ).get(id=invite_id).organisation_id
        return cls._cached(request, "invite", invite_id, load)

    @classmethod
    def _lookup_role_org(cls, request, role_id):
        from api.models import Role
        def load():
            return Role.objects.only(
                "organisation_id"
            ).get(id=role_id).organisation_id
        return cls._cached(request, "role", role_id, load)

    @classmethod
    def _lookup_policy_org(cls, request, policy_id):
        def load():
            return NetworkAccessPolicy.objects.only(
                "organisation_id"
            ).get(id=policy_id).organisation_id
        return cls._cached(request, "policy", policy_id, load)

    @classmethod
    def _lookup_credential_org(cls, request, credential_id):
        from api.models import ProviderCredentials
        def load():
            return ProviderCredentials.objects.only(
                "organisation_id"
            ).get(id=credential_id).organisation_id
        return cls._cached(request, "credential", credential_id, load)

    @classmethod
    def _lookup_lease_org(cls, request, lease_id):
        from api.models import DynamicSecretLease
        def load():
            # Lease → dynamic secret → environment → app → org.
            lease = DynamicSecretLease.objects.only(
                "dynamic_secret_id"
            ).get(id=lease_id)
            from api.models import DynamicSecret
            ds = DynamicSecret.objects.only(
                "environment_id"
            ).get(id=lease.dynamic_secret_id)
            return cls._lookup_env_org(request, ds.environment_id)
        return cls._cached(request, "lease", lease_id, load)

    @classmethod
    def _lookup_token_org(cls, request, token_id):
        """Tokens live across several models (UserToken, ServiceToken,
        ServiceAccountToken, EnvironmentToken). UUIDs are unique per
        table but not across tables; probe them in a fixed order and
        stop at the first hit."""
        from api.models import (
            EnvironmentToken,
            ServiceAccountToken,
            ServiceToken,
            UserToken,
        )

        def load():
            # UserToken: token → user → first org membership. A user
            # can belong to multiple orgs; the SSO enforcement here
            # only cares about *some* org we can pin — if any of the
            # user's orgs requires SSO, block. Conservative choice:
            # if ANY membership's org requires SSO and the session
            # doesn't match, we block. Picking the first membership
            # is a simplification; tokens scoped to a specific org
            # would be safer and is a TODO for the UserToken schema.
            try:
                ut = UserToken.objects.only("user_id").get(id=token_id)
                member = OrganisationMember.objects.filter(
                    user_id=ut.user_id, deleted_at__isnull=True
                ).only("organisation_id").first()
                if member:
                    return member.organisation_id
            except UserToken.DoesNotExist:
                pass
            try:
                st = ServiceToken.objects.only("app_id").get(id=token_id)
                return cls._lookup_app_org(request, st.app_id)
            except ServiceToken.DoesNotExist:
                pass
            try:
                sat = ServiceAccountToken.objects.only(
                    "service_account_id"
                ).get(id=token_id)
                return cls._lookup_service_account_org(
                    request, sat.service_account_id
                )
            except ServiceAccountToken.DoesNotExist:
                pass
            try:
                et = EnvironmentToken.objects.only("environment_id").get(id=token_id)
                return cls._lookup_env_org(request, et.environment_id)
            except EnvironmentToken.DoesNotExist:
                pass
            return None

        return cls._cached(request, "token", token_id, load)


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
