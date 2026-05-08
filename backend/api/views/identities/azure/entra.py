import base64
import json
import logging

import jwt
from django.http import JsonResponse

logger = logging.getLogger(__name__)
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny

from api.utils.identity.azure import validate_azure_jwt
from api.utils.identity.common import (
    resolve_service_account,
    mint_service_account_token,
)
from api.throttling import PlanBasedRateThrottle


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PlanBasedRateThrottle])
def azure_entra_auth(request):
    """Accepts an Azure AD JWT and issues a ServiceAccount token if trusted."""
    try:
        payload = json.loads(request.body)
    except Exception:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({"error": "Invalid JSON payload"}, status=400)

    account = payload.get("account", {})
    azure_entra = payload.get("azureEntra", {})
    token_req = payload.get("tokenRequest", {})

    account_type = (account.get("type") or "service").lower()
    account_id = account.get("id")
    if account_type != "service" or not account_id:
        return JsonResponse(
            {"error": "Only service account authentication supported"}, status=400
        )

    # Decode JWT from base64
    encoded_jwt = azure_entra.get("jwt")
    if not encoded_jwt:
        return JsonResponse({"error": "Missing azureEntra.jwt"}, status=400)

    try:
        token_str = base64.b64decode(encoded_jwt).decode("utf-8")
    except Exception:
        return JsonResponse({"error": "Invalid JWT encoding"}, status=400)

    # Resolve account and identity
    service_account = resolve_service_account(account_id)
    if service_account is None:
        return JsonResponse({"error": "Service account not found"}, status=404)
    if not service_account.server_wrapped_keyring:
        return JsonResponse(
            {"error": "Server-side key management must be enabled"}, status=403
        )

    # Select identity: if multiple azure_entra identities exist, match by tenantId
    identities = list(
        service_account.identities.filter(provider="azure_entra", deleted_at=None)
    )
    if not identities:
        return JsonResponse(
            {"error": "No Azure identity attached to this account"}, status=404
        )

    if len(identities) == 1:
        identity = identities[0]
    else:
        # Peek at the JWT's tid claim to find the matching identity
        try:
            unverified = jwt.decode(token_str, options={"verify_signature": False})
            jwt_tid = unverified.get("tid")
        except Exception:
            return JsonResponse({"error": "Malformed JWT"}, status=400)

        identity = next(
            (
                candidate
                for candidate in identities
                if candidate.config.get("tenantId") == jwt_tid
            ),
            None,
        )
        if identity is None:
            return JsonResponse(
                {"error": "No matching Azure identity for this tenant"}, status=404
            )

    configured_tenant_id = identity.config.get("tenantId")
    configured_resource = identity.config.get("resource")

    if not configured_tenant_id or not configured_resource:
        return JsonResponse(
            {"error": "Identity misconfigured: missing tenantId or resource"},
            status=500,
        )

    # Validate the Azure AD JWT
    try:
        claims = validate_azure_jwt(token_str, configured_tenant_id, configured_resource)
    except Exception as e:
        logger.warning("Azure JWT validation error: %s", e)
        return JsonResponse({"error": "Azure JWT validation failed"}, status=401)

    # Trust check: match oid claim against allowedServicePrincipalIds
    oid = claims.get("oid")
    if not oid:
        return JsonResponse({"error": "Missing oid claim in token"}, status=401)

    trusted = identity.get_trusted_list()
    if any(p == "*" for p in trusted):
        return JsonResponse(
            {"error": "Invalid trusted principal pattern '*' is not allowed"},
            status=400,
        )

    if oid not in trusted:
        return JsonResponse({"error": "Untrusted service principal"}, status=403)

    # Validate requested TTL
    try:
        requested_ttl = int(token_req.get("ttl") or identity.default_ttl_seconds)
    except (ValueError, TypeError):
        return JsonResponse({"error": "Invalid TTL value"}, status=400)

    if requested_ttl <= 0:
        return JsonResponse({"error": "TTL must be a positive integer"}, status=400)

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
            token_name_fallback="azure-entra",
        )
    except Exception:
        return JsonResponse({"error": "Failed to mint token"}, status=500)

    return JsonResponse({"authentication": auth})
