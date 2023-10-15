from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from datetime import datetime
import os
from api.utils import encode_string_to_base64, get_client_ip
from api.models import OrganisationMember


def get_org_member_name(org_member):
    social_acc = org_member.user.socialaccount_set.first()

    member_name = social_acc.extra_data.get('name')

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

    # Send the email
    send_mail(
        subject,
        '',  # plain text content can be empty as we're sending HTML
        default_from_email,
        recipient_list,
        html_message=email_html_message
    )


def send_login_email(request, email, provider):
    user_agent = request.META.get('HTTP_USER_AGENT', 'Unknown')
    ip_address = get_client_ip(request)
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Creating context dictionary
    context = {
        'auth': provider,
        'email': email,
        'ip': ip_address,
        'user_agent': user_agent,
        'timestamp': timestamp
    }

    send_email(
        'New Login Alert - Phase Console',
        [email],
        'backend/api/email_templates/login.html',
        context
    )


def send_inite_email(invite):
    organisation = invite.organisation.name

    invited_by_name = get_org_member_name(invite.invited_by)

    invite_code = encode_string_to_base64(str(invite.id))

    invite_link = f"{os.getenv('ALLOWED_ORIGINS')}/invite/{invite_code}"

    context = {
        'organisation': organisation,
        'invited_by': invited_by_name,
        'invite_link': invite_link
    }

    send_email(
        f"Invite - {organisation} on Phase",
        [invite.invitee_email],
        'backend/api/email_templates/invite.html',
        context
    )


def send_user_joined_email(invite, new_member):
    organisation = invite.organisation.name

    owner = OrganisationMember.objects.get(
        organisation=invite.organisation, role=OrganisationMember.OWNER, deleted_at=None)

    owner_name = get_org_member_name(owner)

    invited_by_name = get_org_member_name(invite.invited_by)

    if owner_name == invited_by_name:
        invited_by_name = 'you'

    new_user_name = get_org_member_name(new_member)

    if invited_by_name is None:
        invited_by_name = invite.invited_by.user.email

    context = {
        'organisation': organisation,
        'invited_by': invited_by_name,
        'new_user': new_user_name
    }

    send_email(
        f"A new user has joined {organisation} on Phase",
        [owner.user.email],
        'backend/api/email_templates/user_joined_org.html',
        context
    )
