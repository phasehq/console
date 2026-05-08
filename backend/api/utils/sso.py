import re
from urllib.parse import urlparse

# Single source of truth for org-level SSO provider metadata.
# To add a new provider: add an entry here, create its adapter, done.
# `required_fields` is validated at create/update time so that direct GraphQL
# calls can't bypass the frontend form validation. `field_validators` is a map
# from field name to a callable that returns True iff the value is acceptable.

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_uuid(value):
    return isinstance(value, str) and bool(UUID_RE.match(value))


def _is_https_url(value):
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme == "https" and bool(parsed.netloc)


def _is_non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


ORG_SSO_PROVIDER_REGISTRY = {
    "entra_id": {
        "label": "Microsoft Entra ID",
        "issuer_template": "https://login.microsoftonline.com/{tenant_id}/v2.0",
        "issuer_field": None,
        "callback_slug": "entra-id-oidc",
        "adapter_module": "ee.authentication.sso.oidc.entraid.views",
        "adapter_class": "CustomMicrosoftGraphOAuth2Adapter",
        "provider_id": "microsoft",
        "token_auth_method": "client_secret_post",
        "scopes": "openid profile email User.Read",
        "required_fields": ("tenant_id", "client_id", "client_secret"),
        "field_validators": {
            "tenant_id": _is_uuid,
            "client_id": _is_uuid,
            "client_secret": _is_non_empty_string,
        },
        # Allowlist of config keys safe to return via publicConfig. Any
        # field not listed here is treated as a secret — if a new secret
        # field is added to required_fields later, it stays hidden until
        # this set is updated intentionally.
        "public_fields": ("tenant_id", "client_id"),
    },
    "okta": {
        "label": "Okta",
        "issuer_template": None,
        "issuer_field": "issuer",
        "callback_slug": "okta-oidc",
        "adapter_module": "ee.authentication.sso.oidc.okta.views",
        "adapter_class": "OktaOpenIDConnectAdapter",
        "provider_id": "okta-oidc",
        "token_auth_method": "client_secret_basic",
        "scopes": "openid profile email",
        "required_fields": ("issuer", "client_id", "client_secret"),
        "field_validators": {
            "issuer": _is_https_url,
            "client_id": _is_non_empty_string,
            "client_secret": _is_non_empty_string,
        },
        "public_fields": ("issuer", "client_id"),
    },
}


def get_public_config_fields(provider_type):
    """Allowlist of config keys exposed via publicConfig for a provider."""
    meta = get_org_provider_meta(provider_type)
    if not meta:
        return ()
    return meta.get("public_fields", ())


# Django model choices derived from the registry
ORG_SSO_PROVIDER_CHOICES = [
    (key, meta["label"]) for key, meta in ORG_SSO_PROVIDER_REGISTRY.items()
]


def get_org_provider_meta(provider_type):
    """Look up provider metadata from the registry. Returns None if unknown."""
    return ORG_SSO_PROVIDER_REGISTRY.get(provider_type)


def resolve_issuer(provider_type, config):
    """Build the OIDC issuer URL from provider metadata + config."""
    meta = get_org_provider_meta(provider_type)
    if not meta:
        return None
    if meta["issuer_template"]:
        return meta["issuer_template"].format(**config)
    if meta["issuer_field"]:
        return config.get(meta["issuer_field"])
    return None


SEALED_SECRET_PREFIX = "ph:v1:"


def is_sealed_secret(value):
    """True if the value looks like a server-sealed secret.

    Client-side code encrypts client_secret with encryptAsymmetric before
    sending; the resulting string has the form ph:v1:<pubkey>:<ciphertext>
    (4 colon-separated segments). A plaintext secret would miss this prefix
    and the first SSO auth request would fail at decrypt. Reject at write
    time so the failure is surfaced to the admin instead of to every user
    trying to log in.
    """
    if not isinstance(value, str):
        return False
    if not value.startswith(SEALED_SECRET_PREFIX):
        return False
    return len(value.split(":")) == 4


def validate_provider_config(provider_type, config, require_secret=True):
    """Validate a provider config dict against the registry. Raises ValueError.

    - Every required_fields entry must be present and pass its validator.
    - client_secret must be a sealed ciphertext (ph:v1:...).
    - require_secret=False skips the secret check (used on update, where
      blank means "keep existing" — the caller filters it out upstream).
    """
    meta = get_org_provider_meta(provider_type)
    if not meta:
        raise ValueError(f"Unsupported provider type: {provider_type}")
    if not isinstance(config, dict):
        raise ValueError("config must be an object")

    required = meta.get("required_fields", ())
    validators = meta.get("field_validators", {})

    for field in required:
        if field == "client_secret" and not require_secret:
            continue
        value = config.get(field)
        if value is None or value == "":
            raise ValueError(f"Missing required field: {field}")
        validator = validators.get(field)
        if validator and not validator(value):
            raise ValueError(f"Invalid value for field: {field}")

    secret = config.get("client_secret")
    if secret and not is_sealed_secret(secret):
        raise ValueError(
            "client_secret must be encrypted client-side before submission"
        )


def get_org_sso_config(config_id):
    """Load an org SSO config from DB and decrypt client_secret.

    Returns (provider_instance, decrypted_config_dict).
    """
    from api.models import OrganisationSSOProvider
    from api.utils.crypto import get_server_keypair, decrypt_asymmetric

    provider = OrganisationSSOProvider.objects.get(id=config_id, enabled=True)
    pk, sk = get_server_keypair()

    config = provider.config.copy()
    config["client_secret"] = decrypt_asymmetric(
        config["client_secret"], sk.hex(), pk.hex()
    )
    return provider, config
