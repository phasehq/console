import base64
import json
import re
from urllib.parse import urlparse

import requests
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from api.utils.identity.common import (
    resolve_service_account,
    resolve_attached_identity,
    mint_service_account_token,
)


@api_view(["POST"])
@permission_classes([AllowAny])
def aws_iam_auth(request):
    """Accepts SigV4-signed STS GetCallerIdentity request and issues a ServiceAccount token if trusted."""
    try:
        payload = json.loads(request.body)
    except Exception:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    account = (payload or {}).get("account", {})
    aws_iam = (payload or {}).get("awsIam", {})
    token_req = (payload or {}).get("tokenRequest", {})

    account_type = (account.get("type") or "service").lower()
    account_id = account.get("id")
    if account_type != "service" or not account_id:
        return JsonResponse({"error": "Only service account authentication supported"}, status=400)

    # Decode signed request
    try:
        method = aws_iam.get("httpRequestMethod") or "POST"
        url = base64.b64decode(aws_iam["httpRequestUrl"]).decode("utf-8")
        headers_json = base64.b64decode(aws_iam["httpRequestHeaders"]).decode("utf-8")
        body = base64.b64decode(aws_iam.get("httpRequestBody") or b"").decode("utf-8")
        headers = json.loads(headers_json)
    except Exception:
        return JsonResponse({"error": "Invalid awsIam request encoding"}, status=400)

    # Verify signature freshness using X-Amz-Date
    amz_date = headers.get("X-Amz-Date") or headers.get("x-amz-date")
    if not amz_date:
        return JsonResponse({"error": "Missing X-Amz-Date header"}, status=400)
    try:
        from datetime import datetime, timezone as dt_timezone

        dt = (
            datetime.strptime(amz_date.replace("Z", ""), "%Y%m%dT%H%M%S")
            .replace(tzinfo=dt_timezone.utc)
        )
    except Exception:
        return JsonResponse({"error": "Invalid X-Amz-Date"}, status=400)

    # Resolve account and identity
    service_account = resolve_service_account(account_id)
    if service_account is None:
        return JsonResponse({"error": "Service account not found"}, status=404)
    if not service_account.server_wrapped_keyring:
        return JsonResponse({"error": "Server-side key management must be enabled"}, status=403)

    identity = resolve_attached_identity(service_account, "aws_iam")
    if not identity:
        return JsonResponse({"error": "No AWS IAM identity attached to this account"}, status=404)

    try:
        max_skew = int(identity.config.get("signatureTtlSeconds", 60))
    except Exception:
        max_skew = 60
    now = timezone.now()
    if abs((now - dt).total_seconds()) > max_skew:
        return JsonResponse({"error": "Signature expired"}, status=401)

    # Enforce that the signed request targets the identity's configured STS endpoint
    try:
        configured = identity.config.get("stsEndpoint")
        if not configured.startswith("http"):
            configured = f"https://{configured}"
        request_url = url
        if not request_url.startswith("http"):
            request_url = f"https://{request_url}"

        cfg_host = urlparse(configured).netloc.lower()
        req_host = urlparse(request_url).netloc.lower()
        header_host = (headers.get("Host") or headers.get("host") or "").lower()

        if req_host != cfg_host or (header_host and header_host != cfg_host):
            return JsonResponse(
                {
                    "error": "STS endpoint mismatch. Please sign the request for the configured STS endpoint.",
                    "expectedEndpoint": configured,
                    "receivedEndpoint": request_url,
                },
                status=400,
            )
    except Exception:
        return JsonResponse({"error": "Invalid STS endpoint configuration"}, status=400)

    # Forward the signed request to AWS STS
    try:
        resp = requests.request(method, url, headers=headers, data=body)
    except Exception:
        return JsonResponse({"error": "Failed to contact AWS STS"}, status=502)

    if resp.status_code != 200:
        return JsonResponse({"error": "AWS STS validation failed", "status": resp.status_code}, status=401)

    # Parse minimal identity info from XML
    arn = None
    try:
        m = re.search(r"<Arn>([^<]+)</Arn>", resp.text)
        if m:
            arn = m.group(1)
    except Exception:
        pass
    if arn is None:
        return JsonResponse({"error": "Unable to parse AWS identity"}, status=500)

    # Trust check
    import fnmatch

    trusted = identity.get_trusted_list()
    if any(p == "*" for p in trusted):
        return JsonResponse({"error": "Invalid trusted principal pattern '*' is not allowed"}, status=400)

    def arn_matches_patterns(value: str, patterns: list[str]) -> bool:
        for pattern in patterns:
            if not pattern or pattern == "*":
                continue
            if fnmatch.fnmatch(value, pattern):
                return True
        return False

    if not arn_matches_patterns(arn, trusted):
        return JsonResponse({"error": "Untrusted principal"}, status=403)

    # Validate requested TTL
    requested_ttl = int(token_req.get("ttl") or identity.default_ttl_seconds)
    max_ttl = identity.max_ttl_seconds
    
    if requested_ttl > max_ttl:
        return JsonResponse({
            "error": f"Requested TTL ({requested_ttl}s) exceeds maximum allowed TTL ({max_ttl}s)"
        }, status=400)

    try:
        auth = mint_service_account_token(
            service_account,
            identity,
            requested_ttl,
            token_name_fallback="aws-iam",
        )
    except Exception:
        return JsonResponse({"error": "Failed to mint token"}, status=500)

    return JsonResponse({"authentication": auth})


