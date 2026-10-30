"""WebAuthn (passkey) second factor: ceremony options, single-use challenges
and response verification. py_webauthn does the attestation/assertion
cryptography; this module binds it to Phase users, config and the cache."""

import json
import logging
import os
from urllib.parse import urlparse

from django.core.cache import cache
from django.utils import timezone
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import (
    base64url_to_bytes,
    bytes_to_base64url,
    decode_credential_public_key,
    encode_cbor,
    options_to_json_dict,
    parse_cbor,
    parse_client_data_json,
)
from webauthn.helpers.exceptions import InvalidAuthenticationResponse
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    CredentialDeviceType,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from api.models import UserPasskey
from api.utils.passkey_authenticators import AUTHENTICATOR_NAMES

logger = logging.getLogger(__name__)

RP_NAME = "Phase Console"
# Long enough to find and tap a security key.
CEREMONY_TIMEOUT_MS = 120_000
CHALLENGE_TTL = 300

MAX_PASSKEYS_PER_USER = 20
PASSKEY_NAME_MAX_LENGTH = 64
# Registration responses with "none" attestation are a few KB at most.
MAX_CREDENTIAL_JSON_LENGTH = 64 * 1024
# WebAuthn: credential IDs are at most 1023 bytes.
MAX_CREDENTIAL_ID_BYTES = 1023

# Challenges are namespaced by purpose, so one issued for a management proof
# can't finish a sign-in (and adding a passkey can hold one of each).
PURPOSE_REGISTER = "register"
PURPOSE_MANAGE = "manage"
PURPOSE_LOGIN = "login"

_KNOWN_TRANSPORTS = {t.value for t in AuthenticatorTransport}
_SECURITY_KEY_TRANSPORTS = {"usb", "nfc", "ble", "smart-card"}

# What a passkey is, for the UI: a multi-device passkey in a password
# manager or platform keychain, a hardware security key, or a passkey bound
# to one computer or phone (e.g. Windows Hello).
KIND_SYNCED = "synced"
KIND_SECURITY_KEY = "security_key"
KIND_DEVICE = "device"
_KIND_LABELS = {
    KIND_SYNCED: "Passkey",
    KIND_SECURITY_KEY: "Hardware security key",
    KIND_DEVICE: "Device passkey",
}

_COSE_ALGORITHMS = {
    -7: "ES256",
    -35: "ES384",
    -36: "ES512",
    -8: "EdDSA",
    -257: "RS256",
    -258: "RS384",
    -259: "RS512",
    -37: "PS256",
    -38: "PS384",
    -39: "PS512",
    -48: "ML-DSA-44",
    -49: "ML-DSA-65",
    -50: "ML-DSA-87",
}
_COSE_CURVES = {1: "P-256", 2: "P-384", 3: "P-521", 6: "Ed25519"}


def passkey_kind(backup_eligible, transports):
    if backup_eligible:
        return KIND_SYNCED
    transports = set(transports or [])
    if transports & _SECURITY_KEY_TRANSPORTS:
        return KIND_SECURITY_KEY
    if "internal" in transports:
        return KIND_DEVICE
    return KIND_SECURITY_KEY


def authenticator_name(aaguid):
    """The provider or key model, when its AAGUID is known (browsers and
    providers may send zeros)."""
    return AUTHENTICATOR_NAMES.get((aaguid or "").lower())


def suggested_name(user, aaguid, kind):
    """A default name for a new passkey: the provider or key model, else
    what it is, numbered when the user already has one by that name."""
    base = (authenticator_name(aaguid) or _KIND_LABELS[kind])[
        : PASSKEY_NAME_MAX_LENGTH - 4
    ]
    taken = set(UserPasskey.objects.filter(user=user).values_list("name", flat=True))
    name, n = base, 2
    while name in taken:
        name, n = f"{base} {n}", n + 1
    return name


def public_key_jwk(public_key):
    """The stored COSE public key as JWK fields, for display."""
    try:
        key = decode_credential_public_key(bytes(public_key))
    except Exception:
        return None
    jwk = {"alg": _COSE_ALGORITHMS.get(int(key.alg), str(int(key.alg)))}
    if hasattr(key, "n"):
        jwk.update(kty="RSA", n=bytes_to_base64url(key.n), e=bytes_to_base64url(key.e))
    elif hasattr(key, "y"):
        jwk.update(
            kty="EC",
            crv=_COSE_CURVES.get(int(key.crv), str(int(key.crv))),
            x=bytes_to_base64url(key.x),
            y=bytes_to_base64url(key.y),
        )
    elif hasattr(key, "x"):
        jwk.update(
            kty="OKP",
            crv=_COSE_CURVES.get(int(key.crv), str(int(key.crv))),
            x=bytes_to_base64url(key.x),
        )
    return jwk


