from api.emails import send_invite_email, send_user_joined_email
from api.utils.permissions import user_is_admin, user_is_org_member

import graphene
from graphql import GraphQLError
from api.models import (
    App,
    Organisation,
    CustomUser,
    OrganisationMember,
    OrganisationMemberInvite,
)
from backend.graphene.types import (
    OrganisationMemberInviteType,
    OrganisationMemberType,
    OrganisationType,
)
from datetime import datetime, timedelta
from django.utils import timezone
from django.conf import settings


class CreateOrganisationMutation(graphene.Mutation):
    class Arguments:
        id = graphene.ID(required=True)
        name = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        wrapped_keyring = graphene.String(required=True)
        wrapped_recovery = graphene.String(required=True)

    organisation = graphene.Field(OrganisationType)

    @classmethod
    def mutate(
        cls, root, info, id, name, identity_key, wrapped_keyring, wrapped_recovery
    ):
        if Organisation.objects.filter(name__iexact=name).exists():
            raise GraphQLError("This organisation name is not available.")

        owner = CustomUser.objects.get(userId=info.context.user.userId)
        org = Organisation.objects.create(id=id, name=name, identity_key=identity_key)
        OrganisationMember.objects.create(
            user=owner,
            organisation=org,
            role=OrganisationMember.OWNER,
            identity_key=identity_key,
            wrapped_keyring=wrapped_keyring,
            wrapped_recovery=wrapped_recovery,
        )

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import create_stripe_customer

            create_stripe_customer(org, owner.email)

        if settings.PHASE_LICENSE:
            from ee.licensing.utils import activate_license

            activate_license(settings.PHASE_LICENSE)

        return CreateOrganisationMutation(organisation=org)


class UpdateUserWrappedSecretsMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        wrapped_keyring = graphene.String(required=True)
        wrapped_recovery = graphene.String(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(cls, root, info, org_id, wrapped_keyring, wrapped_recovery):
        org_member = OrganisationMember.objects.get(
            organisation_id=org_id, user=info.context.user, deleted_at=None
        )

        org_member.wrapped_keyring = wrapped_keyring
        org_member.wrapped_recovery = wrapped_recovery
        org_member.save()

        return UpdateUserWrappedSecretsMutation(org_member=org_member)


class InviteOrganisationMemberMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        email = graphene.String(required=True)
        apps = graphene.List(graphene.String)
        role = graphene.String()

    invite = graphene.Field(OrganisationMemberInviteType)

    @classmethod
    def mutate(cls, root, info, org_id, email, apps, role):

        org = Organisation.objects.get(id=org_id)

        if user_is_org_member(info.context.user, org_id):
            user_already_exists = OrganisationMember.objects.filter(
                organisation_id=org_id, user__email=email, deleted_at=None
            ).exists()
            if user_already_exists:
                raise GraphQLError("This user is already a member if your organisation")

            if OrganisationMemberInvite.objects.filter(
                organisation_id=org_id,
                invitee_email=email,
                valid=True,
                expires_at__gte=timezone.now(),
            ).exists():
                raise GraphQLError(
                    "An active invitiation already exists for this user."
                )

            invited_by = OrganisationMember.objects.get(
                user=info.context.user, organisation_id=org_id, deleted_at=None
            )

            expiry = datetime.now() + timedelta(days=3)

            app_scope = App.objects.filter(id__in=apps)

            invite = OrganisationMemberInvite.objects.create(
                organisation=org,
                invited_by=invited_by,
                role=role.lower(),
                invitee_email=email,
                expires_at=expiry,
            )

            invite.apps.set(app_scope)

            try:
                send_invite_email(invite)
            except Exception as e:
                print(f"Error sending invite email: {e}")

            return InviteOrganisationMemberMutation(invite=invite)
        else:
            raise GraphQLError("You don't have permission to perform this action")


class DeleteInviteMutation(graphene.Mutation):
    class Arguments:
        invite_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, rooot, info, invite_id):
        invite = OrganisationMemberInvite.objects.get(id=invite_id)

        if user_is_org_member(info.context.user, invite.organisation.id):
            invite.delete()

            return DeleteInviteMutation(ok=True)

        else:
            raise GraphQLError("You don't have permission to perform this action")


class CreateOrganisationMemberMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        identity_key = graphene.String(required=True)
        wrapped_keyring = graphene.String(required=False)
        wrapped_recovery = graphene.String(required=False)
        invite_id = graphene.ID(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        org_id,
        identity_key,
        wrapped_keyring,
        wrapped_recovery,
        invite_id,
    ):
        if user_is_org_member(info.context.user.userId, org_id):
            raise GraphQLError("You are already a member of this organisation")

        if OrganisationMemberInvite.objects.filter(
            id=invite_id, valid=True, expires_at__gte=timezone.now()
        ).exists():
            invite = OrganisationMemberInvite.objects.get(
                id=invite_id, valid=True, expires_at__gte=timezone.now()
            )

            org = Organisation.objects.get(id=org_id)

            org_member = OrganisationMember.objects.create(
                user_id=info.context.user.userId,
                organisation=org,
                role=invite.role,
                identity_key=identity_key,
                wrapped_keyring=wrapped_keyring,
                wrapped_recovery=wrapped_recovery,
            )

            org_member.apps.set(invite.apps.all())  # broken

            invite.valid = False
            invite.save()

            if settings.APP_HOST == "cloud":
                from ee.billing.stripe import update_stripe_subscription_seats

                update_stripe_subscription_seats(org)

            try:
                send_user_joined_email(invite, org_member)
            except Exception as e:
                print(f"Error sending new user joined email: {e}")

            return CreateOrganisationMemberMutation(org_member=org_member)
        else:
            raise GraphQLError("You need a valid invite to join this organisation")


class DeleteOrganisationMemberMutation(graphene.Mutation):
    class Arguments:
        member_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, member_id):
        org_member = OrganisationMember.objects.get(id=member_id, deleted_at=None)

        if org_member.user == info.context.user:
            raise GraphQLError("You can't remove yourself from an organisation")

        if user_is_admin(info.context.user.userId, org_member.organisation.id):
            org_member.delete()

            if settings.APP_HOST == "cloud":
                from ee.billing.stripe import update_stripe_subscription_seats

                update_stripe_subscription_seats(org_member.organisation)

            return DeleteOrganisationMemberMutation(ok=True)
        else:
            raise GraphQLError("You don't have permission to perform that action")


class UpdateOrganisationMemberRole(graphene.Mutation):
    class Arguments:
        member_id = graphene.ID(required=True)
        role = graphene.String(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(cls, root, info, member_id, role):
        org_member = OrganisationMember.objects.get(id=member_id, deleted_at=None)

        if user_is_admin(info.context.user.userId, org_member.organisation.id):
            if role.lower() == OrganisationMember.OWNER.lower():
                raise GraphQLError("You cannot set this user as the organisation owner")

            org_member.role = role.lower()
            org_member.save()

            return UpdateOrganisationMemberRole(org_member=org_member)
        else:
            raise GraphQLError("You don't have permission to perform this action")
