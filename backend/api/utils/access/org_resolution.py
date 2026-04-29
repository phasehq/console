"""Resolve an Organisation from a GraphQL resolver kwarg.

Auto-discovers the FK path from each Django model to Organisation via
BFS so the SSO-enforcement middleware doesn't need a hand-maintained
dispatch table — forgetting to register a new resolver otherwise
becomes a silent enforcement bypass.

Three cache layers: per-request dict (L1), Django cache / Redis (L2),
and the DB as fallback.
"""

from collections import deque
from functools import lru_cache

from django.apps import apps
from django.core.cache import cache


# Hand-maintained: kwargs whose model name doesn't match `<snake_case>_id`.
KWARG_MODEL_ALIASES = {
    "env_id": "Environment",
    "environment_id": "Environment",
    "member_id": "OrganisationMember",
    "invite_id": "OrganisationMemberInvite",
    "provider_id": "OrganisationSSOProvider",
    "account_id": "ServiceAccount",
    "sa_id": "ServiceAccount",
    "lease_id": "DynamicSecretLease",
    "policy_id": "NetworkAccessPolicy",
    "credential_id": "ProviderCredentials",
    "sync_id": "EnvironmentSync",
}

# Handled by the middleware's dedicated probe (multiple backing models).
AMBIGUOUS_KWARGS = frozenset({"token_id"})

_CACHE_TTL = 3600
_CACHE_NEGATIVE = ""  # sentinel: looked up, no match


def _redis_key(kind: str, id_value) -> str:
    return f"org_for:{kind}:{id_value}"


def _snake_to_pascal(name: str) -> str:
    return "".join(part.title() for part in name.split("_"))


@lru_cache(maxsize=None)
def _path_to_organisation(model_name: str):
    try:
        Model = apps.get_model("api", model_name)
    except LookupError:
        return None
    Organisation = apps.get_model("api", "Organisation")

    if Model is Organisation:
        return "id"

    queue = deque([(Model, [])])
    visited = {Model}
    while queue:
        cls, path = queue.popleft()
        for field in cls._meta.get_fields():
            if not (field.is_relation and field.many_to_one and not field.auto_created):
                continue
            related = field.related_model
            if related is None:
                continue
            new_path = path + [field.name]
            if related is Organisation:
                return "__".join(new_path + ["id"])
            if related not in visited:
                visited.add(related)
                queue.append((related, new_path))
    return None


def _resolve_from_db(kwarg_name: str, id_value) -> str | None:
    if kwarg_name in ("org_id", "organisation_id"):
        return str(id_value)
    if not kwarg_name.endswith("_id"):
        return None

    model_name = KWARG_MODEL_ALIASES.get(kwarg_name) or _snake_to_pascal(
        kwarg_name[:-3]
    )
    return _resolve_via_model(model_name, id_value)


def _resolve_via_model(model_name: str, id_value) -> str | None:
    """Walk `model_name.pk == id_value` to its Organisation FK."""
    path = _path_to_organisation(model_name)
    if not path:
        return None

    try:
        Model = apps.get_model("api", model_name)
    except LookupError:
        return None

    try:
        org_id = (
            Model.objects.filter(pk=id_value).values_list(path, flat=True).first()
        )
    except Exception:
        return None
    return str(org_id) if org_id else None


def resolve_via_model(model_name: str, id_value, request_cache: dict):
    """Like `resolve_org_id` but model is known by the caller (e.g. the
    middleware's bare-`id` dispatch). Same three-tier cache."""
    if not id_value:
        return None

    l1_key = (f"__model__:{model_name}", id_value)
    if l1_key in request_cache:
        return request_cache[l1_key]

    kind = _model_name_to_default_kwarg_kind(model_name)
    redis_key = _redis_key(kind, id_value)
    try:
        cached = cache.get(redis_key)
    except Exception:
        cached = None
    if cached is not None:
        result = cached or None
        request_cache[l1_key] = result
        return result

    result = _resolve_via_model(model_name, id_value)

    try:
        cache.set(redis_key, result or _CACHE_NEGATIVE, timeout=_CACHE_TTL)
    except Exception:
        pass
    request_cache[l1_key] = result
    return result


def resolve_org_id(kwarg_name: str, id_value, request_cache: dict):
    if not id_value or kwarg_name in AMBIGUOUS_KWARGS:
        return None
    if kwarg_name in ("org_id", "organisation_id"):
        return str(id_value)
    if not kwarg_name.endswith("_id"):
        return None

    l1_key = (kwarg_name, id_value)
    if l1_key in request_cache:
        return request_cache[l1_key]

    kind = KWARG_MODEL_ALIASES.get(kwarg_name, kwarg_name[:-3])
    redis_key = _redis_key(kind, id_value)
    try:
        cached = cache.get(redis_key)
    except Exception:
        cached = None
    if cached is not None:
        result = cached or None
        request_cache[l1_key] = result
        return result

    result = _resolve_from_db(kwarg_name, id_value)

    try:
        cache.set(redis_key, result or _CACHE_NEGATIVE, timeout=_CACHE_TTL)
    except Exception:
        pass
    request_cache[l1_key] = result
    return result


def invalidate_org_for(model_class, pk) -> None:
    model_name = model_class.__name__
    kinds = {_model_name_to_default_kwarg_kind(model_name)}
    for kwarg, aliased in KWARG_MODEL_ALIASES.items():
        if aliased == model_name:
            kinds.add(kwarg[:-3])
    for kind in kinds:
        try:
            cache.delete(_redis_key(kind, pk))
        except Exception:
            pass


def _model_name_to_default_kwarg_kind(model_name: str) -> str:
    out = []
    for i, ch in enumerate(model_name):
        if ch.isupper() and i > 0:
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


def register_invalidation_signals() -> None:
    """Wire post_delete on every org-scoped model. Soft-delete doesn't
    invalidate because the org mapping remains valid for the soft-deleted
    row; only hard deletes need to clear the cache."""
    from django.db.models.signals import post_delete

    Organisation = apps.get_model("api", "Organisation")
    for model in apps.get_models():
        if model._meta.app_label != "api":
            continue
        if model is Organisation:
            continue
        if _path_to_organisation(model.__name__) is None:
            continue

        def _handler(sender, instance, **_kwargs):
            invalidate_org_for(sender, instance.pk)

        post_delete.connect(_handler, sender=model, weak=False)
