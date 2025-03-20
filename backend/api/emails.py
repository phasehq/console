from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from datetime import datetime
import os
import logging
from api.utils.rest import encode_string_to_base64, get_client_ip
from api.models import OrganisationMember
from django.utils import timezone
from smtplib import SMTPException

logger = logging.getLogger(__name__)


def get_org_member_name(org_member):
    social_acc = org_member.user.socialaccount_set.first()

    member_name = social_acc.extra_data.get("name")

    if member_name is None:
        member_name = org_member.email

    return member_name


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


def send_login_email(request, email, full_name, provider):
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


def send_invite_email(invite):
    organisation = invite.organisation.name

    invited_by_name = get_org_member_name(invite.invited_by)

    invite_code = encode_string_to_base64(str(invite.id))

    invite_link = f"{os.getenv('ALLOWED_ORIGINS')}/invite/{invite_code}"

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
    members_page_link = f"{os.getenv('ALLOWED_ORIGINS')}/{organisation}/access/members"

    owner = OrganisationMember.objects.get(
        organisation=invite.organisation, role__name="Owner", deleted_at=None
    )

    owner_name = get_org_member_name(owner)

    invited_by_name = get_org_member_name(invite.invited_by)

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
    org_home_link = f"{os.getenv('ALLOWED_ORIGINS')}/{organisation}"

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
