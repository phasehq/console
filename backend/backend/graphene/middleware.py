from graphql import GraphQLResolveInfo
from graphql import GraphQLError
from graphql.type import GraphQLList, GraphQLNonNull, GraphQLObjectType
from api.models import (
    NetworkAccessPolicy,
    Organisation,
    OrganisationMember,
    OrganisationMemberInvite,
)

from collections import defaultdict
from itertools import chain
from django.core.cache import cache
from django.utils import timezone

from api.utils.access.ip import get_client_ip
from api.utils.access.org_resolution import (
    model_for_kwarg,
    resolve_org_id,
    resolve_org_ids_via_model,
    resolve_via_model,
)


def _output_graphene_type(info: GraphQLResolveInfo):
    """Unwrap NonNull/List wrappers from the mutation's return type and
    return the underlying Graphene class (or None)."""
    return_type = info.return_type
    while isinstance(return_type, (GraphQLNonNull, GraphQLList)):
        return_type = return_type.of_type
    if not isinstance(return_type, GraphQLObjectType):
        return None
    return getattr(return_type, "graphene_type", None)


def _bypasses_sso_enforcement(info: GraphQLResolveInfo) -> bool:
    """SSO admin mutations carry `bypass_sso_enforcement = True` so an
    admin locked out by their own require_sso=True config can recover.
    Per-mutation Owner/Admin role gating remains the safety net."""
    graphene_type = _output_graphene_type(info)
    return bool(getattr(graphene_type, "bypass_sso_enforcement", False))


def _model_for_mutation(info: GraphQLResolveInfo):
    """Derive the Django model a mutation operates on for the bare-`id`/
    `ids` case. Reads `org_resource_model` if declared, else the model of
    a query's own `DjangoObjectType` output (e.g. `secrets(id)`), else
    picks the first `DjangoObjectType`-backed field on the mutation's
    output."""
    graphene_type = _output_graphene_type(info)
    if graphene_type is None:
        return None

    explicit = getattr(graphene_type, "org_resource_model", None)
    if explicit:
        return explicit

    own_model = getattr(getattr(graphene_type, "_meta", None), "model", None)
    if own_model is not None:
        return own_model.__name__

    return_type = info.return_type
    while isinstance(return_type, (GraphQLNonNull, GraphQLList)):
        return_type = return_type.of_type
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


def _input_fields(value):
    """The (name, value) pairs of an input object, or of each one in a list."""
    items = value if isinstance(value, (list, tuple)) else [value]
    for item in items:
        if item is None:
            continue
        if hasattr(item, "items"):
            yield from item.items()
        else:
            yield from getattr(item, "__dict__", {}).items()


class IPRestrictedError(GraphQLError):
    def __init__(self, organisation_name: str):
        super().__init__(
            message=f"Your IP address is not allowed to access {organisation_name}",
            extensions={
                "code": "IP_RESTRICTED",
                "organisation_name": organisation_name,
            },
        )


# Invite bootstrap: reading and accepting an invite. Exempted from SSO
# enforcement for the invite holder, because requiring an org-SSO session
# to JOIN is circular — org-SSO login only resolves identities linked to a
# current member, and membership is what acceptance creates. Both resolvers
# independently verify the caller's email matches the invite, so the
# exemption grants exactly one capability: accepting your own invite.
# Matched by ROOT field name (parent type Query/Mutation) — never reuse
# these names for a new field without revisiting this exemption.
INVITE_BOOTSTRAP_FIELDS = frozenset({"validateInvite", "createOrganisationMember"})


