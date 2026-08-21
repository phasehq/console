import logging
import secrets
import time

import graphene
from django.conf import settings
from django.contrib.auth import login, logout
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.db import transaction
from graphql import GraphQLError

from api.models import (
    AuditEvent,
    DynamicSecretLease,
    NetworkAccessPolicy,
    OrganisationMember,
    SCIMUser,
    ServiceAccountToken,
    ServiceToken,
)
from api.utils.audit_logging import log_audit_event
from api.utils.reauth import (
    require_fresh_session_graphql,
    stamp_auth_time_after_relogin,
)
from api.utils.rest import get_resolver_request_meta
from backend.graphene.queries.account import compute_account_deletion_blockers
from backend.graphene.types import OrgKeyringInput

logger = logging.getLogger(__name__)

# --- Email change ceremony ---

EMAIL_CHANGE_TTL = 900  # 15 min
EMAIL_CHANGE_FAIL_LIMIT = 10
EMAIL_CHANGE_FAIL_TTL = 900
# Unambiguous alphabet (no 0/O/1/I) — the code is typed back into the app.
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _generate_email_change_code():
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))


def _email_change_fail_key(user_id):
    return f"email_change_fail:{user_id}"


def _record_email_change_failure(user_id):
    key = _email_change_fail_key(user_id)
    try:
        if not cache.add(key, 1, timeout=EMAIL_CHANGE_FAIL_TTL):
            cache.incr(key)
    except Exception:
        pass


def _email_change_locked_out(user_id):
    return (cache.get(_email_change_fail_key(user_id)) or 0) >= EMAIL_CHANGE_FAIL_LIMIT


def _clear_email_change_pending(session):
    for key in (
        "email_change_new_email",
        "email_change_code_hash",
        "email_change_at",
    ):
        session.pop(key, None)


def _user_is_scim_managed(user):
    return SCIMUser.objects.filter(
        user=user, active=True, org_member__deleted_at__isnull=True
    ).exists()


def revoke_lease_now(lease):
    """Synchronously revoke a live dynamic-secret lease at the provider and
    cancel its scheduled revocation job.

    FK cascades would delete the lease row while the scheduled job
    re-fetches it by id — the provider credential would leak forever. This
    must run BEFORE any DB mutation and abort the whole operation on
    failure (fail closed).
    """
    import django_rq

    from ee.integrations.secrets.dynamic.exceptions import LeaseAlreadyRevokedError

    if lease.secret.provider != "aws":
        logger.warning(
            "Unknown dynamic secret provider %s for lease %s — skipping revoke",
            lease.secret.provider,
            lease.id,
        )
        return

    from ee.integrations.secrets.dynamic.aws.utils import (
        revoke_aws_dynamic_secret_lease,
    )

    try:
        revoke_aws_dynamic_secret_lease(lease.id, manual=True)
    except LeaseAlreadyRevokedError:
        pass  # idempotent retry
    except Exception:
        logger.exception("Failed to revoke dynamic secret lease %s", lease.id)
        raise GraphQLError(
            "Failed to revoke active dynamic credentials. Please try again."
        )

    if lease.cleanup_job_id:
        try:
            scheduler = django_rq.get_scheduler("scheduled-jobs")
            scheduler.cancel(lease.cleanup_job_id)
        except Exception:
            # Best-effort: the orphaned job no-ops against a revoked lease.
            logger.warning(
                "Failed to cancel cleanup job %s for lease %s",
                lease.cleanup_job_id,
                lease.id,
            )


