from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from datetime import datetime
import os
import logging
from api.utils.rest import encode_string_to_base64
from api.models import OrganisationMember
from django.utils import timezone
from smtplib import SMTPException

from api.utils.access.ip import get_client_ip

logger = logging.getLogger(__name__)


def _frontend_url():
    """Return the canonical frontend origin for use in email links.

    `ALLOWED_ORIGINS` is comma-separated (e.g. for Tailscale Funnel +
    localhost dev setups); using it raw produces malformed URLs like
    `https://a,b/login`. Pick the first entry — same convention as
    auth_password.py / sso.py.
    """
    return os.getenv("ALLOWED_ORIGINS", "").split(",")[0].strip()


def get_user_display_name(user):
    """Best greeting name for account-level emails: the user-set display
    name wins (same precedence as /auth/me), then the first linked
    identity's name, then the email as a last resort."""
    if getattr(user, "full_name", ""):
        return user.full_name

    social_acc = user.socialaccount_set.first()
    if social_acc:
        name = (social_acc.extra_data or {}).get("name")
        if name:
            return name

    return user.email


def get_org_member_name(org_member):
    user = org_member.user

    social_acc = user.socialaccount_set.first()
    if social_acc:
        name = (social_acc.extra_data or {}).get("name")
        if name:
            return name

    if user.full_name:
        return user.full_name

    return user.email


def send_email(subject, recipient_list, template_name, context):
    """
    Send email via SMTP gateway through Django's email backend.
    """
    # Load the template
    email_html_message = render_to_string(template_name, context)

    # Get the DEFAULT_FROM_EMAIL from settings
    default_from_email = getattr(settings, "DEFAULT_FROM_EMAIL")

    try:
        # Send the email
        send_mail(
            subject,
            "",  # plain text content can be empty as we're sending HTML
            f"Phase <{default_from_email}>",
            recipient_list,
            html_message=email_html_message,
            fail_silently=False,  # Changed to False to catch exceptions
        )
        logger.debug(f"Email sent successfully: {subject} to {recipient_list}")
        return True
    except SMTPException as e:
        logger.error(f"SMTP Error sending email to {recipient_list}: {str(e)}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error sending email to {recipient_list}: {str(e)}")
        return False


def _request_meta_context(request):
    user_agent = request.META.get("HTTP_USER_AGENT", "Unknown")
    ip_address = get_client_ip(request)
    timestamp = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z (%z)")
    return {"ip": ip_address, "user_agent": user_agent, "timestamp": timestamp}


def send_login_email(request, email, full_name, provider):
    # SSO adapters call this from complete_login, which also runs when an
    # authenticated user links an additional identity — no login happened.
    if getattr(request, "sso_link_mode", False):
        return

    user_agent = request.META.get("HTTP_USER_AGENT", "Unknown")
    ip_address = get_client_ip(request)

    # Get the current time in the current timezone
    current_time = timezone.now()

    # Format the timestamp with timezone information
    timestamp = current_time.strftime("%Y-%m-%d %H:%M:%S %Z (%z)")

    # Creating context dictionary
    context = {
        "auth": provider,
        "full_name": full_name,
        "email": email,
        "ip": ip_address,
        "user_agent": user_agent,
        "timestamp": timestamp,
    }

    send_email(
        "New Login Alert - Phase Console",
        [email],
        "api/login.html",
        context,
    )


def _send_security_alert(
    request, user, subject, template_name, extra_context=None, recipient=None
):
    """Shared sender for the account security-alert emails, which all render
    the same _security_alert_base.html skeleton (greeting, request metadata,
    manage-account button) and differ only in the message block."""
    context = {
        "full_name": get_user_display_name(user),
        "email": user.email,
        "account_link": f"{_frontend_url()}/account",
        **_request_meta_context(request),
        **(extra_context or {}),
    }
    return send_email(subject, [recipient or user.email], template_name, context)


def send_identity_linked_email(request, user, provider_name, identity_email):
    """Notify the account's email (not the IdP-claimed one) that a new
    sign-in identity was linked."""
    return _send_security_alert(
        request,
        user,
        "New sign-in method linked - Phase Console",
        "api/identity_linked.html",
        {"provider": provider_name, "identity_email": identity_email},
    )


def send_identity_unlinked_email(request, user, provider_name, identity_email):
    return _send_security_alert(
        request,
        user,
        "Sign-in method removed - Phase Console",
        "api/identity_unlinked.html",
        {"provider": provider_name, "identity_email": identity_email},
    )


