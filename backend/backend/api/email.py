from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

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
