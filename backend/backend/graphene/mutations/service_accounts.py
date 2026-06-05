import graphene
from django.db import transaction
from graphql import GraphQLError
from api.models import (
    App,
    Organisation,
    OrganisationMember,
    Role,
    ServiceAccount,
    ServiceAccountHandler,
    ServiceAccountToken,
    Team,
    TeamAppEnvironment,
    TeamMembership,
    Identity,
)
from api.utils.keys import provision_team_environment_keys
from api.utils.access.permissions import (
    _check_sa_permission,
    role_has_global_access,
    role_has_permission,
    user_has_permission,
    user_is_org_member,
)
from api.utils.audit_logging import log_audit_event, get_actor_info_from_graphql
from api.utils.rest import get_resolver_request_meta
from backend.graphene.types import ServiceAccountTokenType, ServiceAccountType
from datetime import datetime
from django.conf import settings


class ServiceAccountHandlerInput(graphene.InputObjectType):
    service_account_id = graphene.ID(required=False)
    member_id = graphene.ID(required=False)
    wrapped_keyring = graphene.String(required=True)
    wrapped_recovery = graphene.String(required=True)


class CreateServiceAccountMutation(graphene.Mutation):
    class Arguments:
        name = graphene.String()
        organisation_id = graphene.ID()
        role_id = graphene.ID()
        handlers = graphene.List(ServiceAccountHandlerInput)
        identity_key = graphene.String()
        server_wrapped_keyring = graphene.String(required=False)
        server_wrapped_recovery = graphene.String(required=False)
        team_id = graphene.ID(required=False)

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        name,
        organisation_id,
        role_id,
        handlers,
        identity_key,
        server_wrapped_keyring=None,
        server_wrapped_recovery=None,
        team_id=None,
    ):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        # Permission check: team-owned SAs use team member_role override
        team = None
        if team_id:
            team = Team.objects.get(id=team_id, organisation=org, deleted_at__isnull=True)
            org_member = OrganisationMember.objects.get(
                user=user, organisation=org, deleted_at=None
            )

            if not role_has_global_access(org_member.role):
                is_team_owner = team.owner_id is not None and team.owner_id == org_member.id

                if not is_team_owner:
                    # Must be a team member
                    if not TeamMembership.objects.filter(
                        team=team, org_member=org_member
                    ).exists():
                        raise GraphQLError(
                            "You must be a member of the team to create a team-owned Service Account"
                        )

                    # Check effective role: team member_role if set, else org role
                    effective_role = team.member_role or org_member.role
                    if not role_has_permission(effective_role, "create", "ServiceAccounts"):
                        raise GraphQLError(
                            "You don't have the permissions required to create Service Accounts"
                        )
        else:
            if not user_has_permission(user, "create", "ServiceAccounts", org):
                raise GraphQLError(
                    "You don't have the permissions required to create Service Accounts in this organisation"
                )

        if handlers is None or len(handlers) == 0:
            raise GraphQLError("At least one service account handler must be provided")

        role = Role.objects.get(id=role_id, organisation=org)

        if role_has_global_access(role):
            raise GraphQLError(
                f"Service Accounts cannot be assigned the '{role.name}' role."
            )

        with transaction.atomic():
            service_account = ServiceAccount.objects.create(
                name=name,
                organisation=org,
                role=role,
                identity_key=identity_key,
                server_wrapped_keyring=server_wrapped_keyring,
                server_wrapped_recovery=server_wrapped_recovery,
                team=team,
            )

            for handler in handlers:
                ServiceAccountHandler.objects.create(
                    service_account=service_account,
                    user_id=handler.member_id,
                    wrapped_keyring=handler.wrapped_keyring,
                    wrapped_recovery=handler.wrapped_recovery,
                )

            # Auto-add team-owned SA as a member of the team
            if team:
                membership, _ = TeamMembership.objects.get_or_create(
                    team=team, service_account=service_account
                )

                # Provision environment keys for the SA on all team apps
                app_ids = (
                    TeamAppEnvironment.objects.filter(team=team)
                    .values_list("app_id", flat=True)
                    .distinct()
                )
                for app_id in app_ids:
                    app = App.objects.get(id=app_id)
                    if app.sse_enabled:
                        provision_team_environment_keys(
                            team, app, members=[membership]
                        )

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(org)

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=org)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=org,
            event_type="C",
            resource_type="sa",
            resource_id=service_account.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name},
            description=f"Created service account '{name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return CreateServiceAccountMutation(service_account=service_account)


class EnableServiceAccountServerSideKeyManagementMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        server_wrapped_keyring = graphene.String()
        server_wrapped_recovery = graphene.String()

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        service_account_id,
        server_wrapped_keyring,
        server_wrapped_recovery,
    ):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        _check_sa_permission(user, service_account, "update", "ServiceAccounts")

        was_enabled = bool(service_account.server_wrapped_keyring)
        service_account.server_wrapped_keyring = server_wrapped_keyring
        service_account.server_wrapped_recovery = server_wrapped_recovery
        service_account.save()

        if not was_enabled:
            actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(
                info, organisation=service_account.organisation
            )
            ip_address, user_agent = get_resolver_request_meta(info.context)
            log_audit_event(
                organisation=service_account.organisation,
                event_type="U",
                resource_type="sa",
                resource_id=service_account.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_metadata,
                resource_metadata={"name": service_account.name},
                old_values={"server_side_key_management": False},
                new_values={"server_side_key_management": True},
                description=(
                    f"Enabled server-side key management for service account "
                    f"'{service_account.name}'"
                ),
                ip_address=ip_address,
                user_agent=user_agent,
            )

        return EnableServiceAccountServerSideKeyManagementMutation(
            service_account=service_account
        )


class EnableServiceAccountClientSideKeyManagementMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(cls, root, info, service_account_id):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        _check_sa_permission(user, service_account, "update", "ServiceAccounts")

        # Team-owned SAs must always use server-side KMS
        if service_account.team is not None:
            raise GraphQLError(
                "Team-owned service accounts require server-side key management and cannot be switched to client-side."
            )

        was_enabled = bool(service_account.server_wrapped_keyring)
        # Delete server-wrapped keys to disable server-side key management
        service_account.server_wrapped_keyring = None
        service_account.server_wrapped_recovery = None
        service_account.save()

        if was_enabled:
            actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(
                info, organisation=service_account.organisation
            )
            ip_address, user_agent = get_resolver_request_meta(info.context)
            log_audit_event(
                organisation=service_account.organisation,
                event_type="U",
                resource_type="sa",
                resource_id=service_account.id,
                actor_type=actor_type,
                actor_id=actor_id,
                actor_metadata=actor_metadata,
                resource_metadata={"name": service_account.name},
                old_values={"server_side_key_management": True},
                new_values={"server_side_key_management": False},
                description=(
                    f"Disabled server-side key management for service account "
                    f"'{service_account.name}'"
                ),
                ip_address=ip_address,
                user_agent=user_agent,
            )

        return EnableServiceAccountClientSideKeyManagementMutation(
            service_account=service_account
        )


class UpdateServiceAccountMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        name = graphene.String()
        role_id = graphene.ID()
        identity_ids = graphene.List(graphene.NonNull(graphene.ID), required=False)

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(cls, root, info, service_account_id, name, role_id, identity_ids=None):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        _check_sa_permission(user, service_account, "update", "ServiceAccounts")

        role = Role.objects.get(id=role_id, organisation=service_account.organisation)

        if role_has_global_access(role):
            raise GraphQLError(
                f"Service Accounts cannot be assigned the '{role.name}' role."
            )
        service_account.name = name
        service_account.role = role
        if identity_ids is not None:
            identities = Identity.objects.filter(
                id__in=identity_ids,
                organisation=service_account.organisation,
                deleted_at=None,
            )
            service_account.identities.set(identities)
        service_account.save()

        return UpdateServiceAccountMutation(service_account=service_account)


class UpdateServiceAccountHandlersMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID()
        handlers = graphene.List(ServiceAccountHandlerInput)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, organisation_id, handlers):
        user = info.context.user
        org = Organisation.objects.get(id=organisation_id)

        if not user_has_permission(
            user, "update", "ServiceAccounts", org
        ):
            raise GraphQLError(
                "You don't have the permissions required to update Service Accounts in this organisation"
            )

        if not user_has_permission(user, "update", "ServiceAccounts", org):
            raise GraphQLError(
                "You don't have permission to manage service accounts"
            )

        # Pre-flight: org-level perms aren't sufficient for team-owned
        # SAs — fail before the bulk delete below if any are off-limits.
        sa_ids = set(h.service_account_id for h in handlers)
        target_sas = ServiceAccount.objects.filter(
            id__in=sa_ids,
            organisation=org,
            deleted_at__isnull=True,
        ).select_related("team")
        for sa in target_sas:
            _check_sa_permission(user, sa, "update", "ServiceAccounts")

        # Scope the delete to listed SAs so we don't wipe handlers for
        # team-owned SAs the caller can't see.
        ServiceAccountHandler.objects.filter(
            service_account__organisation=org,
            service_account_id__in=sa_ids,
            service_account__deleted_at__isnull=True,
        ).delete()

        for handler in handlers:
            service_account = ServiceAccount.objects.get(
                id=handler.service_account_id, deleted_at__isnull=True
            )

            if not ServiceAccountHandler.objects.filter(
                service_account=service_account, user_id=handler.member_id
            ).exists():
                ServiceAccountHandler.objects.create(
                    service_account=service_account,
                    user_id=handler.member_id,
                    wrapped_keyring=handler.wrapped_keyring,
                    wrapped_recovery=handler.wrapped_recovery,
                )

        return UpdateServiceAccountHandlersMutation(ok=True)


class DeleteServiceAccountMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, service_account_id):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)

        _check_sa_permission(user, service_account, "delete", "ServiceAccounts")

        sa_name = service_account.name
        sa_id = service_account.id
        sa_org = service_account.organisation

        service_account.delete()

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(sa_org)

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=sa_org)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=sa_org,
            event_type="D",
            resource_type="sa",
            resource_id=sa_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": sa_name},
            description=f"Deleted service account '{sa_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return DeleteServiceAccountMutation(ok=True)