class DeleteAccountMutation(graphene.Mutation):
    """Permanently delete the session user's account. Type-to-confirm is
    client-side (DeleteApp precedent); guards are recomputed server-side."""

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info):
        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        blockers = compute_account_deletion_blockers(user)
        if blockers:
            raise GraphQLError(blockers[0].kind)

        if user.is_staff or user.is_superuser:
            raise GraphQLError(
                "Instance admin accounts cannot be deleted from the console."
            )

        # External pre-work, before any DB change. Includes leases held via
        # SOFT-deleted memberships: the user.delete() cascade hard-deletes
        # those OM rows too, so their still-ACTIVE leases must be revoked
        # here or the AWS IAM user leaks (the scheduled cleanup job would
        # later fetch a row that no longer exists). The inner join on
        # organisation_member__user already excludes service-account leases.
        active_leases = DynamicSecretLease.objects.filter(
            organisation_member__user=user,
            status=DynamicSecretLease.ACTIVE,
        ).select_related("secret")
        for lease in active_leases:
            revoke_lease_now(lease)

        # Captured before deletion — needed after the rows are gone.
        email = user.email
        name = user.full_name or user.email
        memberships = list(
            OrganisationMember.objects.filter(
                user=user, deleted_at=None
            ).select_related("organisation")
        )
        organisations = [m.organisation for m in memberships]
        member_ids = [m.id for m in memberships]

        ip_address, user_agent = get_resolver_request_meta(request)

        with transaction.atomic():
            # Belt-and-braces alongside migration 0137: never let the
            # cascade take org-owned resources with the member rows.
            ServiceToken.objects.filter(created_by_id__in=member_ids).update(
                created_by=None
            )
            ServiceAccountToken.objects.filter(
                created_by_id__in=member_ids
            ).update(created_by=None)
            NetworkAccessPolicy.objects.filter(
                created_by_id__in=member_ids
            ).update(created_by=None)
            NetworkAccessPolicy.objects.filter(
                updated_by_id__in=member_ids
            ).update(updated_by=None)

            # AuditEvent has no actor FK — these tombstones survive the
            # cascade and record who left in each org's audit trail.
            for membership in memberships:
                log_audit_event(
                    organisation=membership.organisation,
                    event_type=AuditEvent.DELETE,
                    resource_type=AuditEvent.ORG_MEMBER,
                    resource_id=membership.id,
                    actor_type="user",
                    actor_id=membership.id,
                    actor_metadata={"email": email, "username": user.username},
                    resource_metadata={"email": email},
                    description="User permanently deleted their account",
                    ip_address=ip_address,
                    user_agent=user_agent,
                )

            def _post_commit():
                if settings.APP_HOST == "cloud":
                    from ee.billing.stripe import update_stripe_subscription_seats

                    for organisation in organisations:
                        # Guard each org so one failure can't skip the rest
                        # or the account-deleted email below. (The callee
                        # raises ValueError for orgs with no Stripe
                        # subscription.)
                        try:
                            update_stripe_subscription_seats(organisation)
                        except Exception:
                            logger.exception(
                                "Failed to update Stripe seats for org %s "
                                "after account deletion",
                                organisation.id,
                            )

                from api.emails import send_account_deleted_email

                try:
                    send_account_deleted_email(email, name)
                except Exception:
                    logger.exception(
                        "Failed to send account_deleted email to %s", email
                    )

            transaction.on_commit(_post_commit)

            # Hard cascade: OM rows and everything member-scoped go;
            # SET_NULL anonymizes audit actors. FK cascades bypass custom
            # delete() overrides — that's why lease revocation ran above.
            user.delete()

        logout(request)
        logger.info("Account permanently deleted for %s", email)
        return DeleteAccountMutation(ok=True)


class UpdateAccountProfileMutation(graphene.Mutation):
    """Update account-level profile attributes. The display name takes
    precedence over provider-reported names in /auth/me, so it survives
    unlinking the identity it originally came from."""

    class Arguments:
        full_name = graphene.String(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, full_name):
        user = info.context.user

        full_name = (full_name or "").strip()
        if len(full_name) > 128:
            raise GraphQLError("Name must be 128 characters or fewer.")

        user.full_name = full_name
        user.save(update_fields=["full_name"])
        return UpdateAccountProfileMutation(ok=True)