def _is_invite_bootstrap_field(info: GraphQLResolveInfo) -> bool:
    return (
        info.field_name in INVITE_BOOTSTRAP_FIELDS
        and getattr(info.parent_type, "name", None) in ("Query", "Mutation")
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

        if not kwargs or not user or not user.is_authenticated:
            return next(root, info, **kwargs)

        # SSO admin mutations carry an opt-in bypass so a misconfigured
        # require_sso=True org isn't a UI dead-end. Per-mutation role
        # checks remain in force.
        if _bypasses_sso_enforcement(info):
            return next(root, info, **kwargs)

        session = getattr(request, "session", None)
        session_method = session.get("auth_method") if session else None
        session_org_id = session.get("auth_sso_org_id") if session else None

        # Refused if any org the arguments name requires SSO for this session.
        for org_id in sorted(self._org_ids(request, kwargs, info)):
            # Skip enforcement when the session is already SSO-bound to this
            # org — it would have been blocked at sign-in otherwise.
            if session_method == "sso" and session_org_id == org_id:
                continue

            decision = self._get_org_decision(request, org_id)
            if decision is None:
                continue

            require_sso, org_name = decision

            # Block on require_sso OR per-member SCIM (IdP is the source of
            # truth for SCIM-provisioned access to this org).
            if not (require_sso or self._is_scim_managed(request, user, org_id)):
                continue

            # Invite bootstrap exemption — checked last so the invite query
            # only runs when we would otherwise refuse.
            if _is_invite_bootstrap_field(info) and self._holds_valid_invite(
                request, user, org_id
            ):
                continue

            raise SSORequiredError(org_name, org_id)

        return next(root, info, **kwargs)

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
    def _is_scim_managed(cls, request, user, org_id):
        """Whether `user` is a SCIM-managed member of `org_id`.
        Cached per-(user, org) within the request scope."""
        cache_attr = "_scim_managed_cache"
        request_cache = getattr(request, cache_attr, None)
        if request_cache is None:
            request_cache = {}
            setattr(request, cache_attr, request_cache)

        user_id = getattr(user, "userId", None) or getattr(user, "id", None) or user
        key = (str(user_id), str(org_id))
        if key in request_cache:
            return request_cache[key]

        result = OrganisationMember.objects.filter(
            organisation_id=org_id,
            user=user,
            deleted_at__isnull=True,
            scimuser__isnull=False,
            scimuser__active=True,
        ).exists()
        request_cache[key] = result
        return result

    @classmethod
    def _holds_valid_invite(cls, request, user, org_id):
        """Whether `user` holds a valid, unexpired invite to `org_id`.
        Cached per-(user, org) within the request scope."""
        cache_attr = "_invite_holder_cache"
        request_cache = getattr(request, cache_attr, None)
        if request_cache is None:
            request_cache = {}
            setattr(request, cache_attr, request_cache)

        email = getattr(user, "email", None)
        if not email:
            return False

        key = (email.lower(), str(org_id))
        if key in request_cache:
            return request_cache[key]

        result = OrganisationMemberInvite.objects.filter(
            organisation_id=org_id,
            invitee_email__iexact=email,
            valid=True,
            expires_at__gt=timezone.now(),
        ).exists()
        request_cache[key] = result
        return result

    @classmethod
    def _org_ids(cls, request, kwargs, info=None):
        """Every org the arguments name: each ID of a list, each item of a
        `*_data` / `*_inputs` input list, and bare `id`s inside those items.
        Other input objects aren't walked: `confirmEmailChange(keyrings)`
        names each of the user's orgs."""
        request_cache = getattr(request, cls._ID_CACHE_ATTR, None)
        if request_cache is None:
            request_cache = {}
            setattr(request, cls._ID_CACHE_ATTR, request_cache)

        org_ids = set()
        bare_ids = []
        # (model, kwarg name or None for a bare id) -> IDs
        named = defaultdict(list)

        def add(name, value):
            if not value or not isinstance(name, str):
                return
            values = value if isinstance(value, (list, tuple)) else [value]
            values = [item for item in values if isinstance(item, (str, int))]
            if name in ("organisation_id", "org_id"):
                org_ids.update(str(item) for item in values)
            elif name in ("id", "ids"):
                bare_ids.extend(values)
            elif name == "token_id":
                org_ids.update(cls._lookup_token_org(request, item) for item in values)
            else:
                kwarg = name[:-1] if name.endswith("_ids") else name
                model_name = model_for_kwarg(kwarg)
                if model_name:
                    named[(model_name, kwarg)].extend(values)

        for name, value in kwargs.items():
            if isinstance(name, str) and name.endswith(("_data", "_inputs")):
                for field, field_value in _input_fields(value):
                    add(field, field_value)
            else:
                add(name, value)

        # Bare `id` / `ids` — model derived from the mutation's return type
        # or an `org_resource_model` class attribute.
        if bare_ids and info is not None:
            model_name = _model_for_mutation(info)
            if model_name:
                named[(model_name, None)].extend(bare_ids)

        for (model_name, kwarg), values in named.items():
            values = list(dict.fromkeys(values))
            # One ID: the shared lookup, cached in Redis. A miss there may be
            # stale, so a miss, and every list, takes one query.
            if len(values) == 1:
                org_id = (
                    resolve_org_id(kwarg, values[0], request_cache)
                    if kwarg
                    else resolve_via_model(model_name, values[0], request_cache)
                )
                if org_id:
                    org_ids.add(org_id)
                    continue
            org_ids |= resolve_org_ids_via_model(model_name, values, request_cache)

        return {str(org_id) for org_id in org_ids if org_id}

    @classmethod
    def _lookup_token_org(cls, request, token_id):
        """token_id spans UserToken / ServiceAccountToken /
        EnvironmentToken / SCIMToken; probe in order, stop
        on first hit. UUIDs are globally unique so collisions can't
        happen."""
        from api.models import (
            EnvironmentToken,
            SCIMToken,
            ServiceAccountToken,
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

        if not org_id:
            try:
                st = SCIMToken.objects.only("organisation_id").get(id=token_id)
                org_id = str(st.organisation_id)
            except SCIMToken.DoesNotExist:
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
