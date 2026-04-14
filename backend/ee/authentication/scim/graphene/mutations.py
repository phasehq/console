import hashlib
import secrets

import graphene
from graphql import GraphQLError

from api.models import Organisation, OrganisationMember, SCIMToken
from api.utils.access.permissions import user_has_permission
from backend.graphene.types import SCIMTokenType
from backend.quotas import can_use_scim
from django.utils import timezone


def _generate_scim_token():
    """Generate a SCIM bearer token: ph_scim:v1:<prefix>:<random>."""
    prefix = secrets.token_hex(4)  # 8 chars
    body = secrets.token_hex(32)  # 64 chars
    full_token = f"ph_scim:v1:{prefix}:{body}"
    token_hash = hashlib.sha256(full_token.encode()).hexdigest()
    return full_token, token_hash, prefix


class CreateSCIMTokenMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        expiry_days = graphene.Int(required=False)

    token = graphene.String()
    scim_token = graphene.Field(SCIMTokenType)

    @classmethod
    def mutate(cls, root, info, organisation_id, name, expiry_days=None):
        org = Organisation.objects.get(id=organisation_id)

        # Check permission: Admin+ for SCIM token management
        if not user_has_permission(
            info.context.user, "update", "SCIM", org
        ):
            raise GraphQLError(
                "You don't have permission to manage SCIM tokens."
            )

        if not can_use_scim(org):
            raise GraphQLError(
                "SCIM provisioning requires an Enterprise plan."
            )

        org_member = OrganisationMember.objects.get(
            user=info.context.user, organisation=org, deleted_at=None
        )

        full_token, token_hash, prefix = _generate_scim_token()

        expires_at = None
        if expiry_days:
            expires_at = timezone.now() + timezone.timedelta(days=expiry_days)

        scim_token = SCIMToken.objects.create(
            organisation=org,
            name=name.strip(),
            token_hash=token_hash,
            token_prefix=prefix,
            created_by=org_member,
            expires_at=expires_at,
        )

        return CreateSCIMTokenMutation(token=full_token, scim_token=scim_token)


class DeleteSCIMTokenMutation(graphene.Mutation):
    class Arguments:
        token_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, token_id):
        scim_token = SCIMToken.objects.get(id=token_id, deleted_at__isnull=True)
        org = scim_token.organisation

        if not user_has_permission(
            info.context.user, "update", "SCIM", org
        ):
            raise GraphQLError(
                "You don't have permission to manage SCIM tokens."
            )

        scim_token.deleted_at = timezone.now()
        scim_token.save(update_fields=["deleted_at"])

        return DeleteSCIMTokenMutation(ok=True)


class ToggleSCIMMutation(graphene.Mutation):
    """Master switch: enable/disable SCIM for the organisation."""

    class Arguments:
        organisation_id = graphene.ID(required=True)
        enabled = graphene.Boolean(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, organisation_id, enabled):
        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(
            info.context.user, "update", "SCIM", org
        ):
            raise GraphQLError(
                "You don't have permission to manage SCIM settings."
            )

        if not can_use_scim(org):
            raise GraphQLError(
                "SCIM provisioning requires an Enterprise plan."
            )

        org.scim_enabled = enabled
        org.save(update_fields=["scim_enabled"])

        return ToggleSCIMMutation(ok=True)


class ToggleSCIMTokenMutation(graphene.Mutation):
    """Per-provider toggle: enable/disable a single SCIM token."""

    class Arguments:
        token_id = graphene.ID(required=True)
        is_active = graphene.Boolean(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, token_id, is_active):
        scim_token = SCIMToken.objects.get(id=token_id, deleted_at__isnull=True)
        org = scim_token.organisation

        if not user_has_permission(
            info.context.user, "update", "SCIM", org
        ):
            raise GraphQLError(
                "You don't have permission to manage SCIM tokens."
            )

        scim_token.is_active = is_active
        scim_token.save(update_fields=["is_active"])

        return ToggleSCIMTokenMutation(ok=True)