class RequestEmailChangeMutation(graphene.Mutation):
    """Step 1 of an email change: validate the target address and email a
    verification code to it. Ownership is proven by the code before the
    address becomes canonical; the actual switch + keyring re-wrap happens
    in ConfirmEmailChangeMutation.

    Same convention as password signup: when SMTP isn't configured (or
    SKIP_EMAIL_VERIFICATION is set), verification is skipped — the code
    could never be delivered, so requiring it would dead-end the flow."""

    class Arguments:
        new_email = graphene.String(required=True)

    ok = graphene.Boolean()
    verification_required = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, new_email):
        from api.emails import send_email_change_code
        from api.views.auth_password import (
            _check_email_domain_allowed,
            _skip_email_verification,
            _smtp_configured,
        )
        from django.contrib.auth import get_user_model

        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        if _user_is_scim_managed(user):
            raise GraphQLError(
                "Your email is managed by your organisation's identity "
                "provider and cannot be changed here."
            )

        new_email = (new_email or "").lower().strip()
        if "@" not in new_email or "." not in new_email.split("@")[-1]:
            raise GraphQLError("Invalid email address.")
        if new_email == (user.email or "").lower().strip():
            raise GraphQLError("That is already your account email.")
        if not _check_email_domain_allowed(new_email):
            raise GraphQLError("This email domain is not allowed on this instance.")

        User = get_user_model()
        if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
            raise GraphQLError("An account with this email already exists.")

        skip_verification = _skip_email_verification() or not _smtp_configured()

        request.session["email_change_new_email"] = new_email
        request.session["email_change_at"] = int(time.time())

        if skip_verification:
            # No code hash in the session marks the pending change as
            # verification-exempt; confirm re-checks the skip condition.
            request.session.pop("email_change_code_hash", None)
            logger.info(
                "Email-change verification skipped for %s (SMTP not "
                "configured or SKIP_EMAIL_VERIFICATION set)",
                new_email,
            )
            return RequestEmailChangeMutation(ok=True, verification_required=False)

        code = _generate_email_change_code()
        request.session["email_change_code_hash"] = make_password(code)

        try:
            send_email_change_code(request, new_email, user, code)
        except Exception:
            logger.exception("Failed to send email-change code to %s", new_email)
            raise GraphQLError("Failed to send the verification email. Please try again.")

        return RequestEmailChangeMutation(ok=True, verification_required=True)


