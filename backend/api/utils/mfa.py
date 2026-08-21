import hmac
import secrets
import time

import pyotp
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.utils import timezone

from api.models import UserRecoveryCode, UserTOTP
from api.utils.crypto import (
    decrypt_asymmetric,
    encrypt_asymmetric,
    get_server_keypair,
)

# SHA1/6/30 defaults for maximum authenticator-app compatibility
TOTP_ISSUER = "Phase Console"
# Non-standard otpauth `image` param — honored by some authenticator apps
# (FreeOTP and others); apps with curated brand catalogs (e.g. Authy)
# ignore it and match on issuer instead.
TOTP_IMAGE_URL = "https://phase.dev/assets/brand/phase-avatar.png"
TOTP_STEP = 30
TOTP_DIGITS = 6
TOTP_WINDOW = 1  # ±1 step of clock-skew tolerance

RECOVERY_CODE_COUNT = 10
# 32-char alphabet, 10 chars → 50 bits of entropy per code
_RECOVERY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"

# Signed-cookie sessions are replayable, so brute-force counters must live
# server-side (Redis-backed cache).
MFA_FAIL_LIMIT = 10
MFA_FAIL_TTL = 900


def user_has_active_totp(user):
    return UserTOTP.objects.filter(user=user, activated_at__isnull=False).exists()


def generate_totp_secret():
    return pyotp.random_base32(length=32)  # 160 bits


def encrypt_seed(seed):
    pk, _ = get_server_keypair()
    return encrypt_asymmetric(seed, pk.hex())


def decrypt_seed(encrypted_seed):
    pk, sk = get_server_keypair()
    return decrypt_asymmetric(encrypted_seed, sk.hex(), pk.hex())


def build_otpauth_uri(secret, email):
    totp = pyotp.TOTP(secret, digits=TOTP_DIGITS, interval=TOTP_STEP)
    return totp.provisioning_uri(
        name=email, issuer_name=TOTP_ISSUER, image=TOTP_IMAGE_URL
    )


def verify_totp_code(user_totp, code):
    """Return the matched timestep, or None when the code is wrong or
    replayed. Acceptance is a race-free conditional update on the stored
    replay floor, so the same code can never verify twice."""
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != TOTP_DIGITS:
        return None

    seed = decrypt_seed(user_totp.encrypted_seed)
    totp = pyotp.TOTP(seed, digits=TOTP_DIGITS, interval=TOTP_STEP)
    current_step = int(time.time()) // TOTP_STEP

    candidate_steps = [
        current_step + offset for offset in (-TOTP_WINDOW, 0, TOTP_WINDOW)
    ]
    # A fast device clock verifies at +TOTP_WINDOW and pushes the replay
    # floor past the window above; its NEXT code is floor+1, which would
    # be rejected until the server clock catches up. Chase the floor by
    # one step — acceptance still requires advancing the floor, so no
    # code can ever verify twice.
    floor = user_totp.last_verified_timestep or 0
    if floor >= current_step + TOTP_WINDOW:
        candidate_steps.append(floor + 1)

    matched = None
    for step in candidate_steps:
        if hmac.compare_digest(totp.at(step * TOTP_STEP), code):
            matched = step
            break
    if matched is None:
        return None

    updated = UserTOTP.objects.filter(
        pk=user_totp.pk, last_verified_timestep__lt=matched
    ).update(last_verified_timestep=matched)
    if updated == 0:
        return None  # replay
    return matched


def generate_recovery_codes(user):
    """Delete-all + recreate: regenerating invalidates every previous code."""
    UserRecoveryCode.objects.filter(user=user).delete()
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
        code = f"{raw[:5]}-{raw[5:]}"
        codes.append(code)
        UserRecoveryCode.objects.create(user=user, code_hash=make_password(code))
    return codes


def consume_recovery_code(user, code):
    """Single-use consumption. Worst case iterates ≤10 Argon2 checks —
    acceptable on the recovery path only."""
    code = (code or "").strip().lower()
    if not code:
        return False
    for row in UserRecoveryCode.objects.filter(user=user, used_at__isnull=True):
        if check_password(code, row.code_hash):
            updated = UserRecoveryCode.objects.filter(
                pk=row.pk, used_at__isnull=True
            ).update(used_at=timezone.now())
            return updated == 1
    return False


def _fail_key(user_id):
    return f"mfa_fail:{user_id}"


def record_mfa_failure(user_id):
    key = _fail_key(user_id)
    try:
        if not cache.add(key, 1, timeout=MFA_FAIL_TTL):
            cache.incr(key)
    except Exception:
        pass


def clear_mfa_failures(user_id):
    cache.delete(_fail_key(user_id))


def mfa_locked_out(user_id):
    return (cache.get(_fail_key(user_id)) or 0) >= MFA_FAIL_LIMIT
