from django.http import JsonResponse

SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error"


def scim_error(status, detail, scim_type=None):
    """Return a SCIM-formatted error response (RFC 7644 Section 3.12)."""
    body = {
        "schemas": [SCIM_ERROR_SCHEMA],
        "status": str(status),
        "detail": detail,
    }
    if scim_type:
        body["scimType"] = scim_type
    return JsonResponse(body, status=status)


def scim_not_found(detail="Resource not found"):
    return scim_error(404, detail)


def scim_conflict(detail="Resource already exists"):
    return scim_error(409, detail, scim_type="uniqueness")


def scim_bad_request(detail="Invalid request"):
    return scim_error(400, detail, scim_type="invalidValue")


def scim_forbidden(detail="Operation not permitted"):
    return scim_error(403, detail)


def scim_server_error(detail="Internal server error"):
    return scim_error(500, detail)
