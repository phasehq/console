from api.emails import send_user_joined_email, send_welcome_email, send_ownership_transferred_email
from api.utils.access.permissions import (
    role_has_global_access,
    role_has_permission,
    user_has_permission,
    user_is_org_member,
)
from api.utils.access.roles import default_roles
from api.tasks.emails import send_invite_email_job
from backend.quotas import can_add_account
import graphene
from django.db import transaction
from graphql import GraphQLError
from api.models import (
    App,
    Organisation,
    CustomUser,
    OrganisationMember,
    OrganisationMemberInvite,
    Role,
)
from backend.graphene.types import (
    OrganisationMemberInviteType,
    OrganisationMemberType,
    OrganisationType,
)
from datetime import timedelta
from django.contrib.auth import login
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

        user = CustomUser.objects.get(userId=info.context.user.userId)
        org = Organisation.objects.create(
            id=id,
            name=name,
            identity_key=identity_key,
            pricing_version=Organisation.PRICING_V2,
        )

        for role_name, _ in default_roles.items():
            Role.objects.create(
                name=role_name,
                organisation=org,
                is_default=True,
            )

        owner_role = Role.objects.get(organisation=org, name__iexact="owner")

        owner = OrganisationMember.objects.create(
            user=user,
            organisation=org,
            role=owner_role,
            identity_key=identity_key,
            wrapped_keyring=wrapped_keyring,
            wrapped_recovery=wrapped_recovery,
        )

        try:
            send_welcome_email(owner)
        except Exception as e:
            print(f"Error sending new user welcome email: {e}")

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import create_stripe_customer

            create_stripe_customer(org, user.email)

        if settings.PHASE_LICENSE:
            from ee.licensing.utils import activate_license

            activate_license(settings.PHASE_LICENSE)

        return CreateOrganisationMutation(organisation=org)