class PasskeyError(Exception):
    """A ceremony failed. The message is safe to show; `code` says why, for
    clients and logs."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


# Shown to the user, so: what happened and what to do, nothing internal.
_MESSAGES = {
    "invalid_response": "The browser sent an invalid passkey response. Please try again.",
    "wrong_origin": "Passkeys aren't set up for this address. Open Phase Console at "
    "its usual address, or ask your administrator to check its allowed origins.",
    "registration_expired": "Passkey setup expired. Please try again.",
    "registration_failed": "Couldn't verify the passkey. Please try again, or use a "
    "different passkey or hardware security key.",
    "expired": "This passkey request has expired. Please try again.",
    "unknown_credential": "This passkey isn't registered to your account. Try "
    "another passkey or hardware security key.",
    "counter": "This hardware security key's signature counter went backwards, which can "
    "mean it was copied, so it wasn't accepted. Use another method, then remove "
    "and re-add the key.",
    "concurrent_use": "This passkey was just used for another request. Please try again.",
    "verification_failed": "This passkey couldn't be verified. Please try again, "
    "or use another method.",
}


def passkey_error_details(error):
    """(code, message) for a PasskeyError, taken from the fixed table, so a
    response never carries the exception's own text."""
    for code, message in _MESSAGES.items():
        if error.code == code:
            return code, message
    return "verification_failed", _MESSAGES["verification_failed"]


def _failure(user, ceremony, code, reason):
    """Log why a ceremony failed and return the error to raise."""
    logger.info(
        json.dumps(
            {
                "event": f"passkey_{ceremony}_failed",
                "user_id": str(user.userId),
                "code": code,
                # Partly client-supplied: keep log lines bounded.
                "reason": str(reason)[:200],
            }
        )
    )
    return PasskeyError(_MESSAGES[code], code)


def _verification_failure(user, ceremony, exc, code):
    """A py_webauthn rejection, mapped to what the user can act on."""
    reason = str(exc)
    if reason.startswith(("Unexpected client data origin", "Unexpected RP ID hash")):
        code = "wrong_origin"
    return _failure(user, ceremony, code, reason)


def _parse_origin(value):
    """An ALLOWED_ORIGINS entry as (origin, host) the way a browser writes an
    origin: lowercase, no path or trailing dot, no default port, https when
    the scheme is missing. None when it has no usable host."""
    value = value.strip().rstrip("/")
    if "://" not in value:
        value = f"https://{value}"
    parsed = urlparse(value)
    host = (parsed.hostname or "").rstrip(".")
    if not host:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    scheme = parsed.scheme.lower()
    if port == {"https": 443, "http": 80}.get(scheme):
        port = None
    return f"{scheme}://{host}" + (f":{port}" if port else ""), host


def _allowed_origins():
    parsed = (_parse_origin(o) for o in os.getenv("ALLOWED_ORIGINS", "").split(","))
    return [p for p in parsed if p]


def get_rp_id():
    """The domain passkeys are bound to: the Console's own host, from the
    first ALLOWED_ORIGINS entry (the canonical Console URL, as for email
    links). One domain on purpose; passkeys stop working if the Console
    moves to another one, so there's no separate setting to drift."""
    origins = _allowed_origins()
    return origins[0][1] if origins else "localhost"


def get_expected_origins():
    """The allowed origins passkey responses may come from: those on the
    RP ID's host (or below it)."""
    rp_id = get_rp_id()
    return list(
        dict.fromkeys(
            origin
            for origin, host in _allowed_origins()
            if host == rp_id or host.endswith("." + rp_id)
        )
    )


def user_handle(user):
    """The WebAuthn user.id: stable per user (platform authenticators key
    passkeys by RP + user.id) and free of PII."""
    return str(user.userId).encode()


def _challenge_key(purpose, user, challenge):
    return (
        f"webauthn_challenge:{purpose}:{user.userId}:{bytes_to_base64url(challenge)}"
    )


def _store_challenge(purpose, user, challenge):
    # Server-side (the signed-cookie session is replayable), and one key per
    # challenge: several can be outstanding at once (two tabs, a form that
    # re-rendered), each used at most once.
    cache.set(_challenge_key(purpose, user, challenge), 1, timeout=CHALLENGE_TTL)


def _challenge_outstanding(purpose, user, challenge):
    return cache.get(_challenge_key(purpose, user, challenge)) is not None


def _claim_challenge(purpose, user, challenge):
    """Use a challenge up. Single use: of two concurrent requests for one
    challenge, only the one whose delete succeeds gets it."""
    return bool(cache.delete(_challenge_key(purpose, user, challenge)))


