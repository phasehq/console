from __future__ import annotations

from datetime import timedelta

import graphene
from django.core.exceptions import ValidationError
from django.db import transaction
from graphene.types.generic import GenericScalar
from graphql import GraphQLError

from api.models import (
    Environment,
    Organisation,
    ProviderCredentials,
    RotatingSecret,
    RotatingSecretCredential,
)
from api.utils.access.permissions import (
    user_can_access_environment,
    user_has_permission,
    user_is_org_member,
)
from api.utils.audit_logging import get_actor_info_from_graphql, log_audit_event
from api.utils.crypto import decrypt_asymmetric, get_server_keypair
from api.utils.rest import get_resolver_request_meta
from api.utils.secrets import create_environment_folder_structure, normalize_path_string
from backend.quotas import can_use_rotating_secrets
from ee.integrations.secrets.rotation.engine import (
    manual_rotate as engine_manual_rotate,
    pause as engine_pause,
    perform_initial_rotation,
    resume as engine_resume,
    revoke_credential,
    cancel_rotation_jobs,
    record_event,
)
from ee.integrations.secrets.providers.exceptions import (
    ProviderError,
    ProviderNotRegisteredError,
)
from ee.integrations.secrets.rotation.providers import ROTATION_PROVIDERS, get_provider
from ee.integrations.secrets.rotation.utils import (
    assert_sse_enabled,
    validate_key_map,
    validate_provider_config,
)

from .types import KeyMapInput, RotatingSecretType


def _actor_kwargs(info):
    user = info.context.user
    org_member = None
    try:
        from api.models import OrganisationMember

        org_member = OrganisationMember.objects.filter(
            user=user, deleted_at=None
        ).first()
    except Exception:
        pass
    try:
        ip_address, user_agent = get_resolver_request_meta(info.context)
    except Exception:
        ip_address, user_agent = (None, None)
    return {
        "organisation_member": org_member,
        "ip_address": ip_address,
        "user_agent": user_agent,
    }


def _audit_actor(info, organisation):
    actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(
        info, organisation=organisation
    )
    try:
        ip_address, user_agent = get_resolver_request_meta(info.context)
    except Exception:
        ip_address, user_agent = (None, "")
    return {
        "actor_type": actor_type,
        "actor_id": actor_id,
        "actor_metadata": actor_metadata,
        "ip_address": ip_address,
        "user_agent": user_agent or "",
    }


def _rs_resource_metadata(rs):
    return {
        "name": rs.name,
        "provider": rs.provider,
        "environment_id": str(rs.environment_id),
        "app_id": str(rs.environment.app_id),
        "path": rs.path,
    }


class CreateRotatingSecretMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        environment_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        description = graphene.String(required=False)
        path = graphene.String(required=False)
        provider = graphene.String(required=True)
        authentication_id = graphene.ID(required=True)
        config = GenericScalar(required=True)
        key_map = graphene.List(KeyMapInput, required=True)
        rotation_interval_seconds = graphene.Int(required=True)
        revocation_delay_seconds = graphene.Int(required=False)

    rotating_secret = graphene.Field(RotatingSecretType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        environment_id,
        name,
        provider,
        authentication_id,
        config,
        key_map,
        rotation_interval_seconds,
        description="",
        path="/",
        revocation_delay_seconds=0,
    ):
        user = info.context.user

        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")
        org = Organisation.objects.get(id=organisation_id)
        env = Environment.objects.get(id=environment_id)

        if not user_has_permission(
            user, "create", "RotatingSecrets", org, True, app=env.app
        ):
            raise GraphQLError("You don't have permission to create rotating secrets")
        if not user_can_access_environment(user.userId, environment_id):
            raise GraphQLError("You don't have access to this environment")

        # SSE is required: the server must encrypt minted values.
        assert_sse_enabled(env.app)

        if not can_use_rotating_secrets(org):
            raise GraphQLError(
                "Rotating Secrets require a Pro or Enterprise plan, or an activated license."
            )

        try:
            validate_provider_config(provider, config)
        except ProviderNotRegisteredError as e:
            raise GraphQLError(str(e))
        except ProviderError as e:
            raise GraphQLError(e.user_message)

        try:
            authentication = ProviderCredentials.objects.get(
                id=authentication_id, organisation=org
            )
        except ProviderCredentials.DoesNotExist:
            raise GraphQLError("Invalid authentication credentials")

        if rotation_interval_seconds < 60:
            raise GraphQLError("Rotation interval must be at least 60 seconds")
        if revocation_delay_seconds < 0:
            raise GraphQLError("Revocation delay cannot be negative")
        if revocation_delay_seconds >= rotation_interval_seconds:
            raise GraphQLError(
                "Revocation delay must be less than the rotation interval"
            )

        try:
            path = normalize_path_string(path or "/")
        except Exception:
            path = "/"

        try:
            validated_key_map = validate_key_map(key_map, provider, env, path)
        except ValidationError as e:
            raise GraphQLError(
                f"Error creating rotating secret: {e.messages[0] if e.messages else e}"
            )

        if RotatingSecret.objects.filter(
            environment=env, path=path, name=name, deleted_at__isnull=True
        ).exists():
            raise GraphQLError(
                f"A rotating secret named '{name}' already exists at this path"
            )

        folder = None
        if path and path != "/":
            folder = create_environment_folder_structure(path, env.id)

        try:
            with transaction.atomic():
                rs = RotatingSecret.objects.create(
                    environment=env,
                    folder=folder,
                    path=path,
                    name=name,
                    description=description,
                    provider=provider,
                    authentication=authentication,
                    config=config,
                    key_map=validated_key_map,
                    rotation_interval=timedelta(seconds=rotation_interval_seconds),
                    revocation_delay=timedelta(seconds=revocation_delay_seconds),
                )
                actor_kwargs = _actor_kwargs(info)
                record_event(
                    rs,
                    "config_created",
                    metadata={
                        "name": name,
                        "provider": provider,
                        "rotation_interval_seconds": rotation_interval_seconds,
                        "revocation_delay_seconds": revocation_delay_seconds,
                    },
                    **actor_kwargs,
                )
                # Synchronous so a mint failure rolls back the create.
                perform_initial_rotation(rs, actor_kwargs=actor_kwargs)
        except ProviderError as e:
            raise GraphQLError(f"Failed to mint initial credential: {e.user_message}")

        rs.refresh_from_db()
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="rs",
            resource_id=rs.id,
            resource_metadata=_rs_resource_metadata(rs),
            new_values={
                "name": rs.name,
                "provider": rs.provider,
                "rotation_interval_seconds": rotation_interval_seconds,
                "revocation_delay_seconds": revocation_delay_seconds,
            },
            description=f"Created rotating secret '{rs.name}' ({rs.provider})",
            **_audit_actor(info, org),
        )
        return CreateRotatingSecretMutation(rotating_secret=rs)