class UpdateUserWrappedSecretsMutation(graphene.Mutation):
    """Re-wrap THIS org's keyring after the caller proves they hold the
    recovery mnemonic. Used by SSO recovery (where there's no login
    password to verify against, so identity is proven via the mnemonic
    alone).

    Requires identity_key matching the org's stored identity_key — proves
    the caller derived the keyring from the right mnemonic. Without this
    proof, an authenticated user (or session-cookie holder) could
    overwrite their own wrapped_keyring with arbitrary garbage and lock
    themselves out of the org permanently.
    """

    class Arguments:
        org_id = graphene.ID(required=True)
        identity_key = graphene.String(required=True)
        wrapped_keyring = graphene.String(required=True)
        wrapped_recovery = graphene.String(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(cls, root, info, org_id, identity_key, wrapped_keyring, wrapped_recovery):
        try:
            org = Organisation.objects.get(id=org_id)
        except Organisation.DoesNotExist:
            raise GraphQLError("Organisation not found.")

        if org.identity_key != identity_key:
            raise GraphQLError("Invalid recovery proof.")

        try:
            org_member = OrganisationMember.objects.get(
                organisation=org, user=info.context.user, deleted_at=None
            )
        except OrganisationMember.DoesNotExist:
            raise GraphQLError("Not a member of this organisation.")

        org_member.wrapped_keyring = wrapped_keyring
        org_member.wrapped_recovery = wrapped_recovery
        org_member.save()

        return UpdateUserWrappedSecretsMutation(org_member=org_member)


class RecoverAccountKeyringMutation(graphene.Mutation):
    """Rewrap THIS org's keyring with a deviceKey derived from the user's
    account password. Used by the recovery flow when the local keyring
    has been lost (cleared cache, new device) but the user still
    remembers their password.

    Two server-side proofs are required:
      1. identity_key matches the org's stored identity_key — proves the
         caller derived the keyring from the right mnemonic.
      2. auth_hash matches user.password — proves the password the user
         is wrapping the keyring with is also their account login auth.

    The mutation does NOT change user.password. The auth_hash check is a
    guardrail to keep auth and wrap passwords unified; if it fails, the
    user is trying to wrap the keyring with a password that doesn't
    authenticate them, which we never persist.
    """

    class Arguments:
        org_id = graphene.ID(required=True)
        auth_hash = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        wrapped_keyring = graphene.String(required=True)
        wrapped_recovery = graphene.String(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        org_id,
        auth_hash,
        identity_key,
        wrapped_keyring,
        wrapped_recovery,
    ):
        from api.views.auth_password import _password_auth_enabled
        if not _password_auth_enabled():
            raise GraphQLError(
                "Password-based recovery is disabled on this instance."
            )

        request = info.context
        user = request.user

        if not user.has_usable_password():
            raise GraphQLError("No account password set for SSO users.")

        try:
            org = Organisation.objects.get(id=org_id)
        except Organisation.DoesNotExist:
            raise GraphQLError("Organisation not found.")

        if org.identity_key != identity_key:
            raise GraphQLError("Invalid recovery proof.")

        try:
            org_member = OrganisationMember.objects.get(
                user=user, organisation=org, deleted_at=None
            )
        except OrganisationMember.DoesNotExist:
            raise GraphQLError("Not a member of this organisation.")

        if not user.check_password(auth_hash):
            raise GraphQLError(
                "Password does not match your account. Use your "
                "current login password to recover this organisation."
            )

        with transaction.atomic():
            org_member.wrapped_keyring = wrapped_keyring
            org_member.wrapped_recovery = wrapped_recovery or ""
            org_member.save()

        prev_auth_method = request.session.get("auth_method", "password")
        prev_sso_org_id = request.session.get("auth_sso_org_id")
        prev_sso_provider_id = request.session.get("auth_sso_provider_id")
        login(request, user)
        request.session["auth_method"] = prev_auth_method
        if prev_sso_org_id:
            request.session["auth_sso_org_id"] = prev_sso_org_id
        if prev_sso_provider_id:
            request.session["auth_sso_provider_id"] = prev_sso_provider_id

        return RecoverAccountKeyringMutation(org_member=org_member)


class ChangeAccountPasswordMutation(graphene.Mutation):
    """Rotate the user's account password and rewrap the active org's
    keyring with the new deviceKey. Used by the in-session change-password
    dialog where the user supplies their current password, a new password,
    and the org's recovery mnemonic.

    Three server-side proofs are required:
      1. current_auth_hash matches user.password — proves the caller
         knows the current login password.
      2. identity_key matches the org's stored identity_key — proves the
         caller derived the keyring from the right mnemonic.
      3. user is a member of the org.

    On success: user.password is set to new_auth_hash, the org's
    wrapped_keyring + wrapped_recovery are replaced, and the session is
    refreshed so the post-rotation HASH_SESSION_KEY stays valid.

    Only the active org's keyring is rewrapped. Other orgs the user
    belongs to remain encrypted with the old deviceKey; they'll fall
    through to per-org recovery on next access.
    """

    class Arguments:
        org_id = graphene.ID(required=True)
        current_auth_hash = graphene.String(required=True)
        new_auth_hash = graphene.String(required=True)
        identity_key = graphene.String(required=True)
        wrapped_keyring = graphene.String(required=True)
        wrapped_recovery = graphene.String(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        org_id,
        current_auth_hash,
        new_auth_hash,
        identity_key,
        wrapped_keyring,
        wrapped_recovery,
    ):
        from api.views.auth_password import _password_auth_enabled
        if not _password_auth_enabled():
            raise GraphQLError(
                "Password changes are disabled on this instance."
            )

        request = info.context
        user = request.user

        if not user.has_usable_password():
            raise GraphQLError("SSO users cannot change their password here.")

        if not user.check_password(current_auth_hash):
            raise GraphQLError("Current password is incorrect.")

        try:
            org = Organisation.objects.get(id=org_id)
        except Organisation.DoesNotExist:
            raise GraphQLError("Organisation not found.")

        if org.identity_key != identity_key:
            raise GraphQLError("Invalid recovery proof.")

        try:
            org_member = OrganisationMember.objects.get(
                user=user, organisation=org, deleted_at=None
            )
        except OrganisationMember.DoesNotExist:
            raise GraphQLError("Not a member of this organisation.")

        with transaction.atomic():
            user.set_password(new_auth_hash)
            user.save()

            org_member.wrapped_keyring = wrapped_keyring
            org_member.wrapped_recovery = wrapped_recovery or ""
            org_member.save()

        prev_auth_method = request.session.get("auth_method", "password")
        prev_sso_org_id = request.session.get("auth_sso_org_id")
        prev_sso_provider_id = request.session.get("auth_sso_provider_id")
        login(request, user)
        request.session["auth_method"] = prev_auth_method
        if prev_sso_org_id:
            request.session["auth_sso_org_id"] = prev_sso_org_id
        if prev_sso_provider_id:
            request.session["auth_sso_provider_id"] = prev_sso_provider_id

        return ChangeAccountPasswordMutation(org_member=org_member)


class InviteInput(graphene.InputObjectType):
    email = graphene.String(required=True)
    apps = graphene.List(graphene.String)
    role_id = graphene.ID(required=True)


class BulkInviteOrganisationMembersMutation(graphene.Mutation):

    class Arguments:
        org_id = graphene.ID(required=True)
        invites = graphene.List(InviteInput, required=True)

    invites = graphene.List(OrganisationMemberInviteType)

    @classmethod
    def mutate(cls, root, info, org_id, invites):
        org = Organisation.objects.get(id=org_id)

        if not user_has_permission(info.context.user, "create", "Members", org):
            raise GraphQLError("You don’t have permission to invite members")

        if not user_is_org_member(info.context.user, org_id):
            raise GraphQLError("You don’t have permission to perform this action")

        invited_by = OrganisationMember.objects.get(
            user=info.context.user, organisation_id=org_id, deleted_at=None
        )

        expiry = timezone.now() + timedelta(days=14)
        created_invites = []

        if not can_add_account(org, len(invites)):
            raise GraphQLError(
                f"You cannot add {len(invites)} more members to this organisation"
            )

        # Restrict roles that can be assigned via invites
        org_roles = Role.objects.filter(organisation=org)

        allowed_invite_roles = [
            r
            for r in org_roles
            if not role_has_global_access(r)
            and not role_has_permission(r, "create", "ServiceAccountTokens")
        ]

        for invite in invites:
            email = invite.email.lower().strip()
            apps = invite.apps or []
            role_id = invite.role_id

            if OrganisationMember.objects.filter(
                organisation_id=org_id, user__email=email, deleted_at=None
            ).exists():
                continue  # Skip already existing members

            if OrganisationMemberInvite.objects.filter(
                organisation_id=org_id,
                invitee_email=email,
                valid=True,
                expires_at__gte=timezone.now(),
            ).exists():
                continue  # Skip if an active invite already exists

            app_scope = App.objects.filter(id__in=apps)

            role = Role.objects.get(organisation=org, id=role_id)
            if role not in allowed_invite_roles:
                allowed_role_names = [r.name for r in allowed_invite_roles]
                raise GraphQLError(
                    f"You can only invite members with the following roles: {', '.join(allowed_role_names)}"
                )

            new_invite = OrganisationMemberInvite.objects.create(
                organisation=org,
                role_id=role_id,
                invited_by=invited_by,
                invitee_email=email,
                expires_at=expiry,
            )
            new_invite.apps.set(app_scope)

            try:
                send_invite_email_job(new_invite)
            except Exception as e:
                print(f"Error sending invite email to {email}: {e}")

            created_invites.append(new_invite)

        return BulkInviteOrganisationMembersMutation(invites=created_invites)


class DeleteInviteMutation(graphene.Mutation):
    class Arguments:
        invite_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, rooot, info, invite_id):
        invite = OrganisationMemberInvite.objects.get(id=invite_id)

        if not user_has_permission(
            info.context.user, "delete", "Members", invite.organisation
        ):
            raise GraphQLError("You dont have permission to delete invites")

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

            # The invite is bound to a specific email. A valid session alone
            # is not enough — the authenticated caller's email MUST match
            # the invitee. Otherwise a leaked invite_id could be claimed by
            # any account holder. resolve_validate_invite already enforces
            # this for the read path, but this mutation is the canonical
            # write gate and must enforce independently.
            if invite.invitee_email.lower() != info.context.user.email.lower():
                raise GraphQLError("This invite is for another user")

            # An invite is bound to a specific organisation. The client-
            # supplied org_id must match — otherwise a legitimate invite
            # to org A can be redeemed to join org B (seat bumps, role
            # assignment, membership creation) by anyone who knows B's
            # UUID. UUIDs leak via URLs, logs, screenshots.
            if str(invite.organisation_id) != str(org_id):
                raise GraphQLError(
                    "Invite does not match the specified organisation"
                )

            org = Organisation.objects.get(id=org_id)

            role = (
                invite.role
                if invite.role is not None
                else Role.objects.get(organisation=org, name__iexact="developer")
            )

            org_member = OrganisationMember.objects.create(
                user_id=info.context.user.userId,
                organisation=org,
                role=role,
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
                send_welcome_email(org_member)
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

        if not user_has_permission(
            info.context.user, "delete", "Members", org_member.organisation
        ):
            raise GraphQLError("You dont have permission to remove members")

        if org_member.user == info.context.user:
            raise GraphQLError("You can't remove yourself from an organisation")

        org_member.delete()

        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(org_member.organisation)

        return DeleteOrganisationMemberMutation(ok=True)


class UpdateOrganisationMemberRole(graphene.Mutation):
    class Arguments:
        member_id = graphene.ID(required=True)
        role_id = graphene.ID(required=True)

    org_member = graphene.Field(OrganisationMemberType)

    @classmethod
    def mutate(cls, root, info, member_id, role_id):
        org_member = OrganisationMember.objects.get(id=member_id, deleted_at=None)

        if not user_has_permission(
            info.context.user, "update", "Members", org_member.organisation
        ):
            raise GraphQLError("You dont have permission to change member roles")

        if org_member.user == info.context.user:
            raise GraphQLError("You can't change your own role in an organisation")

        active_user_role = OrganisationMember.objects.get(
            user=info.context.user,
            organisation=org_member.organisation,
            deleted_at=None,
        ).role

        active_user_has_global_access = role_has_global_access(active_user_role)
        current_role_has_global_access = role_has_global_access(org_member.role)

        if current_role_has_global_access and not active_user_has_global_access:
            raise GraphQLError(
                "You cannot change this user's role as you don't have global access"
            )

        new_role = Role.objects.get(organisation=org_member.organisation, id=role_id)

        if new_role.name.lower() == "owner":
            raise GraphQLError("You cannot set this user as the organisation owner")

        org_member.role = new_role
        org_member.save()

        return UpdateOrganisationMemberRole(org_member=org_member)


class TransferOrganisationOwnershipMutation(graphene.Mutation):
    """
    Transfer organisation ownership from the current owner to another member.
    The new owner must have global access (Admin role) to ensure they have all necessary keys.
    """

    class Arguments:
        organisation_id = graphene.ID(required=True)
        new_owner_id = graphene.ID(required=True)
        billing_email = graphene.String(required=False)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, organisation_id, new_owner_id, billing_email=None):
        if not user_is_org_member(info.context.user, organisation_id):
            raise GraphQLError("You don't have permission to perform this action")

        org = Organisation.objects.get(id=organisation_id)

        # Verify the caller is the current owner
        current_member = OrganisationMember.objects.get(
            user=info.context.user,
            organisation=org,
            deleted_at=None,
        )

        if current_member.role.name.lower() != "owner":
            raise GraphQLError("Only the organisation owner can transfer ownership")

        # Get the new owner member
        new_owner_member = OrganisationMember.objects.get(
            id=new_owner_id,
            organisation=org,
            deleted_at=None,
        )

        # Verify the new owner isn't the current owner
        if new_owner_member.id == current_member.id:
            raise GraphQLError("You cannot transfer ownership to yourself")

        # Verify the new owner has global access (Admin role)
        if not role_has_global_access(new_owner_member.role):
            raise GraphQLError(
                "The new owner must have global access (Admin role) before ownership can be transferred. "
            )

        # Verify the new owner has a valid identity_key
        if not new_owner_member.identity_key:
            raise GraphQLError(
                "The new owner does not have a valid identity key. They may need to complete account setup first."
            )

        # Get the Owner and Admin roles
        owner_role = Role.objects.get(organisation=org, name__iexact="owner")
        admin_role = Role.objects.get(organisation=org, name__iexact="admin")

        # Transfer ownership atomically to prevent inconsistent state
        with transaction.atomic():
            # 1. Set new owner's role to Owner
            new_owner_member.role = owner_role
            new_owner_member.save()

            # 2. Update org's identity_key to the new owner's identity_key
            org.identity_key = new_owner_member.identity_key
            org.save()

            # 3. Demote current owner to Admin
            current_member.role = admin_role
            current_member.save()

        # 4. Update Stripe customer email if in cloud mode
        if settings.APP_HOST == "cloud":
            from ee.billing.stripe import update_stripe_customer_email

            # Use provided billing_email or fall back to new owner's email
            email_to_use = billing_email if billing_email else new_owner_member.user.email
            update_stripe_customer_email(org, email_to_use)

        # 5. Send email notifications to both old and new owner
        try:
            send_ownership_transferred_email(org, current_member, new_owner_member)
        except Exception as e:
            print(f"Error sending ownership transfer emails: {e}")

        return TransferOrganisationOwnershipMutation(ok=True)