def claim_registration_challenge(user, challenge):
    """Use up the challenge a registration was verified against. False when
    it's gone: expired, or claimed by a concurrent request."""
    return _claim_challenge(PURPOSE_REGISTER, user, challenge)


def _signed_challenge(credential):
    """The challenge the browser signed, read from clientDataJSON. Only a
    lookup key: it must still match one we issued to this user, for this
    purpose, and verification checks the signature over it."""
    response = credential.get("response")
    client_data = response.get("clientDataJSON") if isinstance(response, dict) else None
    if not isinstance(client_data, str):
        return None
    try:
        return parse_client_data_json(base64url_to_bytes(client_data)).challenge
    except Exception:
        # Malformed in any way (including JSON deep enough to recurse out).
        return None


def _load_credential(credential_json):
    """The response as a dict, or None. Only a JSON string within the size
    cap: an object (from a REST body) would skip the cap, and malformed or
    deeply nested JSON must read as unparseable, never raise."""
    if (
        not isinstance(credential_json, str)
        or len(credential_json) > MAX_CREDENTIAL_JSON_LENGTH
    ):
        return None
    try:
        credential = json.loads(credential_json)
    except (ValueError, RecursionError):
        return None
    return credential if isinstance(credential, dict) else None


def _descriptor(passkey):
    transports = [
        AuthenticatorTransport(t)
        for t in passkey.transports or []
        if t in _KNOWN_TRANSPORTS
    ]
    return PublicKeyCredentialDescriptor(
        id=base64url_to_bytes(passkey.credential_id),
        transports=transports or None,
    )


def registration_options(user):
    """Creation options for a new passkey (JSON-ready dict). Stores the
    challenge for verify_registration."""
    existing = UserPasskey.objects.filter(user=user)
    options = generate_registration_options(
        rp_id=get_rp_id(),
        rp_name=RP_NAME,
        user_id=user_handle(user),
        user_name=user.email,
        user_display_name=getattr(user, "full_name", "") or user.email,
        timeout=CEREMONY_TIMEOUT_MS,
        # Only so browsers pass the authenticator model (AAGUID) through for
        # labels and icons: with "none", Chrome blanks a security key's. The
        # statement itself is never relied on (see _as_none_attestation).
        attestation=AttestationConveyancePreference.DIRECT,
        # A second factor: primary sign-in already identified the user, so
        # neither a discoverable credential nor user verification is needed
        # and a security key is a single tap.
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.DISCOURAGED,
            user_verification=UserVerificationRequirement.DISCOURAGED,
        ),
        exclude_credentials=[_descriptor(p) for p in existing],
    )
    _store_challenge(PURPOSE_REGISTER, user, options.challenge)
    data = options_to_json_dict(options)
    # Request PRF at creation: security keys only support it (hmac-secret)
    # on credentials created with it, and it is what wrapping keys with a
    # passkey needs later. credProps reports whether it is discoverable.
    data["extensions"] = {"credProps": True, "prf": {}}
    return data


def _as_none_attestation(credential):
    """The registration response with its attestation statement swapped for
    "none", so it verifies exactly as when no attestation was requested. The
    statement isn't checked against vendor roots, so verifying it would only
    add ways for a valid key to be refused; the authenticator data (AAGUID,
    flags, public key) is kept as is."""
    response = credential.get("response")
    if not isinstance(response, dict) or not isinstance(
        response.get("attestationObject"), str
    ):
        return credential
    try:
        attestation = parse_cbor(base64url_to_bytes(response["attestationObject"]))
    except Exception:
        # Malformed: verification reports it.
        return credential
    if not isinstance(attestation, dict) or attestation.get("fmt") == "none":
        return credential
    stripped = {"fmt": "none", "attStmt": {}, "authData": attestation.get("authData")}
    try:
        encoded = encode_cbor(stripped)
    except Exception:
        # Malformed authenticator data: verification reports it.
        return credential
    return {
        **credential,
        "response": {**response, "attestationObject": bytes_to_base64url(encoded)},
    }


