from __future__ import annotations

from graphql import GraphQLError

from api.models import App, Environment, Organisation, ProviderCredentials, RotatingSecret
from api.utils.access.permissions import (
    user_can_access_app,
    user_can_access_environment,
    user_has_permission,
)
from api.utils.syncing.auth import get_credentials
from ee.integrations.secrets.providers.exceptions import (
    ProviderError,
    ProviderNotRegisteredError,
)
from ee.integrations.secrets.providers.openai import OpenAIProvider
from ee.integrations.secrets.rotation.providers import all_providers, get_provider

from .types import (
    OpenAIProjectType,
    RotationCloneKeyMapEntry,
    RotationCloneSpecType,
    RotationProviderType,
    serialize_provider,
)


def resolve_rotation_providers(self, info) -> list[RotationProviderType]:
    return [serialize_provider(p) for p in all_providers()]


def resolve_rotating_secrets(
    root,
    info,
    secret_id=None,
    app_id=None,
    env_id=None,
    path=None,
    org_id=None,
):
    user = info.context.user
    filters = {"deleted_at__isnull": True}

    if secret_id:
        filters["id"] = secret_id
    elif path is not None:
        filters["path"] = path

    org = None
    app = None
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

    if not user_has_permission(user, "read", "RotatingSecrets", org, True, app=app):
        return []

    if app_id and env_id:
        if not user_can_access_app(user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        if not user_can_access_environment(user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")
        filters.update({"environment__app__id": app_id, "environment_id": env_id})
        return RotatingSecret.objects.filter(**filters)

    # When no specific env is given, we still have to gate per-env access —
    # app-level access alone would leak rotating-secret metadata from envs
    # the caller isn't provisioned for.
    if app_id:
        if not user_can_access_app(user.userId, app_id):
            raise GraphQLError("You don't have access to this app")
        filters.update({"environment__app__id": app_id})
        return [
            rs
            for rs in RotatingSecret.objects.filter(**filters)
            if user_can_access_environment(user.userId, rs.environment.id)
        ]

    if env_id:
        if not user_can_access_environment(user.userId, env_id):
            raise GraphQLError("You don't have access to this environment")
        filters.update({"environment_id": env_id})
        return RotatingSecret.objects.filter(**filters)

    if org_id:
        filters.update({"environment__app__organisation_id": org_id})
        return [
            rs
            for rs in RotatingSecret.objects.filter(**filters)
            if user_can_access_app(user.userId, rs.environment.app.id)
            and user_can_access_environment(user.userId, rs.environment.id)
        ]


def resolve_rotation_provider_import_template(
    root,
    info,
    provider_id: str,
    authentication_id: str,
    template_ref: str,
):
    """Fetch a provider template's config as JSON for the rotating-secret create flow."""
    user = info.context.user
    try:
        authentication = ProviderCredentials.objects.get(id=authentication_id)
    except ProviderCredentials.DoesNotExist:
        raise GraphQLError("Invalid authentication credentials")

    org = authentication.organisation
    if not user_has_permission(user, "create", "RotatingSecrets", org, True):
        raise GraphQLError("You don't have permission to import rotation templates")

    try:
        provider_cls = get_provider(provider_id)
    except ProviderNotRegisteredError as e:
        raise GraphQLError(str(e))

    importer = getattr(provider_cls, "import_config_from_template", None)
    if importer is None:
        raise GraphQLError(
            f"Provider '{provider_id}' does not support template import"
        )

    root_creds = get_credentials(authentication.id)
    try:
        config = importer(root_creds, template_ref)
    except ProviderError as e:
        raise GraphQLError(e.user_message)

    if config is None:
        raise GraphQLError(
            f"Provider '{provider_id}' returned no importable config for that template"
        )
    return config


def resolve_openai_projects(root, info, authentication_id: str):
    """List OpenAI projects visible to the given admin-key credentials."""
    user = info.context.user
    try:
        authentication = ProviderCredentials.objects.get(id=authentication_id)
    except ProviderCredentials.DoesNotExist:
        raise GraphQLError("Invalid authentication credentials")

    org = authentication.organisation
    if not user_has_permission(user, "create", "RotatingSecrets", org, True):
        raise GraphQLError(
            "You don't have permission to list OpenAI projects with these credentials"
        )

    if authentication.provider != "openai":
        raise GraphQLError(
            "These credentials are not for an OpenAI provider"
        )

    root_creds = get_credentials(authentication.id)
    try:
        projects = OpenAIProvider.list_projects(root_creds)
    except ProviderError as e:
        raise GraphQLError(e.user_message)

    return [
        OpenAIProjectType(
            id=p.get("id"), name=p.get("name") or p.get("id"), status=p.get("status")
        )
        for p in projects
    ]


def resolve_rotation_clone_spec(root, info, source_rotating_secret_id: str):
    """Return prefill spec for cloning a rotating secret into another env.

    Includes the source env's plaintext key names (decrypted server-side
    via the SSE env keypair) so the target dialog can seed its key_map
    without round-tripping through the source env's keyring on the client.
    No provider credential values are returned — only the config + auth id.
    """
    from api.utils.crypto import decrypt_asymmetric
    from api.utils.secrets import get_environment_keys

    user = info.context.user
    try:
        rs = RotatingSecret.objects.select_related(
            "environment__app__organisation", "authentication"
        ).get(id=source_rotating_secret_id, deleted_at__isnull=True)
    except RotatingSecret.DoesNotExist:
        raise GraphQLError("Rotating secret not found")

    org = rs.environment.app.organisation
    if not user_has_permission(
        user, "read", "RotatingSecrets", org, True, app=rs.environment.app
    ):
        raise GraphQLError("You don't have permission to read this rotating secret")
    if not user_can_access_environment(user.userId, rs.environment.id):
        raise GraphQLError("You don't have access to the source environment")

    env_pubkey, env_privkey = get_environment_keys(rs.environment.id)
    key_map: list[RotationCloneKeyMapEntry] = []
    for entry in rs.key_map or []:
        if not isinstance(entry, dict):
            continue
        encrypted = entry.get("key_name") or entry.get("key")
        if not encrypted:
            continue
        try:
            plaintext = decrypt_asymmetric(encrypted, env_privkey, env_pubkey)
        except Exception:
            continue
        key_map.append(RotationCloneKeyMapEntry(id=entry.get("id"), key_name=plaintext))

    return RotationCloneSpecType(
        provider=rs.provider,
        authentication_id=str(rs.authentication_id) if rs.authentication_id else None,
        authentication_name=rs.authentication.name if rs.authentication_id else None,
        config=rs.config or {},
        key_map=key_map,
        name=rs.name,
        description=rs.description or "",
        rotation_interval_seconds=int(rs.rotation_interval.total_seconds()),
        revocation_delay_seconds=int(rs.revocation_delay.total_seconds()),
        source_environment_id=str(rs.environment.id),
        source_environment_name=rs.environment.name,
    )
