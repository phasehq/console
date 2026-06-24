import json
import logging

from api.models import SCIMEvent
from api.utils.access.ip import get_client_ip

logger = logging.getLogger(__name__)

MAX_BODY_SIZE = 32768  # 32KB


def log_scim_event(
    request,
    event_type,
    resource_type,
    resource_id="",
    resource_name="",
    detail=None,
    status="success",
    response_status=None,
    response_body=None,
):
    """Log a SCIM provisioning event."""
    try:
        SCIMEvent.objects.create(
            organisation=request.auth["organisation"],
            scim_token=request.auth.get("scim_token"),
            event_type=event_type,
            status=status,
            resource_type=resource_type,
            resource_id=str(resource_id),
            resource_name=resource_name,
            detail=detail or {},
            request_method=request.method,
            request_path=request.path,
            request_body=_safe_parse_body(request),
            response_status=response_status,
            response_body=response_body,
            ip_address=get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
        )
    except Exception:
        logger.exception("Failed to log SCIM event")


def _safe_parse_body(request):
    """Parse request body as JSON, returning None if not JSON or too large."""
    try:
        if len(request.body) > MAX_BODY_SIZE:
            return {"_truncated": True, "size": len(request.body)}
        return json.loads(request.body)
    except (json.JSONDecodeError, Exception):
        return None