class UpdateRotatingSecretMutation(graphene.Mutation):
    class Arguments:
        rotating_secret_id = graphene.ID(required=True)
        name = graphene.String(required=False)
        description = graphene.String(required=False)
        rotation_interval_seconds = graphene.Int(required=False)
        revocation_delay_seconds = graphene.Int(required=False)
        is_active = graphene.Boolean(required=False)
        config = GenericScalar(required=False)
        authentication_id = graphene.ID(required=False)

    rotating_secret = graphene.Field(RotatingSecretType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        rotating_secret_id,
        name=None,
        description=None,
        rotation_interval_seconds=None,
        revocation_delay_seconds=None,
        is_active=None,
        config=None,
        authentication_id=None,
    ):
        user = info.context.user
        try:
            rs = RotatingSecret.objects.get(
                id=rotating_secret_id, deleted_at__isnull=True
            )
        except RotatingSecret.DoesNotExist:
            raise GraphQLError("Rotating secret not found")

        org = rs.environment.app.organisation
        if not user_has_permission(
            user, "update", "RotatingSecrets", org, True, app=rs.environment.app
        ):
            raise GraphQLError("You don't have permission to update rotating secrets")

        actor_kwargs = _actor_kwargs(info)
        changed = {}

        if name is not None and name != rs.name:
            rs.name = name
            changed["name"] = name
        if description is not None and description != rs.description:
            rs.description = description
            changed["description"] = description
        if config is not None:
            try:
                validate_provider_config(rs.provider, config)
            except ProviderError as e:
                raise GraphQLError(e.user_message)
            rs.config = config
            changed["config"] = True
        if authentication_id is not None and str(authentication_id) != str(rs.authentication_id):
            try:
                new_auth = ProviderCredentials.objects.get(
                    id=authentication_id, organisation=org
                )
            except ProviderCredentials.DoesNotExist:
                raise GraphQLError("Invalid authentication credentials")
            if new_auth.provider != rs.provider:
                raise GraphQLError(
                    "Selected credentials are for a different provider"
                )
            rs.authentication = new_auth
            changed["authentication_id"] = str(new_auth.id)

        interval_changed = False
        if rotation_interval_seconds is not None:
            if rotation_interval_seconds < 60:
                raise GraphQLError("Rotation interval must be at least 60 seconds")
            new_interval = timedelta(seconds=rotation_interval_seconds)
            if new_interval != rs.rotation_interval:
                rs.rotation_interval = new_interval
                interval_changed = True
                changed["rotation_interval_seconds"] = rotation_interval_seconds

        if revocation_delay_seconds is not None:
            if revocation_delay_seconds < 0:
                raise GraphQLError("Revocation delay cannot be negative")
            rs.revocation_delay = timedelta(seconds=revocation_delay_seconds)
            changed["revocation_delay_seconds"] = revocation_delay_seconds

        if rs.revocation_delay >= rs.rotation_interval:
            raise GraphQLError(
                "Revocation delay must be less than the rotation interval"
            )

        rs.save()
        record_event(rs, "config_updated", metadata=changed, **actor_kwargs)

        if is_active is not None and is_active != rs.is_active:
            if is_active:
                engine_resume(rs, actor_kwargs=actor_kwargs)
            else:
                engine_pause(rs, actor_kwargs=actor_kwargs)
        elif interval_changed and rs.is_active:
            from ee.integrations.secrets.rotation.engine import _schedule_next_rotation

            _schedule_next_rotation(rs)

        rs.refresh_from_db()
        if changed or is_active is not None:
            new_values: dict = {k: v for k, v in changed.items()}
            if is_active is not None:
                new_values["is_active"] = is_active
            log_audit_event(
                organisation=org,
                event_type="U",
                resource_type="rs",
                resource_id=rs.id,
                resource_metadata=_rs_resource_metadata(rs),
                new_values=new_values or None,
                description=f"Updated rotating secret '{rs.name}'",
                **_audit_actor(info, org),
            )
        return UpdateRotatingSecretMutation(rotating_secret=rs)


class DeleteRotatingSecretMutation(graphene.Mutation):
    class Arguments:
        rotating_secret_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, rotating_secret_id):
        user = info.context.user
        try:
            rs = RotatingSecret.objects.get(
                id=rotating_secret_id, deleted_at__isnull=True
            )
        except RotatingSecret.DoesNotExist:
            raise GraphQLError("Rotating secret not found")

        org = rs.environment.app.organisation
        if not user_has_permission(
            user,
            "delete",
            "RotatingSecrets",
            org,
            True,
            app=rs.environment.app,
        ):
            raise GraphQLError("You don't have permission to delete rotating secrets")

        resource_metadata = _rs_resource_metadata(rs)
        rs_name = rs.name
        rs_id = rs.id
        rs.delete()
        log_audit_event(
            organisation=org,
            event_type="D",
            resource_type="rs",
            resource_id=rs_id,
            resource_metadata=resource_metadata,
            old_values={"name": rs_name},
            description=f"Deleted rotating secret '{rs_name}'",
            **_audit_actor(info, org),
        )
        return DeleteRotatingSecretMutation(ok=True)


