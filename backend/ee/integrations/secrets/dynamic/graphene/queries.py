from ee.integrations.secrets.dynamic.graphene.types import DynamicSecretProviderType
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
    root, info, secret_id=None, app_id=None, env_id=None, org_id=None
):
    user = info.context.user
    filters = {"deleted_at": None}

    if secret_id:
        filters["id"] = secret_id

    org = None

    # Figure out which org to use
    if app_id:
        app = App.objects.get(id=app_id)
        org = app.organisation
    elif env_id:
        env = Environment.objects.get(id=env_id)
        org = env.app.organisation
    elif org_id:
        org = Organisation.objects.get(id=org_id)
    else:
        raise GraphQLError(
            "You must provide an app ID, an environment ID, or an organisation ID"
        )

    # Permission check (common to all cases)
    if not user_has_permission(user, "read", "Secrets", org, True):
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
