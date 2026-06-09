from __future__ import annotations

from dataclasses import asdict

import graphene
from graphene.types.generic import GenericScalar
from graphene_django import DjangoObjectType

from api.models import (
    OrganisationMember,
    RotatingSecret,
    RotatingSecretCredential,
    RotatingSecretEvent,
)
from api.utils.access.permissions import user_has_permission


class KeyMapEntry(graphene.ObjectType):
    id = graphene.String()
    key_name = graphene.String()
    key_digest = graphene.String()
    masked = graphene.Boolean()


class KeyMapInput(graphene.InputObjectType):
    id = graphene.String(required=True)
    key_name = graphene.String(required=True)


class RotationProviderType(graphene.ObjectType):
    id = graphene.String(required=True)
    name = graphene.String(required=True)
    credential_schema = GenericScalar(required=True)
    config_schema = GenericScalar(required=True)
    output_schema = GenericScalar(required=True)


class OpenAIProjectType(graphene.ObjectType):
    id = graphene.String(required=True)
    name = graphene.String(required=True)
    status = graphene.String()


class RotatingSecretEventType(DjangoObjectType):
    metadata = GenericScalar()

    class Meta:
        model = RotatingSecretEvent
        fields = (
            "id",
            "rotating_secret",
            "credential",
            "event_type",
            "organisation_member",
            "service_account",
            "ip_address",
            "user_agent",
            "metadata",
            "created_at",
        )


class RotatingSecretCredentialType(DjangoObjectType):
    metadata = GenericScalar()
    events = graphene.List(RotatingSecretEventType)

    class Meta:
        model = RotatingSecretCredential
        fields = (
            "id",
            "rotating_secret",
            "status",
            "provider_credential_id",
            "metadata",
            "failure_count",
            "last_failure_reason",
            "created_at",
            "expire_at",
            "revoked_at",
            "events",
        )

    def resolve_events(self, info):
        return self.events.all().order_by("created_at")


class RotatingSecretType(DjangoObjectType):
    config = GenericScalar()
    key_map = graphene.List(KeyMapEntry)
    rotation_interval_seconds = graphene.Int()
    revocation_delay_seconds = graphene.Int()
    paused_remaining_seconds = graphene.Int()
    credentials = graphene.List(RotatingSecretCredentialType)
    events = graphene.List(RotatingSecretEventType)
    active_credential = graphene.Field(RotatingSecretCredentialType)

    class Meta:
        model = RotatingSecret
        fields = (
            "id",
            "name",
            "description",
            "environment",
            "folder",
            "path",
            "provider",
            "authentication",
            "config",
            "key_map",
            "next_rotation_at",
            "is_active",
            "health",
            "last_failure_at",
            "last_failure_reason",
            "consecutive_failure_count",
            "created_at",
            "updated_at",
        )

    def resolve_rotation_interval_seconds(self, info):
        return int(self.rotation_interval.total_seconds()) if self.rotation_interval else None

    def resolve_revocation_delay_seconds(self, info):
        return int(self.revocation_delay.total_seconds()) if self.revocation_delay else 0

    def resolve_paused_remaining_seconds(self, info):
        return (
            int(self.paused_remaining.total_seconds())
            if self.paused_remaining is not None
            else None
        )

    def resolve_credentials(self, info):
        if not user_has_permission(
            info.context.user,
            "read",
            "RotatingSecrets",
            self.environment.app.organisation,
            True,
            app=self.environment.app,
        ):
            return []
        return self.credentials.order_by("-created_at")

    def resolve_events(self, info):
        if not user_has_permission(
            info.context.user,
            "read",
            "RotatingSecrets",
            self.environment.app.organisation,
            True,
            app=self.environment.app,
        ):
            return []
        return self.events.order_by("-created_at")

    def resolve_active_credential(self, info):
        return (
            self.credentials.filter(status=RotatingSecretCredential.ACTIVE)
            .order_by("-created_at")
            .first()
        )


def serialize_provider(provider_cls) -> RotationProviderType:
    return RotationProviderType(
        id=provider_cls.id,
        name=provider_cls.name,
        credential_schema=[asdict(f) for f in provider_cls.credential_schema],
        config_schema=[asdict(f) for f in provider_cls.config_schema],
        output_schema=[asdict(f) for f in provider_cls.output_schema],
    )