class ManualRotateRotatingSecretMutation(graphene.Mutation):
    class Arguments:
        rotating_secret_id = graphene.ID(required=True)

    rotating_secret = graphene.Field(RotatingSecretType)

    @classmethod
    def mutate(cls, root, info, rotating_secret_id):
        user = info.context.user
        try:
            rs = RotatingSecret.objects.get(
                id=rotating_secret_id, deleted_at__isnull=True
            )
        except RotatingSecret.DoesNotExist:
            raise GraphQLError("Rotating secret not found")
        org = rs.environment.app.organisation
        if not user_has_permission(
            user,
            "update",
            "RotatingSecrets",
            org,
            True,
            app=rs.environment.app,
        ):
            raise GraphQLError("You don't have permission to rotate this secret")

        actor_kwargs = _actor_kwargs(info)
        engine_manual_rotate(rs, actor_kwargs=actor_kwargs)
        rs.refresh_from_db()
        log_audit_event(
            organisation=org,
            event_type="U",
            resource_type="rs",
            resource_id=rs.id,
            resource_metadata=_rs_resource_metadata(rs),
            description=f"Manually rotated '{rs.name}'",
            **_audit_actor(info, org),
        )
        return ManualRotateRotatingSecretMutation(rotating_secret=rs)


class RevokeRotatingSecretCredentialMutation(graphene.Mutation):
    class Arguments:
        credential_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, credential_id):
        user = info.context.user
        try:
            cred = RotatingSecretCredential.objects.select_related(
                "rotating_secret__environment__app__organisation"
            ).get(id=credential_id)
        except RotatingSecretCredential.DoesNotExist:
            raise GraphQLError("Credential not found")

        rs = cred.rotating_secret
        org = rs.environment.app.organisation
        if not user_has_permission(
            user,
            "update",
            "RotatingSecrets",
            org,
            True,
            app=rs.environment.app,
        ):
            raise GraphQLError("You don't have permission to revoke credentials")

        actor_kwargs = _actor_kwargs(info)
        revoke_credential(cred.id, immediate=True, actor_kwargs=actor_kwargs)
        log_audit_event(
            organisation=org,
            event_type="U",
            resource_type="rs",
            resource_id=rs.id,
            resource_metadata={
                **_rs_resource_metadata(rs),
                "credential_id": str(cred.id),
                "provider_credential_id": cred.provider_credential_id,
            },
            description=f"Revoked credential of '{rs.name}'",
            **_audit_actor(info, org),
        )
        return RevokeRotatingSecretCredentialMutation(ok=True)


class PauseRotatingSecretMutation(graphene.Mutation):
    class Arguments:
        rotating_secret_id = graphene.ID(required=True)

    rotating_secret = graphene.Field(RotatingSecretType)

    @classmethod
    def mutate(cls, root, info, rotating_secret_id):
        user = info.context.user
        rs = RotatingSecret.objects.get(
            id=rotating_secret_id, deleted_at__isnull=True
        )
        org = rs.environment.app.organisation
        if not user_has_permission(
            user,
            "update",
            "RotatingSecrets",
            org,
            True,
            app=rs.environment.app,
        ):
            raise GraphQLError("You don't have permission to pause rotation")
        engine_pause(rs, actor_kwargs=_actor_kwargs(info))
        rs.refresh_from_db()
        log_audit_event(
            organisation=org,
            event_type="U",
            resource_type="rs",
            resource_id=rs.id,
            resource_metadata=_rs_resource_metadata(rs),
            new_values={"is_active": False},
            description=f"Paused rotation of '{rs.name}'",
            **_audit_actor(info, org),
        )
        return PauseRotatingSecretMutation(rotating_secret=rs)


