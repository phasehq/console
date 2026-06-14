from ee.integrations.secrets.dynamic.graphene.types import (
    DynamicSecretCloneKeyMapEntry,
    DynamicSecretCloneSpecType,
    DynamicSecretProviderType,
)
from ee.integrations.secrets.dynamic.providers import DynamicSecretProviders
from graphql import GraphQLError
from api.models import DynamicSecret, App, Environment, Organisation
from api.utils.access.permissions import (
    user_has_permission,
    user_can_access_app,
    user_can_access_environment,
)


def resolve_dynamic_secret_providers(self, info):
    providers = [
        DynamicSecretProviderType(
            id=provider["id"],
            name=provider["name"],
            credentials=provider["credentials"],
            config_map=provider["config_map"],
        )
        for provider in DynamicSecretProviders.__dict__.values()
        if isinstance(provider, dict)
    ]
    return providers


def resolve_dynamic_secrets(
    root, info, secret_id=None, app_id=None, env_id=None, path=None, org_id=None
):
    user = info.context.user
    filters = {"deleted_at": None}

    if secret_id:
        filters["id"] = secret_id

    elif path is not None:
        filters["path"] = path
    org = None
    app = None

    # Figure out which org to use
    if app_id:
        app = App.objects.get(id=app_id)
        org = app.organisation
    elif env_id:
        env = Environment.objects.get(id=env_id)
        app = env.app
        org = app.organisation
    elif org_id:
        org = Organisation.objects.get(id=org_id)
    else:
        raise GraphQLError(
            "You must provide an app ID, an environment ID, or an organisation ID"
        )

    # Permission check (common to all cases)
    if not user_has_permission(user, "read", "Secrets", org, True, app=app):
        return []

    # Build filters + access checks
    if app_id and env_id:
        if not user_can_access_app(user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        if not user_can_access_environment(user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")

        filters.update({"environment__app__id": app_id, "environment_id": env_id})
        return DynamicSecret.objects.filter(**filters)

    if app_id:
        if not user_can_access_app(user.userId, app_id):
            raise GraphQLError("You don't have access to this app")

        filters.update({"environment__app__id": app_id})
        return DynamicSecret.objects.filter(**filters)

    if env_id:
        if not user_can_access_environment(user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")

        filters.update({"environment_id": env_id})
        return DynamicSecret.objects.filter(**filters)

    if org_id:
        filters.update({"environment__app__organisation_id": org_id})
        return [
            ds
            for ds in DynamicSecret.objects.filter(**filters)
            if user_can_access_app(user.userId, ds.environment.app.id)
        ]


def resolve_dynamic_secret_clone_spec(root, info, source_dynamic_secret_id: str):
    """Return prefill spec for cloning a dynamic secret into another env.

    Includes the source env's plaintext key names (decrypted server-side via
    the SSE env keypair) so the target dialog can seed its key_map without
    round-tripping through the source env's keyring on the client. No
    provider credential values are returned — only the config + auth id.
    """
    from api.utils.crypto import decrypt_asymmetric
    from api.utils.secrets import get_environment_keys

    user = info.context.user
    try:
        ds = DynamicSecret.objects.select_related(
            "environment__app__organisation", "authentication"
        ).get(id=source_dynamic_secret_id, deleted_at__isnull=True)
    except DynamicSecret.DoesNotExist:
        raise GraphQLError("Dynamic secret not found")

    org = ds.environment.app.organisation
    if not user_has_permission(user, "read", "Secrets", org, True, app=ds.environment.app):
        raise GraphQLError("You don't have permission to read this dynamic secret")
    if not user_can_access_environment(user.userId, ds.environment.id):
        raise GraphQLError("You don't have access to the source environment")

    env_pubkey, env_privkey = get_environment_keys(ds.environment.id)
    key_map: list[DynamicSecretCloneKeyMapEntry] = []
    for entry in ds.key_map or []:
        if not isinstance(entry, dict):
            continue
        encrypted = entry.get("key_name") or entry.get("key")
        if not encrypted:
            continue
        try:
            plaintext = decrypt_asymmetric(encrypted, env_privkey, env_pubkey)
        except Exception:
            continue
        key_map.append(
            DynamicSecretCloneKeyMapEntry(id=entry.get("id"), key_name=plaintext)
        )

    return DynamicSecretCloneSpecType(
        provider=ds.provider,
        authentication_id=str(ds.authentication_id) if ds.authentication_id else None,
        authentication_name=ds.authentication.name if ds.authentication_id else None,
        config=ds.config or {},
        key_map=key_map,
        name=ds.name,
        description=ds.description or "",
        default_ttl_seconds=int(ds.default_ttl.total_seconds()),
        max_ttl_seconds=int(ds.max_ttl.total_seconds()),
        source_environment_id=str(ds.environment.id),
        source_environment_name=ds.environment.name,
    )