def send_totp_status_email(request, user, enabled):
    if enabled:
        return _send_security_alert(
            request,
            user,
            "Two-factor authentication enabled - Phase Console",
            "api/totp_enabled.html",
        )
    return _send_security_alert(
        request,
        user,
        "Two-factor authentication disabled - Phase Console",
        "api/totp_disabled.html",
    )


def send_recovery_codes_regenerated_email(request, user):
    return _send_security_alert(
        request,
        user,
        "Two-factor recovery codes regenerated - Phase Console",
        "api/recovery_codes_regenerated.html",
    )


def send_email_change_code(request, new_email, user, code):
    """Send the verification code to the prospective NEW address. Returns
    False on delivery failure so the caller can surface it."""
    context = {
        "full_name": get_user_display_name(user),
        "new_email": new_email,
        "code": code,
        **_request_meta_context(request),
    }
    return send_email(
        "Verify your new email address - Phase Console",
        [new_email],
        "api/email_change_code.html",
        context,
    )


def send_email_changed_alert(request, old_email, new_email, user):
    """Security alert to the OLD address after an email change completes."""
    return _send_security_alert(
        request,
        user,
        "Your email address was changed - Phase Console",
        "api/email_changed_alert.html",
        {"old_email": old_email, "new_email": new_email},
        recipient=old_email,
    )


def send_account_deleted_email(email, name):
    """Sent post-commit: the address is captured before the user row is
    deleted, so the mailbox is unaffected by our DB state."""
    send_email(
        "Your Phase account has been deleted",
        [email],
        "api/account_deleted.html",
        {"name": name, "email": email},
    )



def _get_invite_sender_name(invite):
    if invite.invited_by:
        return get_org_member_name(invite.invited_by)
    if invite.invited_by_service_account:
        return invite.invited_by_service_account.name
    return invite.organisation.name


def send_invite_email(invite):
    organisation = invite.organisation.name

    invited_by_name = _get_invite_sender_name(invite)

    invite_code = encode_string_to_base64(str(invite.id))

    invite_link = f"{_frontend_url()}/invite/{invite_code}"

    context = {
        "organisation": organisation,
        "invited_by": invited_by_name,
        "invite_link": invite_link,
    }

    send_email(
        f"Invite - {organisation} on Phase",
        [invite.invitee_email],
        "api/invite.html",
        context,
    )


def send_user_joined_email(invite, new_member):
    organisation = invite.organisation.name
    members_page_link = f"{_frontend_url()}/{organisation}/access/members"

    owner = OrganisationMember.objects.get(
        organisation=invite.organisation, role__name="Owner", deleted_at=None
    )

    owner_name = get_org_member_name(owner)

    invited_by_name = _get_invite_sender_name(invite)

    if owner_name == invited_by_name:
        invited_by_name = "you"

    new_user_name = get_org_member_name(new_member)

    if invited_by_name is None:
        invited_by_name = invite.invited_by.user.email

    context = {
        "recipient_name": owner_name,
        "organisation": organisation,
        "invited_by": invited_by_name,
        "new_user": new_user_name,
        "members_page_link": members_page_link,
    }

    send_email(
        f"A new user has joined {organisation} on Phase",
        [owner.user.email],
        "api/user_joined_org.html",
        context,
    )


def send_welcome_email(new_member):
    organisation = new_member.organisation.name
    org_home_link = f"{_frontend_url()}/{organisation}"

    name = get_org_member_name(new_member)

    context = {
        "name": name,
        "organisation": organisation,
        "org_home_link": org_home_link,
    }

    send_email(
        f"Welcome to Phase!",
        [new_member.user.email],
        "api/welcome.html",
        context,
    )


def send_scim_provisioned_email(scim_user):
    """Notify a SCIM-provisioned user that their account is ready and they
    need to sign in (SSO + key ceremony) to complete setup."""
    from urllib.parse import urlencode

    organisation = scim_user.organisation.name
    login_link = (
        f"{_frontend_url()}/login?"
        + urlencode({"email": scim_user.email})
    )

    sso_provider = scim_user.organisation.sso_providers.filter(enabled=True).first()
    provider_name = sso_provider.name if sso_provider else None

    name = scim_user.display_name or scim_user.email

    context = {
        "name": name,
        "organisation": organisation,
        "login_link": login_link,
        "provider_name": provider_name,
    }

    send_email(
        f"Your account is ready - {organisation} on Phase",
        [scim_user.email],
        "api/scim_provisioned.html",
        context,
    )