class ResumeRotatingSecretMutation(graphene.Mutation):
    class Arguments:
        rotating_secret_id = graphene.ID(required=True)

    rotating_secret = graphene.Field(RotatingSecretType)

    @classmethod
    def mutate(cls, root, info, rotating_secret_id):
        user = info.context.user
        rs = RotatingSecret.objects.get(
            id=rotating_secret_id, deleted_at__isnull=True
        )
        org = rs.environment.app.organisation
        if not user_has_permission(
            user,
            "update",
            "RotatingSecrets",
            org,
            True,
            app=rs.environment.app,
        ):
            raise GraphQLError("You don't have permission to resume rotation")
        engine_resume(rs, actor_kwargs=_actor_kwargs(info))
        rs.refresh_from_db()
        log_audit_event(
            organisation=org,
            event_type="U",
            resource_type="rs",
            resource_id=rs.id,
            resource_metadata=_rs_resource_metadata(rs),
            new_values={"is_active": True},
            description=f"Resumed rotation of '{rs.name}'",
            **_audit_actor(info, org),
        )
        return ResumeRotatingSecretMutation(rotating_secret=rs)


class ValidateRotationCredentialsMutation(graphene.Mutation):
    """Probe a provider with encrypted root credentials before they are persisted."""

    class Arguments:
        organisation_id = graphene.ID(required=True)
        provider_id = graphene.String(required=True)
        credentials = graphene.JSONString(required=True)

    valid = graphene.Boolean()
    error = graphene.String()

    @classmethod
    def mutate(cls, root, info, organisation_id, provider_id, credentials):
        user = info.context.user
        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError("You don't have access to this organisation")
        org = Organisation.objects.get(id=organisation_id)
        if not user_has_permission(user, "create", "IntegrationCredentials", org):
            raise GraphQLError(
                "You don't have permission to validate integration credentials"
            )

        if provider_id not in ROTATION_PROVIDERS:
            return ValidateRotationCredentialsMutation(
                valid=False,
                error=f"Validation is not supported for provider '{provider_id}'.",
            )

        provider_cls = get_provider(provider_id)

        try:
            pk, sk = get_server_keypair()
            decrypted: dict = {}
            for field in provider_cls.credential_schema:
                encrypted_value = credentials.get(field.id) if isinstance(credentials, dict) else None
                if encrypted_value is None or encrypted_value == "":
                    if field.required:
                        return ValidateRotationCredentialsMutation(
                            valid=False,
                            error=f"Missing required credential: {field.label}",
                        )
                    continue
                plaintext = decrypt_asymmetric(encrypted_value, sk.hex(), pk.hex())
                if plaintext is None:
                    return ValidateRotationCredentialsMutation(
                        valid=False,
                        error=(
                            "Could not decrypt the supplied credentials. The "
                            "browser may have used a stale server public key — "
                            "reload the page and try again."
                        ),
                    )
                decrypted[field.id] = plaintext
        except Exception:
            return ValidateRotationCredentialsMutation(
                valid=False,
                error="Could not decrypt the supplied credentials.",
            )

        try:
            ok = bool(provider_cls.validate_root_credentials(decrypted))
        except Exception as e:
            return ValidateRotationCredentialsMutation(
                valid=False,
                error=f"Unexpected error while contacting the provider: {e}",
            )

        if not ok:
            return ValidateRotationCredentialsMutation(
                valid=False,
                error=(
                    "The provider rejected these credentials. Verify the key "
                    "is correct and has the required permissions, then try again."
                ),
            )
        return ValidateRotationCredentialsMutation(valid=True, error=None)