class ConfirmEmailChangeMutation(graphene.Mutation):
    """Step 2: verify the code sent to the new address, then atomically
    switch user.email (+ username, + password authHash for password users)
    and re-wrap every org keyring under the new-email-salted device key.

    The client re-wraps ALL memberships in one ceremony — the device-key
    salt is the account-global email, so a single new device key covers
    every org (no per-org lazy recovery needed)."""

    class Arguments:
        # Optional when the instance skips verification (no SMTP /
        # SKIP_EMAIL_VERIFICATION) — same convention as password signup.
        code = graphene.String(required=False)
        new_email = graphene.String(required=True)
        keyrings = graphene.List(OrgKeyringInput, required=True)
        # Password users only: proves the current password and rotates the
        # login credential to the new-email salt.
        current_auth_hash = graphene.String(required=False)
        new_auth_hash = graphene.String(required=False)

    ok = graphene.Boolean()

    @classmethod
    def mutate(
        cls,
        root,
        info,
        new_email,
        keyrings,
        code=None,
        current_auth_hash=None,
        new_auth_hash=None,
    ):
        from api.emails import send_email_changed_alert
        from api.views.auth_password import (
            _skip_email_verification,
            _smtp_configured,
            username_for_email,
        )
        from django.contrib.auth import get_user_model

        request = info.context
        user = request.user

        require_fresh_session_graphql(request)

        if _email_change_locked_out(str(user.userId)):
            raise GraphQLError("Too many attempts. Please try again later.")

        if _user_is_scim_managed(user):
            raise GraphQLError(
                "Your email is managed by your organisation's identity "
                "provider and cannot be changed here."
            )

        pending_email = request.session.get("email_change_new_email")
        code_hash = request.session.get("email_change_code_hash")
        started_at = request.session.get("email_change_at")
        new_email = (new_email or "").lower().strip()

        if not pending_email or not isinstance(started_at, int):
            raise GraphQLError("No pending email change. Please start again.")
        if int(time.time()) - started_at > EMAIL_CHANGE_TTL:
            _clear_email_change_pending(request.session)
            raise GraphQLError("The verification code has expired. Please start again.")
        if new_email != pending_email:
            raise GraphQLError("Email mismatch. Please start again.")

        if code_hash:
            if not check_password((code or "").strip().upper(), code_hash):
                _record_email_change_failure(str(user.userId))
                raise GraphQLError("Incorrect verification code.")
        else:
            # A code-less pending change is only written by the request
            # mutation in skip mode — re-check the condition server-side so
            # a forged/stale no-code state can't bypass verification on an
            # instance that does have SMTP.
            if not (_skip_email_verification() or not _smtp_configured()):
                raise GraphQLError("No pending email change. Please start again.")

        User = get_user_model()
        if User.objects.filter(email__iexact=new_email).exclude(pk=user.pk).exists():
            raise GraphQLError("An account with this email already exists.")

        has_password = user.has_usable_password()
        if has_password:
            if not current_auth_hash or not new_auth_hash:
                raise GraphQLError("Password proof required for this account.")
            if not user.check_password(current_auth_hash):
                raise GraphQLError("Current password is incorrect.")

        old_email = user.email

        with transaction.atomic():
            # Membership read + completeness gate run INSIDE the transaction
            # to shrink the window where a concurrently-created membership
            # (invite acceptance) could slip past the gate and keep an
            # old-email-salted wrapper.
            #
            # Map submitted re-wrapped keyrings to the user's live
            # memberships, validating each identity_key matches the stored
            # one (the keyring contents are unchanged — only the wrapper is
            # re-encrypted).
            memberships = OrganisationMember.objects.filter(
                user=user, deleted_at__isnull=True
            ).select_related("organisation")
            members_by_org = {}
            for m in memberships:
                if m.identity_key:  # skip pre-provisioned members with no keyring
                    members_by_org[str(m.organisation_id)] = m

            # Completeness gate — the account-global device key is being
            # rotated, so EVERY org with a keyring must be re-wrapped in
            # this one ceremony. A membership left un-submitted keeps its
            # old-email-salted wrapper and becomes un-unlockable once the
            # email flips. The client can send a partial/stale/empty set
            # (org list still loading, added in another tab, poll lag), so
            # refuse rather than brick — the caller reloads and retries.
            submitted_org_ids = {str(e.org_id) for e in keyrings}
            missing = set(members_by_org.keys()) - submitted_org_ids
            if missing:
                raise GraphQLError(
                    "Email change aborted: your keyrings were not re-encrypted "
                    "for all of your organisations. Please reload and try again."
                )

            for entry in keyrings:
                member = members_by_org.get(str(entry.org_id))
                if member is None:
                    continue  # unknown/empty-crypto org — nothing to re-wrap
                if entry.identity_key != member.identity_key:
                    raise GraphQLError(
                        "Keyring verification failed for one of your organisations."
                    )
                member.wrapped_keyring = entry.wrapped_keyring
                member.wrapped_recovery = entry.wrapped_recovery
                member.save(update_fields=["wrapped_keyring", "wrapped_recovery"])

            user.email = new_email
            user.username = username_for_email(new_email)
            if has_password:
                user.set_password(new_auth_hash)
                user.save(update_fields=["email", "username", "password"])
            else:
                user.save(update_fields=["email", "username"])

        _clear_email_change_pending(request.session)
        # Success resets the brute-force counter (same convention as
        # clear_mfa_failures) — otherwise failed attempts accumulate
        # across successful changes and progressively tighten the lockout.
        cache.delete(_email_change_fail_key(str(user.userId)))

        # Rotating the password changes the session auth hash — re-login to
        # keep the current session valid (mirrors ChangeAccountPassword).
        prev_auth_method = request.session.get("auth_method", "password")
        prev_sso_org_id = request.session.get("auth_sso_org_id")
        prev_sso_provider_id = request.session.get("auth_sso_provider_id")
        login(request, user)
        request.session["auth_method"] = prev_auth_method
        if prev_sso_org_id:
            request.session["auth_sso_org_id"] = prev_sso_org_id
        if prev_sso_provider_id:
            request.session["auth_sso_provider_id"] = prev_sso_provider_id
        # Password-only proof doesn't re-mint freshness for TOTP users
        # (consistent with change-password / keyring recovery).
        stamp_auth_time_after_relogin(request, user)

        def _post_commit():
            # Deliberately NOT touching Stripe customer email: billing email
            # is a distinct attribute managed via ownership transfer (it may
            # have been set to an address different from user.email), and
            # it isn't persisted locally to compare against. A personal
            # account-email change must not clobber it.

            # Security alert to the OLD address — the one place someone who
            # lost control of the account would still see it.
            try:
                send_email_changed_alert(request, old_email, new_email, user)
            except Exception:
                logger.exception("Failed to send email-changed alert to %s", old_email)

        transaction.on_commit(_post_commit)

        logger.info(
            "Account email changed from %s to %s", old_email, new_email
        )
        return ConfirmEmailChangeMutation(ok=True)
