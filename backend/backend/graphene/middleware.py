from graphql import GraphQLResolveInfo
from graphql import GraphQLError
from graphql.type import GraphQLList, GraphQLNonNull, GraphQLObjectType
from api.models import NetworkAccessPolicy, Organisation, OrganisationMember

from itertools import chain
from django.core.cache import cache

from api.utils.access.ip import get_client_ip
from api.utils.access.org_resolution import resolve_org_id, resolve_via_model


def _model_for_mutation(info: GraphQLResolveInfo):
    """Derive the Django model a mutation operates on for the bare-`id`/
    `ids` case. Reads `org_resource_model` if declared, else picks the
    first `DjangoObjectType`-backed field on the mutation's output."""
    return_type = info.return_type
    while isinstance(return_type, (GraphQLNonNull, GraphQLList)):
        return_type = return_type.of_type
    if not isinstance(return_type, GraphQLObjectType):
        return None

    graphene_type = getattr(return_type, "graphene_type", None)
    if graphene_type is not None:
        explicit = getattr(graphene_type, "org_resource_model", None)
        if explicit:
            return explicit

    for _name, gql_field in return_type.fields.items():
        ftype = gql_field.type
        while isinstance(ftype, (GraphQLNonNull, GraphQLList)):
            ftype = ftype.of_type
        if not isinstance(ftype, GraphQLObjectType):
            continue
        gtype = getattr(ftype, "graphene_type", None)
        meta = getattr(gtype, "_meta", None) if gtype is not None else None
        model = getattr(meta, "model", None) if meta is not None else None
        if model is not None:
            return model.__name__
    return None


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
    """Enforce per-org SSO requirements on every org-scoped resolver.

    Sessions established via the org-level SSO flow carry
    ``auth_sso_org_id``; sessions from instance-level SSO (Google,
    GitHub, GitLab) don't, so they can't bypass org-level enforcement.
    """

    _DECISION_CACHE_ATTR = "_org_sso_decision_cache"
    _ID_CACHE_ATTR = "_org_sso_id_cache"
    _DECISION_REDIS_TTL = 60

    @staticmethod
    def _decision_redis_key(org_id) -> str:
        return f"org_sso_decision:{org_id}"

    @classmethod
    def invalidate_decision(cls, org_id) -> None:
        """Called when ``require_sso`` flips so the change takes effect
        before the Redis TTL would naturally expire the cached value."""
        try:
            cache.delete(cls._decision_redis_key(org_id))
        except Exception:
            pass

    def resolve(self, next, root, info: GraphQLResolveInfo, **kwargs):
        request = info.context
        user = getattr(request, "user", None)

        if not user or not user.is_authenticated:
            return next(root, info, **kwargs)

        org_id = self._resolve_org_id(request, kwargs, info)
        if not org_id:
            return next(root, info, **kwargs)

        # Skip the require_sso lookup when the session is already SSO-bound
        # to this org — it would have been blocked at sign-in otherwise.
        session = getattr(request, "session", None)
        session_method = session.get("auth_method") if session else None
        session_org_id = session.get("auth_sso_org_id") if session else None
        if session_method == "sso" and session_org_id == str(org_id):
            return next(root, info, **kwargs)

        decision = self._get_org_decision(request, org_id)
        if decision is None:
            return next(root, info, **kwargs)

        blocked, org_name = decision
        if not blocked:
            return next(root, info, **kwargs)

        raise SSORequiredError(org_name, str(org_id))

    @classmethod
    def _get_org_decision(cls, request, org_id):
        cache_l1 = getattr(request, cls._DECISION_CACHE_ATTR, None)
        if cache_l1 is None:
            cache_l1 = {}
            setattr(request, cls._DECISION_CACHE_ATTR, cache_l1)

        key = str(org_id)
        if key in cache_l1:
            return cache_l1[key]

        redis_key = cls._decision_redis_key(org_id)
        try:
            cached = cache.get(redis_key)
        except Exception:
            cached = None
        if cached is not None:
            # Sentinel: [False, ""] means "org not loadable"
            if cached == [False, ""]:
                cache_l1[key] = None
                return None
            decision = (bool(cached[0]), cached[1])
            cache_l1[key] = decision
            return decision

        try:
            org = Organisation.objects.only("require_sso", "name").get(id=org_id)
            decision = (bool(org.require_sso), org.name)
        except Organisation.DoesNotExist:
            decision = None

        try:
            cache.set(
                redis_key,
                [decision[0], decision[1]] if decision else [False, ""],
                timeout=cls._DECISION_REDIS_TTL,
            )
        except Exception:
            pass

        cache_l1[key] = decision
        return decision

    @classmethod
    def _resolve_org_id(cls, request, kwargs, info=None):
        request_cache = getattr(request, cls._ID_CACHE_ATTR, None)
        if request_cache is None:
            request_cache = {}
            setattr(request, cls._ID_CACHE_ATTR, request_cache)

        for direct in ("organisation_id", "org_id"):
            val = kwargs.get(direct)
            if val:
                return str(val)

        for name, value in kwargs.items():
            if not value or not isinstance(name, str):
                continue

            # `<model>_id` — FK auto-discovery in org_resolution.
            if name.endswith("_id"):
                org_id = resolve_org_id(name, value, request_cache)
                if org_id:
                    return org_id
                continue

            # Bare `id` / `ids` — model derived from the mutation's
            # return type or an `org_resource_model` class attribute.
            if name in ("id", "ids"):
                if info is None:
                    continue
                model_name = _model_for_mutation(info)
                if not model_name:
                    continue
                pk = value[0] if name == "ids" and value else value
                if pk and not isinstance(pk, (str, int)):
                    continue
                org_id = resolve_via_model(model_name, pk, request_cache)
                if org_id:
                    return org_id
                continue

            # `*_data` input objects — recurse into their `*_id` fields.
            if name.endswith("_data"):
                org_id = cls._resolve_from_input_value(value, request_cache)
                if org_id:
                    return org_id

        token_id = kwargs.get("token_id")
        if token_id:
            return cls._lookup_token_org(request, token_id)

        return None

    @classmethod
    def _resolve_from_input_value(cls, value, request_cache):
        """Walk an input object (or list of them) for any `<model>_id`."""
        items = value if isinstance(value, (list, tuple)) else [value]
        for item in items:
            if item is None:
                continue
            try:
                entries = (
                    item.items()
                    if hasattr(item, "items")
                    else getattr(item, "__dict__", {}).items()
                )
            except Exception:
                continue
            for key, val in entries:
                if not val or not isinstance(key, str):
                    continue
                if key in ("organisation_id", "org_id"):
                    return str(val)
                if key.endswith("_id"):
                    org_id = resolve_org_id(key, val, request_cache)
                    if org_id:
                        return org_id
        return None

    @classmethod
    def _lookup_token_org(cls, request, token_id):
        """token_id spans four models (UserToken / ServiceToken /
        ServiceAccountToken / EnvironmentToken); probe in order, stop
        on first hit. UUIDs are globally unique so collisions can't
        happen."""
        from api.models import (
            EnvironmentToken,
            ServiceAccountToken,
            ServiceToken,
            UserToken,
        )
        request_cache = getattr(request, cls._ID_CACHE_ATTR, {})
        cache_key = ("token_id", token_id)
        if cache_key in request_cache:
            return request_cache[cache_key]

        org_id = None
        try:
            # UserToken.user is a FK to OrganisationMember (not CustomUser),
            # so ut.user_id is an OrganisationMember PK. Look up the member
            # by .id, not .user_id (which would compare against CustomUser
            # PKs and never match).
            ut = UserToken.objects.only("user_id").get(id=token_id)
            try:
                member = OrganisationMember.objects.only("organisation_id").get(
                    id=ut.user_id, deleted_at__isnull=True
                )
                org_id = str(member.organisation_id)
            except OrganisationMember.DoesNotExist:
                pass
        except UserToken.DoesNotExist:
            pass

        if not org_id:
            try:
                st = ServiceToken.objects.only("app_id").get(id=token_id)
                org_id = resolve_org_id("app_id", st.app_id, request_cache)
            except ServiceToken.DoesNotExist:
                pass

        if not org_id:
            try:
                sat = ServiceAccountToken.objects.only(
                    "service_account_id"
                ).get(id=token_id)
                org_id = resolve_org_id(
                    "service_account_id", sat.service_account_id, request_cache
                )
            except ServiceAccountToken.DoesNotExist:
                pass

        if not org_id:
            try:
                et = EnvironmentToken.objects.only("environment_id").get(id=token_id)
                org_id = resolve_org_id(
                    "environment_id", et.environment_id, request_cache
                )
            except EnvironmentToken.DoesNotExist:
                pass

        request_cache[cache_key] = org_id
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
