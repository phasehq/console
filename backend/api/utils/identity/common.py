import json

from django.utils import timezone


def resolve_service_account(account_id):
    from api.models import ServiceAccount

    try:
        service_account = ServiceAccount.objects.get(id=account_id)
    except ServiceAccount.DoesNotExist:
        return None
    return service_account


def resolve_attached_identity(service_account, provider: str):
    """Return the first non-deleted identity for the service account and provider."""
    return service_account.identities.filter(provider=provider, deleted_at=None).first()


def mint_service_account_token(service_account, identity, requested_ttl: int, token_name_fallback: str):
    """
    Create a ServiceAccountToken for the given service account using the server
    keyring, honoring the identity's TTL rules. Returns a dict suitable for
    JSON response containing token strings and TTLs.
    """
    from api.utils.crypto import (
        get_server_keypair,
        decrypt_asymmetric,
        split_secret_hex,
        wrap_share_hex,
        random_hex,
        ed25519_to_kx,
    )
    from api.models import ServiceAccountToken

    now = timezone.now()

    # Load and unwrap server-managed keyring
    pk, sk = get_server_keypair()
    keyring_json = decrypt_asymmetric(
        service_account.server_wrapped_keyring, sk.hex(), pk.hex()
    )
    keyring = json.loads(keyring_json)
    kx_pub, kx_priv = ed25519_to_kx(keyring["publicKey"], keyring["privateKey"])

    # Compute TTL consistent with limits
    req_ttl = int(requested_ttl or identity.default_ttl_seconds)
    ttl = min(req_ttl, identity.max_ttl_seconds)
    expires_at = now + timezone.timedelta(seconds=ttl)

    # Create token material
    wrap_key = random_hex(32)
    token_value = random_hex(32)
    share_a, share_b = split_secret_hex(kx_priv)
    wrapped_share_b = wrap_share_hex(share_b, wrap_key)

    ServiceAccountToken.objects.create(
        service_account=service_account,
        name=(identity.token_name_pattern or token_name_fallback),
        identity_key=kx_pub,
        token=token_value,
        wrapped_key_share=wrapped_share_b,
        created_by_service_account=service_account,
        expires_at=expires_at,
    )

    full_token = f"pss_service:v2:{token_value}:{kx_pub}:{share_a}:{wrap_key}"
    bearer = f"ServiceAccount {token_value}"

    return {
        "tokenType": "ServiceAccount",
        "token": full_token,
        "bearerToken": bearer,
        "TTL": ttl,
        "maxTTL": identity.max_ttl_seconds,
    }
