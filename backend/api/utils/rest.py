import re
from api.models import EnvironmentToken, ServiceAccountToken, ServiceToken, UserToken
from django.utils import timezone
from django.utils.html import strip_tags
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
import base64
from api.utils.access.ip import get_client_ip

# Strip C0/C1 control characters except tab (0x09), LF (0x0a), CR (0x0d)
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]")

# Map HTTP methods to permission actions
METHOD_TO_ACTION = {
    "GET": "read",
    "POST": "create",
    "PUT": "update",
    "DELETE": "delete",
}


def get_resolver_request_meta(request):
    user_agent = request.META.get("HTTP_USER_AGENT", "Unknown")
    ip_address = get_client_ip(request)

    return ip_address, user_agent


def _parse_auth_token(auth_token):
    """Split 'Bearer <Type> <Value>' into (token_type, token_value).
    Returns (None, None) for any malformed input."""
    if not auth_token:
        return None, None
    parts = auth_token.split(" ")
    if len(parts) < 3 or parts[0].lower() != "bearer" or not parts[1] or not parts[2]:
        return None, None
    return parts[1], parts[2]


def get_token_type(auth_token):
    token_type, _ = _parse_auth_token(auth_token)
    return token_type


def get_env_from_service_token(auth_token):
    _, token = _parse_auth_token(auth_token)
    if not token:
        return False

    try:
        env_token = EnvironmentToken.objects.get(token=token)
        return env_token.environment, env_token.user
    except Exception:
        return False


def get_org_member_from_user_token(auth_token):
    _, token = _parse_auth_token(auth_token)
    if not token:
        return False

    try:
        user_token = UserToken.objects.get(token=token)
        return user_token.user
    except Exception:
        return False


def get_service_account_from_token(auth_token):
    _, token = _parse_auth_token(auth_token)
    if not token:
        return False

    try:
        sa_token = ServiceAccountToken.objects.get(token=token)
        return sa_token.service_account
    except Exception:
        return False


def get_service_token(auth_token):
    token_type, token_value = _parse_auth_token(auth_token)
    if not token_type or not token_value:
        return None

    if token_type == "User":
        return None

    elif token_type == "Service":
        return ServiceToken.objects.get(token=token_value)

    elif token_type == "ServiceAccount":
        return ServiceAccountToken.objects.get(token=token_value)


def token_is_expired_or_deleted(auth_token):
    token_type, token_value = _parse_auth_token(auth_token)
    if not token_type or not token_value:
        return True

    token = None
    if token_type == "User":
        try:
            token = UserToken.objects.get(token=token_value)
        except UserToken.DoesNotExist:
            return True

    elif token_type == "Service":
        try:
            token = ServiceToken.objects.get(token=token_value)
        except ServiceToken.DoesNotExist:
            return True

    elif token_type == "ServiceAccount":
        try:
            token = ServiceAccountToken.objects.get(token=token_value)
        except ServiceAccountToken.DoesNotExist:
            return True

    if token is None:
        return True

    return token.deleted_at is not None or (
        token.expires_at is not None and token.expires_at < timezone.now()
    )


def validate_text_field(value, field_name, max_length=None, required=True):
    """Validate and sanitize a text field from request data.

    Returns (cleaned_value, error_message).
    If error_message is not None, the caller should return a 400 response.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            return None, f"Missing required field: {field_name}"
        return None, None

    if not isinstance(value, str):
        return None, f"'{field_name}' must be a string."

    cleaned = _CONTROL_CHAR_RE.sub("", strip_tags(value)).strip()
    if required and not cleaned:
        return None, f"Missing required field: {field_name}"

    if max_length and len(cleaned) > max_length:
        return None, f"'{field_name}' cannot exceed {max_length} characters."

    return cleaned, None


def validate_email_address(email):
    """Validate an email address using Django's built-in validator.

    Returns (cleaned_email, error_message).
    """
    if email is None or (isinstance(email, str) and not email.strip()):
        return None, "Missing required field: email"

    if not isinstance(email, str):
        return None, "'email' must be a string."

    cleaned = email.strip().lower()

    try:
        validate_email(cleaned)
    except DjangoValidationError:
        return None, f"'{cleaned}' is not a valid email address."

    return cleaned, None


def encode_string_to_base64(s):
    # Convert string to bytes
    byte_representation = s.encode("utf-8")

    # Base64 encode the bytes
    base64_bytes = base64.b64encode(byte_representation)

    # Convert the encoded bytes back to a string
    base64_string = base64_bytes.decode("utf-8")

    return base64_string