def verify_registration(user, credential_json):
    """Verify a registration response against the user's outstanding
    challenge, without using the challenge up. Returns (fields for a new
    UserPasskey, the challenge); pass the challenge to
    claim_registration_challenge before storing, so a check in between (a
    rejected proof of another factor) leaves it for a retry. Raises
    PasskeyError."""
    credential = _load_credential(credential_json)
    challenge = _signed_challenge(credential) if credential else None
    if challenge is None:
        raise _failure(user, "registration", "invalid_response", "unparseable")
    if not _challenge_outstanding(PURPOSE_REGISTER, user, challenge):
        raise _failure(
            user, "registration", "registration_expired", "challenge not outstanding"
        )
    try:
        verified = verify_registration_response(
            credential=_as_none_attestation(credential),
            expected_challenge=challenge,
            expected_rp_id=get_rp_id(),
            expected_origin=get_expected_origins(),
            require_user_verification=False,
        )
    except Exception as e:
        # Fail closed on anything malformed, not only py_webauthn's errors.
        raise _verification_failure(user, "registration", e, "registration_failed")
    # The spec's maximum; longer IDs would also overflow the unique index.
    if len(verified.credential_id) > MAX_CREDENTIAL_ID_BYTES:
        raise _failure(user, "registration", "registration_failed", "credential ID too long")

    response = credential.get("response")
    transports = response.get("transports") if isinstance(response, dict) else None
    if not isinstance(transports, list):
        transports = []
    extensions = credential.get("clientExtensionResults")
    prf = extensions.get("prf") if isinstance(extensions, dict) else None
    fields = {
        "credential_id": bytes_to_base64url(verified.credential_id),
        "public_key": verified.credential_public_key,
        "sign_count": verified.sign_count,
        "aaguid": verified.aaguid,
        # Known values only, once each, in the client's order.
        "transports": list(
            dict.fromkeys(
                t for t in transports if isinstance(t, str) and t in _KNOWN_TRANSPORTS
            )
        ),
        "backup_eligible": verified.credential_device_type
        == CredentialDeviceType.MULTI_DEVICE,
        "backed_up": verified.credential_backed_up,
        "prf_enabled": isinstance(prf, dict) and prf.get("enabled") is True,
    }
    return fields, challenge


def authentication_options(user, purpose):
    """Request options over the user's passkeys (JSON-ready dict), or None
    when they have none. Stores the challenge for verify_assertion."""
    passkeys = list(UserPasskey.objects.filter(user=user))
    if not passkeys:
        return None
    options = generate_authentication_options(
        rp_id=get_rp_id(),
        timeout=CEREMONY_TIMEOUT_MS,
        allow_credentials=[_descriptor(p) for p in passkeys],
        user_verification=UserVerificationRequirement.DISCOURAGED,
    )
    _store_challenge(purpose, user, options.challenge)
    return options_to_json_dict(options)


def verify_assertion(user, purpose, credential_json):
    """Return the user's UserPasskey that signed the outstanding challenge;
    raises PasskeyError otherwise. The challenge is consumed either way:
    one attempt each."""
    credential = _load_credential(credential_json)
    challenge = _signed_challenge(credential) if credential else None
    if challenge is None:
        raise _failure(user, "assertion", "invalid_response", "unparseable")
    if not _claim_challenge(purpose, user, challenge):
        raise _failure(user, "assertion", "expired", "challenge not outstanding")
    raw_id = credential.get("rawId")
    try:
        if not isinstance(raw_id, str):
            raise ValueError("missing rawId")
        credential_id = bytes_to_base64url(base64url_to_bytes(raw_id))
    except ValueError:
        raise _failure(user, "assertion", "invalid_response", "unparseable")

    passkey = UserPasskey.objects.filter(user=user, credential_id=credential_id).first()
    if passkey is None:
        raise _failure(
            user, "assertion", "unknown_credential", "not registered to the user"
        )

    # Counters only mean something for device-bound keys: synced passkeys
    # report 0, or per-device values that can go backwards. Enforcing them
    # there would lock people out; the single-use challenge still stops
    # replays.
    enforce_counter = not passkey.backup_eligible
    try:
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=get_rp_id(),
            expected_origin=get_expected_origins(),
            credential_public_key=bytes(passkey.public_key),
            credential_current_sign_count=passkey.sign_count if enforce_counter else 0,
            require_user_verification=False,
        )
    except InvalidAuthenticationResponse as e:
        if str(e).startswith("Response sign count"):
            raise _failure(user, "assertion", "counter", str(e))
        raise _verification_failure(user, "assertion", e, "verification_failed")
    except Exception as e:
        # Fail closed on anything malformed, not only py_webauthn's errors.
        raise _verification_failure(user, "assertion", e, "verification_failed")

    # A conditional update, so two assertions that both passed the counter
    # check against the same stored value can't both succeed.
    rows = UserPasskey.objects.filter(pk=passkey.pk)
    if enforce_counter and verified.new_sign_count > 0:
        rows = rows.filter(sign_count__lt=verified.new_sign_count)
    updated = rows.update(
        sign_count=verified.new_sign_count,
        backed_up=verified.credential_backed_up,
        last_used_at=timezone.now(),
    )
    if updated != 1:
        raise _failure(
            user, "assertion", "concurrent_use", "counter advanced concurrently"
        )
    return passkey
