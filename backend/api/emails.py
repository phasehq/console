from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from datetime import datetime

from api.utils import get_client_ip


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


def send_login_email(request, email):
    user_agent = request.META.get('HTTP_USER_AGENT', 'Unknown')
    ip_address = get_client_ip(request)
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Creating context dictionary
    context = {
        'auth': 'GitHub',
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