class CreateServiceAccountTokenMutation(graphene.Mutation):
    class Arguments:
        service_account_id = graphene.ID()
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        token = graphene.String(required=True)
        wrapped_key_share = graphene.String(required=True)
        expiry = graphene.BigInt(required=False)

    token = graphene.Field(ServiceAccountTokenType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        service_account_id,
        name,
        identity_key,
        token,
        wrapped_key_share,
        expiry,
    ):
        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)
        org_member = OrganisationMember.objects.get(
            user=user, organisation=service_account.organisation, deleted_at=None
        )

        _check_sa_permission(user, service_account, "create", "ServiceAccountTokens")

        if expiry is not None:
            expires_at = datetime.fromtimestamp(expiry / 1000)
        else:
            expires_at = None

        token = ServiceAccountToken.objects.create(
            service_account=service_account,
            name=name,
            identity_key=identity_key,
            token=token,
            wrapped_key_share=wrapped_key_share,
            created_by=org_member,
            expires_at=expires_at,
        )

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=service_account.organisation)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=service_account.organisation,
            event_type="C",
            resource_type="sa_token",
            resource_id=token.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": name, "service_account": service_account.name, "service_account_id": str(service_account.id)},
            new_values={
                "name": name,
                "expires_at": token.expires_at.isoformat() if token.expires_at else None,
            },
            description=f"Created service account token '{name}' for '{service_account.name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return CreateServiceAccountTokenMutation(token=token)


class DeleteServiceAccountTokenMutation(graphene.Mutation):
    class Arguments:
        token_id = graphene.ID()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, token_id):
        user = info.context.user
        token = ServiceAccountToken.objects.get(id=token_id)

        _check_sa_permission(user, token.service_account, "delete", "ServiceAccountTokens")

        token_name = token.name
        token_id = token.id
        token_expires_at = token.expires_at
        token_org = token.service_account.organisation
        sa_name = token.service_account.name
        sa_id = str(token.service_account.id)

        token.delete()

        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, organisation=token_org)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=token_org,
            event_type="D",
            resource_type="sa_token",
            resource_id=token_id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": token_name, "service_account": sa_name, "service_account_id": sa_id},
            old_values={
                "name": token_name,
                "expires_at": token_expires_at.isoformat() if token_expires_at else None,
            },
            description=f"Deleted service account token '{token_name}' from '{sa_name}'",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        return DeleteServiceAccountTokenMutation(ok=True)


class CreateServerSideServiceAccountTokenMutation(graphene.Mutation):
    """Create a service account token using server-side key management.

    The server decrypts the SA keyring, generates a token with key splitting,
    and returns the full token string. Requires SSK to be enabled on the SA.
    This allows team members who are not SA handlers to create tokens.
    """

    class Arguments:
        service_account_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        expiry = graphene.BigInt(required=False)

    token_string = graphene.String()
    token = graphene.Field(ServiceAccountTokenType)

    @classmethod
    def mutate(cls, root, info, service_account_id, name, expiry=None):
        import json
        from api.utils.crypto import (
            get_server_keypair,
            decrypt_asymmetric,
            split_secret_hex,
            wrap_share_hex,
            random_hex,
            ed25519_to_kx,
        )

        user = info.context.user
        service_account = ServiceAccount.objects.get(id=service_account_id)
        org_member = OrganisationMember.objects.get(
            user=user, organisation=service_account.organisation, deleted_at=None
        )

        _check_sa_permission(user, service_account, "create", "ServiceAccountTokens")

        if not service_account.server_wrapped_keyring:
            raise GraphQLError(
                "Server-side key management must be enabled to create tokens this way"
            )

        # Decrypt SA keyring using server keypair
        pk, sk = get_server_keypair()
        keyring_json = decrypt_asymmetric(
            service_account.server_wrapped_keyring, sk.hex(), pk.hex()
        )
        keyring = json.loads(keyring_json)
        kx_pub, kx_priv = ed25519_to_kx(keyring["publicKey"], keyring["privateKey"])

        # Generate token material
        wrap_key = random_hex(32)
        token_value = random_hex(32)
        share_a, share_b = split_secret_hex(kx_priv)
        wrapped_share_b = wrap_share_hex(share_b, wrap_key)

        if expiry is not None:
            expires_at = datetime.fromtimestamp(expiry / 1000)
        else:
            expires_at = None

        token = ServiceAccountToken.objects.create(
            service_account=service_account,
            name=name,
            identity_key=kx_pub,
            token=token_value,
            wrapped_key_share=wrapped_share_b,
            created_by=org_member,
            expires_at=expires_at,
        )

        full_token = f"pss_service:v2:{token_value}:{kx_pub}:{share_a}:{wrap_key}"

        return CreateServerSideServiceAccountTokenMutation(
            token_string=full_token,
            token=token,
        )


