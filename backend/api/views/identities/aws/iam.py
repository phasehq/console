import base64
import json
from io import StringIO
from urllib.parse import urlparse
import fnmatch
import requests
from defusedxml.ElementTree import parse
from django.http import JsonResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny

from api.utils.identity.common import (
    resolve_service_account,
    mint_service_account_token,
)
from api.throttling import PlanBasedRateThrottle


def get_normalized_host(uri):
    """Extracts lowercase hostname from a URL, handling missing schemes."""
    if not uri:
        return None
    if "://" not in uri:
        uri = f"https://{uri}"
    return urlparse(uri).netloc.lower()


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PlanBasedRateThrottle])
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
        return JsonResponse(
            {"error": "Only service account authentication supported"}, status=400
        )

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

        dt = datetime.strptime(amz_date.replace("Z", ""), "%Y%m%dT%H%M%S").replace(
            tzinfo=dt_timezone.utc
        )
    except Exception:
        return JsonResponse({"error": "Invalid X-Amz-Date"}, status=400)

    # Resolve account and identity
    service_account = resolve_service_account(account_id)
    if service_account is None:
        return JsonResponse({"error": "Service account not found"}, status=404)
    if not service_account.server_wrapped_keyring:
        return JsonResponse(
            {"error": "Server-side key management must be enabled"}, status=403
        )

    # Select identity: if multiple aws_iam identities exist, match by STS endpoint
    identities = list(
        service_account.identities.filter(provider="aws_iam", deleted_at=None)
    )
    if not identities:
        return JsonResponse(
            {"error": "No AWS IAM identity attached to this account"}, status=404
        )

    identity = identities[0]
    req_host = get_normalized_host(url)

    if len(identities) > 1:
        # Find the first candidate where the endpoint matches the request host
        # Defaults to identities[0] if no match is found
        identity = next(
            (
                candidate
                for candidate in identities
                if get_normalized_host(candidate.config.get("stsEndpoint")) == req_host
            ),
            identities[0],
        )

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
        if configured and "://" not in configured:
            configured = f"https://{configured}"

        from api.utils.network import validate_url_is_safe
        validate_url_is_safe(configured)

        cfg_host = get_normalized_host(configured)
        header_host = (headers.get("Host") or headers.get("host") or "").lower()

        if req_host != cfg_host or (header_host and header_host != cfg_host):
            return JsonResponse(
                {
                    "error": "STS endpoint mismatch. Please sign the request for the configured STS endpoint.",
                    "expectedEndpoint": configured,
                    "receivedEndpoint": url,
                },
                status=400,
            )
    except Exception:
        return JsonResponse({"error": "Invalid STS endpoint configuration"}, status=400)

    # Forward the signed request to AWS STS
    try:
        resp = requests.request(
            method, configured, headers=headers, data=body, timeout=10
        )
    except requests.exceptions.Timeout:
        return JsonResponse({"error": "AWS STS request timed out"}, status=504)
    except requests.exceptions.ConnectionError:
        return JsonResponse({"error": "Unable to connect to AWS STS"}, status=502)
    except Exception:
        return JsonResponse({"error": "Failed to contact AWS STS"}, status=502)

    if resp.status_code != 200:
        return JsonResponse(
            {"error": "AWS STS validation failed", "status": resp.status_code},
            status=401,
        )

    arn = None
    try:
        xml_root = parse(StringIO(resp.text))

        # AWS STS namespace
        ns = {"aws": "https://sts.amazonaws.com/doc/2011-06-15/"}

        # Find the ARN element in the GetCallerIdentityResult
        arn_element = xml_root.find(".//aws:GetCallerIdentityResult/aws:Arn", ns)
        if arn_element is not None and arn_element.text:
            arn = arn_element.text.strip()
    except Exception:
        pass

    if arn is None:
        return JsonResponse({"error": "Unable to parse AWS identity"}, status=500)

    # Trust check
    trusted = identity.get_trusted_list()
    if any(p == "*" for p in trusted):
        return JsonResponse(
            {"error": "Invalid trusted principal pattern '*' is not allowed"},
            status=400,
        )

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
        return JsonResponse(
            {
                "error": f"Requested TTL ({requested_ttl}s) exceeds maximum allowed TTL ({max_ttl}s)"
            },
            status=400,
        )

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