def send_rotation_unhealthy_email(rotating_secret_id):
    """Notify org admins + the rotation's creator that a rotating secret has
    transitioned into degraded/failed. Recipient list is resolved at send
    time so role/membership changes between the transition and the email
    going out are honoured.

    The creator is resolved from the CONFIG_CREATED event in the rotation's
    own audit log — no extra model field is needed.
    """
    from api.models import RotatingSecret, RotatingSecretEvent

    try:
        rs = RotatingSecret.objects.select_related(
            "environment__app__organisation",
        ).get(id=rotating_secret_id, deleted_at__isnull=True)
    except RotatingSecret.DoesNotExist:
        logger.info(
            "Skipping rotation_unhealthy email: rotating secret %s not found / deleted",
            rotating_secret_id,
        )
        return

    org = rs.environment.app.organisation
    organisation = org.name

    # Resolve creator from the CONFIG_CREATED event. Falls back gracefully
    # for legacy rotations or rotations created by a service account.
    creator_event = (
        rs.events.filter(
            event_type=RotatingSecretEvent.CONFIG_CREATED,
            organisation_member__isnull=False,
            organisation_member__deleted_at=None,
        )
        .select_related("organisation_member__user")
        .order_by("created_at")
        .first()
    )
    creator_member = creator_event.organisation_member if creator_event else None

    admin_members = list(
        OrganisationMember.objects.filter(
            organisation=org,
            role__name__in=["Owner", "Admin"],
            deleted_at=None,
        ).select_related("user")
    )

    # De-dupe by user pk (CustomUser.userId) so a creator who is also
    # Owner/Admin gets one email, not two.
    recipients_by_user_id = {}
    for m in admin_members:
        recipients_by_user_id[m.user.userId] = (m, False)
    if creator_member:
        existing = recipients_by_user_id.get(creator_member.user.userId)
        if existing is None:
            recipients_by_user_id[creator_member.user.userId] = (creator_member, True)
        else:
            # Creator is also an admin — flag them as creator for copy framing.
            recipients_by_user_id[creator_member.user.userId] = (existing[0], True)

    if not recipients_by_user_id:
        logger.info(
            "Skipping rotation_unhealthy email: no recipients for rotating secret %s",
            rotating_secret_id,
        )
        return

    env_link = (
        f"{_frontend_url()}/{organisation}/apps/{rs.environment.app.id}"
        f"/environments/{rs.environment.id}"
    )

    subject_status = "failed" if rs.health == RotatingSecret.FAILED else "degraded"
    subject = (
        f"Rotation {subject_status} - {rs.name} on Phase"
    )

    for user_id, (member, is_creator) in recipients_by_user_id.items():
        context = {
            "recipient_name": get_org_member_name(member),
            "organisation": organisation,
            "rotation_name": rs.name,
            "app_name": rs.environment.app.name,
            "environment_name": rs.environment.name,
            "rotation_path": rs.path,
            "provider": rs.provider,
            "health": rs.health,
            "failure_count": rs.consecutive_failure_count,
            "failure_reason": rs.last_failure_reason,
            "env_link": env_link,
            "is_creator": is_creator,
        }
        send_email(
            subject,
            [member.user.email],
            "api/rotation_unhealthy.html",
            context,
        )


def send_ownership_transferred_email(org, old_owner_member, new_owner_member):
    """Send email notifications to both the old and new owner after an ownership transfer."""
    organisation = org.name
    members_page_link = f"{_frontend_url()}/{organisation}/access/members"
    org_home_link = f"{_frontend_url()}/{organisation}"

    old_owner_name = get_org_member_name(old_owner_member)
    new_owner_name = get_org_member_name(new_owner_member)

    # Email to old owner
    send_email(
        f"Ownership transferred - {organisation} on Phase",
        [old_owner_member.user.email],
        "api/ownership_transferred_old_owner.html",
        {
            "old_owner_name": old_owner_name,
            "new_owner_name": new_owner_name,
            "new_owner_email": new_owner_member.user.email,
            "organisation": organisation,
            "members_page_link": members_page_link,
        },
    )

    # Email to new owner
    send_email(
        f"You are now the owner of {organisation} on Phase",
        [new_owner_member.user.email],
        "api/ownership_transferred_new_owner.html",
        {
            "new_owner_name": new_owner_name,
            "old_owner_name": old_owner_name,
            "old_owner_email": old_owner_member.user.email,
            "organisation": organisation,
            "org_home_link": org_home_link,
        },
    )
