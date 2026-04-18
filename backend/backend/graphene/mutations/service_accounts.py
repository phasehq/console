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
    role_has_global_access,
    role_has_permission,
    user_has_permission,
    user_is_org_member,
)
from backend.graphene.types import ServiceAccountTokenType, ServiceAccountType
from datetime import datetime
from django.conf import settings


def _check_sa_permission(user, service_account, action, resource):
    """
    Unified permission check for service account operations.

    For team-owned SAs, resolves the effective role using the team's member_role override:
    - Team owner → always allowed
    - Global access (Owner/Admin) → always allowed
    - Team member → uses team member_role if set, else falls back to org role
    - Non-team member → denied

    For org-level SAs: uses standard org permission check.
    """
    org = service_account.organisation

    if service_account.team is None:
        # Org-level SA: standard permission check
        if not user_has_permission(user, action, resource, org):
            raise GraphQLError(
                f"You don't have the permissions required to {action} {resource} in this organisation"
            )
        return

    # Team-owned SA
    try:
        org_member = OrganisationMember.objects.get(
            user=user, organisation=org, deleted_at=None
        )
    except OrganisationMember.DoesNotExist:
        raise GraphQLError("You don't have access to this Service Account")

    # Global access users (Owner/Admin) always allowed
    if role_has_global_access(org_member.role):
        return

    # Team owner always allowed
    if service_account.team.owner_id is not None and service_account.team.owner_id == org_member.id:
        return

    # Check team membership
    if not TeamMembership.objects.filter(
        team=service_account.team,
        org_member=org_member,
        team__deleted_at__isnull=True,
    ).exists():
        raise GraphQLError("You don't have access to this Service Account")

    # Resolve effective role: team member_role if set, else org role
    effective_role = service_account.team.member_role or org_member.role

    if not role_has_permission(effective_role, action, resource):
        raise GraphQLError(
            f"You don't have the permissions required to {action} {resource}"
        )


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

        service_account.server_wrapped_keyring = server_wrapped_keyring
        service_account.server_wrapped_recovery = server_wrapped_recovery
        service_account.save()

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

        # Delete server-wrapped keys to disable server-side key management
        service_account.server_wrapped_keyring = None
        service_account.server_wrapped_recovery = None
        service_account.save()

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

        if not user_is_org_member(user.userId, organisation_id):
            raise GraphQLError(
                "You are not a member of this organisation and cannot perform this operation"
            )

        if not user_has_permission(user, "update", "ServiceAccounts", org):
            raise GraphQLError(
                "You don't have permission to manage service accounts"
            )

        # Only delete handlers for SAs referenced in the incoming list.
        # This prevents wiping handlers for team-owned SAs the caller can't see.
        sa_ids = set(h.service_account_id for h in handlers)
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

        service_account.delete()

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(service_account.organisation)

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

        token.delete()

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


class UpdateServiceAccountOwnershipMutation(graphene.Mutation):
    """Transfer a service account between org-level and team ownership.

    - team_id=null: Promote team-owned SA to org-level (clears team FK).
    - team_id=<id>: Assign SA to a team (narrows visibility to team members).

    Requires global_access (Owner/Admin only).
    """

    class Arguments:
        service_account_id = graphene.ID(required=True)
        team_id = graphene.ID(required=False)

    service_account = graphene.Field(ServiceAccountType)

    @classmethod
    def mutate(cls, root, info, service_account_id, team_id=None):
        user = info.context.user
        service_account = ServiceAccount.objects.get(
            id=service_account_id, deleted_at__isnull=True
        )
        org = service_account.organisation

        # Only Owner/Admin can transfer ownership
        org_member = OrganisationMember.objects.get(
            user=user, organisation=org, deleted_at=None
        )
        if not role_has_global_access(org_member.role):
            raise GraphQLError(
                "Only organisation owners and admins can transfer service account ownership"
            )

        old_team = service_account.team

        if team_id is None:
            # Promote to org-level
            service_account.team = None
            service_account.save()
        else:
            # Assign to team
            new_team = Team.objects.get(
                id=team_id, organisation=org, deleted_at__isnull=True
            )
            service_account.team = new_team
            service_account.save()

            # Ensure SA is a member of the new team
            TeamMembership.objects.get_or_create(
                team=new_team, service_account=service_account
            )

        return UpdateServiceAccountOwnershipMutation(
            service_account=service_account
        )
