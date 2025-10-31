from api.utils.access.permissions import (
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from api.utils.secrets import create_environment_folder_structure
from ee.integrations.secrets.dynamic.utils import (
    create_dynamic_secret,
    validate_key_map,
)

from ee.integrations.secrets.dynamic.graphene.types import (
    DynamicSecretType,
    KeyMapInput,
)

from datetime import timedelta
import graphene
from graphql import GraphQLError
from django.core.exceptions import ValidationError
from api.models import (
    DynamicSecret,
    Organisation,
    Environment,
    OrganisationMember,
    ProviderCredentials,
)
from graphene.types.generic import GenericScalar


class AWSConfigInput(graphene.InputObjectType):
    username_template = graphene.String(required=True)
    iam_path = graphene.String(required=False, default_value="/")
    permission_boundary_arn = graphene.String(required=False)
    groups = graphene.String(required=False)  # comma-separated
    policy_arns = graphene.String(required=False)  # comma-separated
    policy_document = GenericScalar(required=False)


class CreateAWSDynamicSecretMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        environment_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        description = graphene.String(required=False)
        path = graphene.String(required=False)
        default_ttl = graphene.Int()  # seconds
        max_ttl = graphene.Int()  # seconds
        authentication_id = graphene.ID(required=False)
        config = AWSConfigInput(required=True)
        key_map = graphene.List(KeyMapInput, required=True)

    dynamic_secret = graphene.Field(DynamicSecretType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        environment_id,
        name,
        config,
        key_map,
        description="",
        path="/",
        default_ttl=None,
        max_ttl=None,
        authentication_id=None,
    ):
        user = info.context.user

        # --- permission checks ---
        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(user, "create", "Secrets", org, True):
            raise GraphQLError("You don't have permission to create Dynamic Secrets")

        if not user_can_access_environment(user.userId, environment_id):
            raise GraphQLError("You don't have access to this environment")

        env = Environment.objects.get(id=environment_id)

        if not env.app.sse_enabled:
            raise GraphQLError("SSE is not enabled!")

        authentication = None
        if authentication_id:
            try:
                authentication = ProviderCredentials.objects.get(
                    id=authentication_id, organisation=org
                )
            except ProviderCredentials.DoesNotExist:
                raise GraphQLError("Invalid authentication credentials")

        try:
            validated_key_map = validate_key_map(key_map, "aws", env, path)
            key_map = validated_key_map
        except ValidationError as e:
            message = f"Error creating secret: {e.messages[0]}"
            raise GraphQLError(message)

        # --- create secret ---
        try:
            dynamic_secret = create_dynamic_secret(
                environment=Environment.objects.get(id=environment_id),
                path=path,
                name=name,
                description=description,
                default_ttl=timedelta(seconds=default_ttl),
                max_ttl=timedelta(seconds=max_ttl),
                authentication=authentication,
                provider="aws",
                config=config,
                key_map=key_map,
            )
        except ValidationError as e:
            raise GraphQLError(e.message)

        return CreateAWSDynamicSecretMutation(dynamic_secret=dynamic_secret)


class UpdateAWSDynamicSecretMutation(graphene.Mutation):
    class Arguments:
        dynamic_secret_id = graphene.ID(required=True)
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        description = graphene.String(required=False)
        path = graphene.String(required=False)
        default_ttl = graphene.Int()  # seconds
        max_ttl = graphene.Int()  # seconds
        authentication_id = graphene.ID(required=False)
        config = AWSConfigInput(required=True)
        key_map = graphene.List(KeyMapInput, required=True)

    dynamic_secret = graphene.Field(DynamicSecretType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        dynamic_secret_id,
        organisation_id,
        name,
        config,
        key_map,
        description="",
        path=None,
        default_ttl=None,
        max_ttl=None,
        authentication_id=None,
    ):
        user = info.context.user

        # --- permission checks ---
        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")

        org = Organisation.objects.get(id=organisation_id)

        dynamic_secret = DynamicSecret.objects.get(id=dynamic_secret_id)

        env = Environment.objects.get(id=dynamic_secret.environment.id)

        if not user_has_permission(user, "update", "Secrets", org, True):
            raise GraphQLError("You don't have permission to update Dynamic Secrets")

        if not user_can_access_environment(user.userId, dynamic_secret.environment.id):
            raise GraphQLError("You don't have access to this environment")

        if not env.app.sse_enabled:
            raise GraphQLError("SSE is not enabled!")

        folder = None
        if path is not None and path != "/":
            folder = create_environment_folder_structure(
                path, dynamic_secret.environment.id
            )

        authentication = None
        if authentication_id:
            try:
                authentication = ProviderCredentials.objects.get(
                    id=authentication_id, organisation=org
                )
            except ProviderCredentials.DoesNotExist:
                raise GraphQLError("Invalid authentication credentials")

        # --- ensure name is unique in this environment and path ---
        if (
            DynamicSecret.objects.filter(
                environment=dynamic_secret.environment,
                path=path,
                name=name,
                deleted_at=None,
            )
            .exclude(id=dynamic_secret_id)
            .exists()
        ):
            raise GraphQLError(
                f"A dynamic secret with name '{name}' already exists at this path."
            )

        # --- update secret fields ---
        dynamic_secret.name = name
        dynamic_secret.description = description
        if folder is not None:
            dynamic_secret.folder = folder
        dynamic_secret.default_ttl = (
            timedelta(seconds=default_ttl) if default_ttl else None
        )
        dynamic_secret.max_ttl = timedelta(seconds=max_ttl) if max_ttl else None
        dynamic_secret.authentication = authentication
        dynamic_secret.config = config

        try:
            validated_key_map = validate_key_map(
                key_map,
                dynamic_secret.provider,
                dynamic_secret.environment,
                path,
                dynamic_secret.id,
            )
            dynamic_secret.key_map = validated_key_map
        except ValidationError as e:
            message = f"Error updating secret: {e.messages[0]}"
            raise GraphQLError(message)

        dynamic_secret.save()

        return UpdateAWSDynamicSecretMutation(dynamic_secret=dynamic_secret)
