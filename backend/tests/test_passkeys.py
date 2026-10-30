"""Tests for passkeys (WebAuthn) as a second factor: RP config, the
registration/assertion ceremonies, the recovery codes passkeys share with
TOTP, the GraphQL management mutations, and the pre-login options/verify
endpoints.

DB-free like test_mfa.py: an in-memory stand-in replaces the three MFA
models, and a software authenticator produces real WebAuthn responses, so
py_webauthn's verification runs for real.
"""

import hashlib
import json
import os
import time
import unittest
import uuid
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pyotp
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from django.contrib.sessions.middleware import SessionMiddleware
from django.core.cache import cache
from django.db import IntegrityError
from django.test import RequestFactory, override_settings
from django.utils import timezone
from graphql import GraphQLError
from rest_framework.test import APIRequestFactory
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, encode_cbor, parse_cbor

ORIGIN = "https://console.example.com"
RP_ID = "console.example.com"
SEED = pyotp.random_base32(length=32)


def _b64(data):
    return bytes_to_base64url(data)


def _with_att_stmt(credential_json):
    """A "none" attestation that carries a statement: invalid."""
    credential = json.loads(credential_json)
    response = credential["response"]
    attestation = parse_cbor(base64url_to_bytes(response["attestationObject"]))
    attestation["attStmt"] = {"sig": b"forged"}
    response["attestationObject"] = _b64(encode_cbor(attestation))
    return json.dumps(credential)


def _with_unverifiable_statement(credential_json):
    """A "packed" attestation whose statement can't verify (forged signature,
    no certificate), as a quirky or unknown authenticator might send."""
    credential = json.loads(credential_json)
    response = credential["response"]
    attestation = parse_cbor(base64url_to_bytes(response["attestationObject"]))
    attestation["fmt"] = "packed"
    attestation["attStmt"] = {"alg": -7, "sig": b"forged"}
    response["attestationObject"] = _b64(encode_cbor(attestation))
    return json.dumps(credential)


def _add_session_to_request(request):
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


def _make_user(user_id="uuid-user-1", email="alice@example.com"):
    user = MagicMock()
    user.userId = user_id
    user.pk = user_id
    user.email = email
    user.full_name = "Alice Test"
    user.is_authenticated = True
    user.socialaccount_set.first.return_value = None
    return user


# ---------------------------------------------------------------------------
# In-memory stand-ins for UserTOTP / UserRecoveryCode / UserPasskey
# ---------------------------------------------------------------------------


def _key(value):
    return getattr(value, "pk", value)


def _matches(row, lookups):
    for lookup, expected in lookups.items():
        field, _, op = lookup.partition("__")
        actual = getattr(row, field)
        if op == "isnull":
            ok = (actual is None) == expected
        elif op == "lt":
            ok = actual < expected
        elif not op:
            ok = _key(actual) == _key(expected)
        else:
            raise NotImplementedError(lookup)
        if not ok:
            return False
    return True


class _FakeQuerySet:
    def __init__(self, model, rows):
        self.model = model
        self.rows = rows

    def filter(self, **lookups):
        return _FakeQuerySet(self.model, [r for r in self.rows if _matches(r, lookups)])

    def order_by(self, *fields):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def values_list(self, field, flat=False):
        return [getattr(r, field) for r in self.rows]

    def exists(self):
        return bool(self.rows)

    def count(self):
        return len(self.rows)

    def update(self, **values):
        for row in self.rows:
            for field, value in values.items():
                setattr(row, field, value)
        return len(self.rows)

    def delete(self):
        for row in self.rows:
            self.model.rows.remove(row)
        return len(self.rows), {}

    def __iter__(self):
        return iter(list(self.rows))


class _Row(SimpleNamespace):
    def save(self, update_fields=None):
        pass  # rows are live objects in the store


class FakeModel:
    """Just enough of a model manager for the MFA code paths."""

    def __init__(self, defaults, unique=()):
        self.defaults = defaults
        self.unique = unique
        self.rows = []
        self.objects = self

    def create(self, **fields):
        values = {k: v() if callable(v) else v for k, v in self.defaults.items()}
        row = _Row(**{**values, **fields})
        row.pk = row.id
        for field in self.unique:
            if any(getattr(r, field) == getattr(row, field) for r in self.rows):
                raise IntegrityError(field)
        self.rows.append(row)
        return row

    def filter(self, **lookups):
        return _FakeQuerySet(self, self.rows).filter(**lookups)

    def count(self):
        return len(self.rows)

    def update_or_create(self, defaults=None, **lookups):
        existing = self.filter(**lookups).first()
        if existing is not None:
            for field, value in (defaults or {}).items():
                setattr(existing, field, value)
            return existing, False
        return self.create(**lookups, **(defaults or {})), True


def _new_models():
    new_id = lambda: str(uuid.uuid4())  # noqa: E731
    return SimpleNamespace(
        totp=FakeModel(
            {"id": new_id, "activated_at": None, "last_verified_timestep": 0}
        ),
        recovery=FakeModel({"id": new_id, "used_at": None}),
        passkey=FakeModel(
            {
                "id": new_id,
                "sign_count": 0,
                "transports": list,
                "aaguid": "",
                "backup_eligible": False,
                "backed_up": False,
                "prf_enabled": False,
                "created_at": timezone.now,
                "last_used_at": None,
            },
            unique=("credential_id",),
        ),
    )


# ---------------------------------------------------------------------------
# Software authenticator
# ---------------------------------------------------------------------------


class SoftAuthenticator:
    """A FIDO2 authenticator in software: ES256 key, "none" attestation.
    Device-bound keys count signatures; synced passkeys report 0 and set
    the backup flags."""

    def __init__(self, synced=False, aaguid=bytes(16)):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(32)
        self.synced = synced
        self.aaguid = aaguid
        self.sign_count = 0

    @property
    def id(self):
        return _b64(self.credential_id)

    def _cose_key(self):
        numbers = self.key.public_key().public_numbers()
        return encode_cbor(
            {
                1: 2,  # kty: EC2
                3: -7,  # alg: ES256
                -1: 1,  # crv: P-256
                -2: numbers.x.to_bytes(32, "big"),
                -3: numbers.y.to_bytes(32, "big"),
            }
        )

    def _auth_data(self, rp_id, attested):
        flags = 0x01  # UP
        if self.synced:
            flags |= 0x08 | 0x10  # BE + BS
        if attested:
            flags |= 0x40  # AT
        data = (
            hashlib.sha256(rp_id.encode()).digest()
            + bytes([flags])
            + self.sign_count.to_bytes(4, "big")
        )
        if attested:
            data += (
                self.aaguid
                + len(self.credential_id).to_bytes(2, "big")
                + self.credential_id
                + self._cose_key()
            )
        return data

    @staticmethod
    def _client_data(ceremony, options, origin):
        return json.dumps(
            {
                "type": ceremony,
                "challenge": options["challenge"],
                "origin": origin,
                "crossOrigin": False,
            }
        ).encode()

    def create(self, options, origin=ORIGIN, rp_id=RP_ID, prf=True):
        client_data = self._client_data("webauthn.create", options, origin)
        attestation = encode_cbor(
            {"fmt": "none", "attStmt": {}, "authData": self._auth_data(rp_id, True)}
        )
        return json.dumps(
            {
                "id": self.id,
                "rawId": self.id,
                "type": "public-key",
                "authenticatorAttachment": "cross-platform",
                "response": {
                    "clientDataJSON": _b64(client_data),
                    "attestationObject": _b64(attestation),
                    "transports": ["usb", "nfc", "carrier-pigeon"],
                },
                "clientExtensionResults": {
                    "credProps": {"rk": False},
                    "prf": {"enabled": prf},
                },
            }
        )

    def get(self, options, origin=ORIGIN, rp_id=RP_ID, signing_key=None):
        if not self.synced:
            self.sign_count += 1
        auth_data = self._auth_data(rp_id, False)
        client_data = self._client_data("webauthn.get", options, origin)
        signature = (signing_key or self.key).sign(
            auth_data + hashlib.sha256(client_data).digest(),
            ec.ECDSA(hashes.SHA256()),
        )
        return json.dumps(
            {
                "id": self.id,
                "rawId": self.id,
                "type": "public-key",
                "authenticatorAttachment": "cross-platform",
                "response": {
                    "clientDataJSON": _b64(client_data),
                    "authenticatorData": _b64(auth_data),
                    "signature": _b64(signature),
                },
                "clientExtensionResults": {},
            }
        )


# ---------------------------------------------------------------------------
# Base: models swapped for fakes, RP config pinned, no DB or email
# ---------------------------------------------------------------------------


class PasskeyTestCase(unittest.TestCase):
    def setUp(self):
        cache.clear()
        self.models = _new_models()
        self.emails = SimpleNamespace()
        stack = ExitStack()
        self.addCleanup(stack.close)

        # Recovery codes hash with Argon2 in production; keep tests fast.
        stack.enter_context(
            override_settings(
                PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"]
            )
        )
        env = {k: v for k, v in os.environ.items() if k != "WEBAUTHN_RP_ID"}
        env["ALLOWED_ORIGINS"] = ORIGIN
        stack.enter_context(patch.dict(os.environ, env, clear=True))

        targets = {
            "UserTOTP": self.models.totp,
            "UserRecoveryCode": self.models.recovery,
            "UserPasskey": self.models.passkey,
        }
        for module, names in {
            "api.utils.mfa": targets,
            "api.utils.passkeys": ["UserPasskey"],
            "backend.graphene.mutations.mfa": targets,
            "backend.graphene.queries.account": targets,
            "api.views.auth_mfa": ["UserTOTP"],
        }.items():
            for name in names:
                stack.enter_context(patch(f"{module}.{name}", targets[name]))

        for module in ("api.utils.mfa", "backend.graphene.mutations.mfa"):
            stack.enter_context(patch(f"{module}.transaction"))
        stack.enter_context(patch("backend.graphene.mutations.mfa.lock_mfa_factors"))
        stack.enter_context(patch("api.utils.mfa.decrypt_seed", return_value=SEED))

        for name in (
            "send_passkey_status_email",
            "send_totp_status_email",
            "send_recovery_codes_regenerated_email",
        ):
            setattr(self.emails, name, stack.enter_context(patch(f"api.emails.{name}")))
        self.login_email = stack.enter_context(
            patch("api.views.auth_mfa.send_login_email")
        )
        self.user = _make_user()

    # -- helpers ------------------------------------------------------------

    def info(self, user=None, fresh=True):
        request = RequestFactory().post("/graphql/")
        _add_session_to_request(request)
        if fresh:
            request.session["auth_time"] = int(time.time())
        request.user = user or self.user
        info = MagicMock()
        info.context = request
        return info

    def enable_totp(self, user=None):
        return self.models.totp.create(
            user=user or self.user,
            encrypted_seed="ph:v1:ct",
            activated_at=timezone.now(),
        )

    @staticmethod
    def totp_code():
        return pyotp.TOTP(SEED).now()

    def recovery_rows(self, user=None):
        return self.models.recovery.filter(user=user or self.user).rows

    def register(self, authenticator, name="YubiKey", user=None, **proof):
        """Run the full add-a-passkey ceremony through the mutations."""
        from backend.graphene.mutations.mfa import (
            BeginPasskeyRegistrationMutation,
            FinishPasskeyRegistrationMutation,
        )

        info = self.info(user)
        options = BeginPasskeyRegistrationMutation.mutate(None, info).options
        return FinishPasskeyRegistrationMutation.mutate(
            None, info, name=name, credential=authenticator.create(options), **proof
        )

    def manage_proof(self, authenticator, user=None):
        """An assertion over a fresh management challenge."""
        from backend.graphene.mutations.mfa import BeginPasskeyVerificationMutation

        options = BeginPasskeyVerificationMutation.mutate(None, self.info(user)).options
        return authenticator.get(options)


# ---------------------------------------------------------------------------
# Relying-party config
# ---------------------------------------------------------------------------


class RelyingPartyConfigTest(unittest.TestCase):
    def test_rp_id_is_the_first_allowed_origin_host(self):
        from api.utils.passkeys import get_expected_origins, get_rp_id

        with patch.dict(
            os.environ,
            {"ALLOWED_ORIGINS": "https://console.example.com/, https://x.test"},
        ):
            self.assertEqual(get_rp_id(), "console.example.com")
            self.assertEqual(get_expected_origins(), ["https://console.example.com"])

    def test_origins_are_read_the_way_browsers_send_them(self):
        """Case, default ports, trailing slashes and dots, and a missing
        scheme must not break passkeys; other hosts never count."""
        from api.utils.passkeys import get_expected_origins, get_rp_id

        origins = ",".join(
            [
                " Console.Example.com.:443/ ",
                "http://localhost:3000",
                "https://eu.console.example.com",
                "https://console.example.com.evil.test",
                "https://:8000",
            ]
        )
        with patch.dict(os.environ, {"ALLOWED_ORIGINS": origins}):
            self.assertEqual(get_rp_id(), "console.example.com")
            self.assertEqual(
                get_expected_origins(),
                ["https://console.example.com", "https://eu.console.example.com"],
            )

    def test_no_separate_setting_overrides_the_console_domain(self):
        from api.utils.passkeys import get_rp_id

        with patch.dict(
            os.environ,
            {"ALLOWED_ORIGINS": "https://console.example.com", "WEBAUTHN_RP_ID": "example.com"},
        ):
            self.assertEqual(get_rp_id(), "console.example.com")


# ---------------------------------------------------------------------------
# Ceremonies (api.utils.passkeys)
# ---------------------------------------------------------------------------


class RegistrationCeremonyTest(PasskeyTestCase):
    def test_options_shape(self):
        from api.utils.passkeys import registration_options

        existing = SoftAuthenticator()
        self.models.passkey.create(
            user=self.user,
            name="old",
            credential_id=existing.id,
            public_key=b"",
            transports=["usb", "bogus"],
        )
        options = registration_options(self.user)

        self.assertEqual(options["rp"]["id"], RP_ID)
        self.assertEqual(options["user"]["id"], _b64(b"uuid-user-1"))
        self.assertEqual(options["user"]["name"], "alice@example.com")
        # Asked for so browsers pass the model (AAGUID) through
        self.assertEqual(options["attestation"], "direct")
        self.assertEqual(options["authenticatorSelection"]["residentKey"], "discouraged")
        self.assertEqual(
            options["authenticatorSelection"]["userVerification"], "discouraged"
        )
        # The same authenticator can't be registered twice
        self.assertEqual(
            options["excludeCredentials"],
            [{"id": existing.id, "type": "public-key", "transports": ["usb"]}],
        )
        # PRF must be requested at creation for security keys to support it
        self.assertEqual(options["extensions"], {"credProps": True, "prf": {}})

    def test_attestation_statement_is_never_a_reason_to_refuse(self):
        """Attestation is requested only to learn the model: a statement that
        doesn't verify registers exactly as with no attestation, and the
        authenticator's AAGUID is kept for its label."""
        from api.utils.passkeys import registration_options, verify_registration

        yubikey = uuid.UUID("cb69481e-8ff7-4039-93ec-0a2729a154a8")
        authenticator = SoftAuthenticator(aaguid=yubikey.bytes)
        options = registration_options(self.user)
        fields, _ = verify_registration(
            self.user, _with_unverifiable_statement(authenticator.create(options))
        )
        self.assertEqual(fields["credential_id"], authenticator.id)
        self.assertEqual(fields["aaguid"], str(yubikey))

    def test_verified_registration_fields(self):
        from api.utils.passkeys import registration_options, verify_registration

        authenticator = SoftAuthenticator()
        options = registration_options(self.user)
        fields, _ = verify_registration(self.user, authenticator.create(options))

        self.assertEqual(fields["credential_id"], authenticator.id)
        self.assertEqual(fields["sign_count"], 0)
        self.assertEqual(fields["transports"], ["usb", "nfc"])
        self.assertTrue(fields["prf_enabled"])
        self.assertFalse(fields["backup_eligible"])
        self.assertTrue(fields["public_key"])

    def test_synced_passkey_flags_and_no_prf(self):
        from api.utils.passkeys import registration_options, verify_registration

        authenticator = SoftAuthenticator(synced=True)
        options = registration_options(self.user)
        fields, _ = verify_registration(self.user, authenticator.create(options, prf=False))
        self.assertTrue(fields["backup_eligible"])
        self.assertTrue(fields["backed_up"])
        self.assertFalse(fields["prf_enabled"])

    def test_challenge_is_claimed_once(self):
        """Verifying doesn't use the challenge up (a proof check may sit in
        between); claiming does, exactly once."""
        from api.utils.passkeys import (
            PasskeyError,
            claim_registration_challenge,
            registration_options,
            verify_registration,
        )

        authenticator = SoftAuthenticator()
        credential = authenticator.create(registration_options(self.user))
        _, challenge = verify_registration(self.user, credential)
        _, again = verify_registration(self.user, credential)
        self.assertEqual(challenge, again)

        self.assertTrue(claim_registration_challenge(self.user, challenge))
        self.assertFalse(claim_registration_challenge(self.user, challenge))
        with self.assertRaises(PasskeyError) as ctx:
            verify_registration(self.user, credential)
        self.assertEqual(ctx.exception.code, "registration_expired")
        self.assertIn("expired", str(ctx.exception))

    def test_outstanding_challenges_each_work_once(self):
        """Two tabs (or a re-rendered form) each get their own challenge;
        a newer one doesn't invalidate the older."""
        from api.utils.passkeys import (
            claim_registration_challenge,
            registration_options,
            verify_registration,
        )

        first = SoftAuthenticator().create(registration_options(self.user))
        second = SoftAuthenticator().create(registration_options(self.user))
        _, a = verify_registration(self.user, first)
        _, b = verify_registration(self.user, second)
        self.assertNotEqual(a, b)
        self.assertTrue(claim_registration_challenge(self.user, a))
        self.assertTrue(claim_registration_challenge(self.user, b))
        self.assertFalse(claim_registration_challenge(self.user, a))

    def test_wrong_origin_rp_id_or_challenge_rejected(self):
        from api.utils.passkeys import PasskeyError, registration_options, verify_registration

        authenticator = SoftAuthenticator()
        cases = [
            ("wrong_origin", lambda o: authenticator.create(o, origin="https://evil.test")),
            ("wrong_origin", lambda o: authenticator.create(o, rp_id="evil.test")),
            # Signed over a challenge we never issued
            (
                "registration_expired",
                lambda o: authenticator.create({"challenge": _b64(b"x" * 32)}),
            ),
            # An attestation that doesn't verify
            ("registration_failed", lambda o: _with_att_stmt(authenticator.create(o))),
        ]
        for code, make_credential in cases:
            options = registration_options(self.user)
            with self.assertLogs("api.utils.passkeys", level="INFO") as logs:
                with self.assertRaises(PasskeyError) as ctx:
                    verify_registration(self.user, make_credential(options))
            self.assertEqual(ctx.exception.code, code)
            self.assertIn("passkey_registration_failed", logs.output[-1])

    def test_challenge_is_bound_to_the_user(self):
        from api.utils.passkeys import PasskeyError, registration_options, verify_registration

        options = registration_options(self.user)
        credential = SoftAuthenticator().create(options)
        with self.assertRaises(PasskeyError):
            verify_registration(_make_user(user_id="uuid-user-2"), credential)

    def test_malformed_and_oversized_responses_rejected(self):
        from api.utils.passkeys import (
            MAX_CREDENTIAL_JSON_LENGTH,
            PasskeyError,
            registration_options,
            verify_registration,
        )

        for bad in ["not json", "[]", "x" * (MAX_CREDENTIAL_JSON_LENGTH + 1), None]:
            registration_options(self.user)
            with self.assertRaises(PasskeyError):
                verify_registration(self.user, bad)


class AssertionCeremonyTest(PasskeyTestCase):
    def _stored(self, authenticator, user=None):
        from api.utils.passkeys import registration_options, verify_registration

        user = user or self.user
        fields, _ = verify_registration(user, authenticator.create(registration_options(user)))
        return self.models.passkey.create(user=user, name="key", **fields)

    def _challenge(self, authenticator, purpose="login", **kwargs):
        from api.utils.passkeys import authentication_options

        return authenticator.get(authentication_options(self.user, purpose), **kwargs)

    def _verify(self, assertion, purpose="login"):
        from api.utils.passkeys import verify_assertion

        return verify_assertion(self.user, purpose, assertion)

    def assertRejected(self, assertion, code, purpose="login"):
        from api.utils.passkeys import PasskeyError

        with self.assertLogs("api.utils.passkeys", level="INFO") as logs:
            with self.assertRaises(PasskeyError) as ctx:
                self._verify(assertion, purpose)
        self.assertEqual(ctx.exception.code, code)
        self.assertIn('"event": "passkey_assertion_failed"', logs.output[-1])
        return ctx.exception

    def test_options_list_the_users_passkeys(self):
        from api.utils.passkeys import PURPOSE_LOGIN, authentication_options

        self.assertIsNone(authentication_options(self.user, PURPOSE_LOGIN))
        authenticator = SoftAuthenticator()
        self._stored(authenticator)
        options = authentication_options(self.user, PURPOSE_LOGIN)
        self.assertEqual(options["rpId"], RP_ID)
        self.assertEqual(options["userVerification"], "discouraged")
        self.assertEqual(
            [c["id"] for c in options["allowCredentials"]], [authenticator.id]
        )

    def test_valid_assertion_returns_passkey_and_advances_counter(self):
        authenticator = SoftAuthenticator()
        stored = self._stored(authenticator)
        self.assertIs(self._verify(self._challenge(authenticator)), stored)
        self.assertEqual(stored.sign_count, 1)
        self.assertIsNotNone(stored.last_used_at)

    def test_replayed_assertion_rejected(self):
        authenticator = SoftAuthenticator()
        self._stored(authenticator)
        assertion = self._challenge(authenticator)
        self._verify(assertion)
        self.assertRejected(assertion, "expired")
        # ...even once a new challenge is outstanding
        self._challenge(SoftAuthenticator())
        self.assertRejected(assertion, "expired")

    def test_concurrent_challenges_both_verify(self):
        """The race two tabs (or a double-mounted form) create: the browser
        signs the older of two outstanding challenges."""
        authenticator = SoftAuthenticator()
        stored = self._stored(authenticator)
        older = self._challenge(authenticator)
        newer = self._challenge(authenticator)
        self.assertIs(self._verify(older), stored)
        self.assertIs(self._verify(newer), stored)

    def test_replayed_synced_assertion_rejected(self):
        """Synced passkeys report no counter, so only the single-use
        challenge stops a replay."""
        authenticator = SoftAuthenticator(synced=True)
        self._stored(authenticator)
        assertion = self._challenge(authenticator)
        self._verify(assertion)
        self.assertRejected(assertion, "expired")

    def test_challenge_purposes_are_separate(self):
        authenticator = SoftAuthenticator()
        self._stored(authenticator)
        self.assertRejected(self._challenge(authenticator, purpose="manage"), "expired")

    def test_another_users_passkey_is_unknown_here(self):
        mallory = _make_user(user_id="uuid-mallory")
        authenticator = SoftAuthenticator()
        self._stored(authenticator, user=mallory)
        self._stored(SoftAuthenticator())  # Alice has a passkey of her own
        error = self.assertRejected(self._challenge(authenticator), "unknown_credential")
        self.assertIn("isn't registered to your account", str(error))

    def test_bad_signature_rejected(self):
        authenticator = SoftAuthenticator()
        self._stored(authenticator)
        forged = self._challenge(
            authenticator, signing_key=ec.generate_private_key(ec.SECP256R1())
        )
        self.assertRejected(forged, "verification_failed")

    def test_wrong_origin_explained(self):
        authenticator = SoftAuthenticator()
        self._stored(authenticator)
        phished = self._challenge(
            authenticator, origin="https://console.example.com.evil.test"
        )
        error = self.assertRejected(phished, "wrong_origin")
        self.assertIn("allowed origins", str(error))
        # Nothing internal in the message
        self.assertNotIn("evil.test", str(error))

    def test_malformed_responses_rejected(self):
        authenticator = SoftAuthenticator()
        self._stored(authenticator)
        for bad in ["{}", '{"rawId": 5}', "nope"]:
            self._challenge(authenticator)
            self.assertRejected(bad, "invalid_response")

    def test_counter_regression_on_device_bound_key_rejected(self):
        """A cloned security key replays an old counter value."""
        authenticator = SoftAuthenticator()
        self._stored(authenticator)
        self._verify(self._challenge(authenticator))
        authenticator.sign_count = 0
        error = self.assertRejected(self._challenge(authenticator), "counter")
        self.assertIn("remove and re-add", str(error))

    def test_synced_passkey_counters_are_not_enforced(self):
        """Per-device counters on a synced passkey (e.g. a shared password
        manager vault) can go backwards; that must not lock anyone out."""
        authenticator = SoftAuthenticator(synced=True)
        stored = self._stored(authenticator)
        for counter in (7, 3):
            authenticator.sign_count = counter
            self.assertIs(self._verify(self._challenge(authenticator)), stored)

    def test_concurrent_counter_update_loses(self):
        """Two assertions that both passed the counter check: only the first
        conditional update wins."""
        authenticator = SoftAuthenticator()
        stored = self._stored(authenticator)
        assertion = self._challenge(authenticator)

        def racing_verify(**kwargs):
            stored.sign_count = 1  # the other request already stored this value
            return SimpleNamespace(new_sign_count=1, credential_backed_up=False)

        with patch(
            "api.utils.passkeys.verify_authentication_response", side_effect=racing_verify
        ):
            self.assertRejected(assertion, "concurrent_use")

    def test_synced_passkeys_without_counters_keep_working(self):
        authenticator = SoftAuthenticator(synced=True)
        stored = self._stored(authenticator)
        for _ in range(2):
            self.assertIs(self._verify(self._challenge(authenticator)), stored)
        self.assertEqual(stored.sign_count, 0)


class PasskeyDescriptionTest(PasskeyTestCase):
    BITWARDEN = uuid.UUID("d548826e-79b4-db40-a3d8-11116f7e8349").bytes

    def test_kind(self):
        from api.utils.passkeys import passkey_kind

        self.assertEqual(passkey_kind(True, ["internal", "hybrid"]), "synced")
        self.assertEqual(passkey_kind(False, ["usb"]), "security_key")
        self.assertEqual(passkey_kind(False, ["nfc", "usb"]), "security_key")
        self.assertEqual(passkey_kind(False, ["internal"]), "device")
        self.assertEqual(passkey_kind(False, []), "security_key")

    def test_authenticator_names(self):
        from api.utils.passkeys import authenticator_name

        self.assertEqual(authenticator_name("D548826E-79B4-DB40-A3D8-11116F7E8349"), "Bitwarden")
        self.assertIsNone(authenticator_name("00000000-0000-0000-0000-000000000000"))
        self.assertIsNone(authenticator_name(None))

    def test_suggested_names_are_numbered(self):
        from api.utils.passkeys import suggested_name

        aaguid = str(uuid.UUID(bytes=self.BITWARDEN))
        self.assertEqual(suggested_name(self.user, aaguid, "synced"), "Bitwarden")
        self.models.passkey.create(user=self.user, name="Bitwarden", credential_id="a", public_key=b"")
        self.assertEqual(suggested_name(self.user, aaguid, "synced"), "Bitwarden 2")
        self.assertEqual(suggested_name(self.user, None, "security_key"), "Hardware security key")

    def test_public_key_as_jwk(self):
        from api.utils.passkeys import public_key_jwk, registration_options, verify_registration

        authenticator = SoftAuthenticator()
        fields, _ = verify_registration(
            self.user, authenticator.create(registration_options(self.user))
        )
        jwk = public_key_jwk(fields["public_key"])
        numbers = authenticator.key.public_key().public_numbers()
        self.assertEqual(jwk["kty"], "EC")
        self.assertEqual(jwk["crv"], "P-256")
        self.assertEqual(jwk["alg"], "ES256")
        self.assertEqual(jwk["x"], _b64(numbers.x.to_bytes(32, "big")))
        self.assertIsNone(public_key_jwk(b"not cose"))

    def test_inspect_describes_without_storing(self):
        from backend.graphene.mutations.mfa import (
            BeginPasskeyRegistrationMutation,
            FinishPasskeyRegistrationMutation,
            InspectPasskeyRegistrationMutation,
        )

        info = self.info()
        options = BeginPasskeyRegistrationMutation.mutate(None, info).options
        credential = SoftAuthenticator(synced=True, aaguid=self.BITWARDEN).create(options)
        candidate = InspectPasskeyRegistrationMutation.mutate(
            None, info, credential=credential
        ).passkey
        self.assertEqual(candidate.suggested_name, "Bitwarden")
        self.assertEqual(candidate.authenticator_name, "Bitwarden")
        self.assertEqual(candidate.kind, "synced")
        self.assertEqual(candidate.public_key["kty"], "EC")
        self.assertEqual(self.models.passkey.count(), 0)
        # The challenge is still good for adding it
        result = FinishPasskeyRegistrationMutation.mutate(
            None, info, name=candidate.suggested_name, credential=credential
        )
        self.assertEqual(result.passkey.name, "Bitwarden")

    def test_inspect_rejects_a_bad_credential(self):
        from backend.graphene.mutations.mfa import InspectPasskeyRegistrationMutation

        with self.assertRaises(GraphQLError) as ctx:
            InspectPasskeyRegistrationMutation.mutate(
                None,
                self.info(),
                credential=SoftAuthenticator().create({"challenge": _b64(b"x" * 32)}),
            )
        self.assertEqual(ctx.exception.extensions["code"], "PASSKEY_REGISTRATION_FAILED")

    def test_inspect_refuses_a_registered_credential(self):
        from backend.graphene.mutations.mfa import (
            BeginPasskeyRegistrationMutation,
            InspectPasskeyRegistrationMutation,
        )

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        mallory = _make_user(user_id="uuid-mallory")
        info = self.info(user=mallory)
        options = BeginPasskeyRegistrationMutation.mutate(None, info).options
        with self.assertRaises(GraphQLError) as ctx:
            InspectPasskeyRegistrationMutation.mutate(
                None, info, credential=authenticator.create(options)
            )
        # Not "failed": the client must not tell the provider to forget it
        self.assertEqual(ctx.exception.extensions["code"], "PASSKEY_ALREADY_REGISTERED")

    def test_status_describes_stored_passkeys(self):
        from backend.graphene.queries.account import resolve_mfa_status
        from backend.graphene.types import PasskeyType

        self.register(SoftAuthenticator(aaguid=self.BITWARDEN, synced=True), name="Vault")
        passkey = resolve_mfa_status(None, self.info()).passkeys[0]
        self.assertEqual(PasskeyType.resolve_kind(passkey, None), "synced")
        self.assertEqual(PasskeyType.resolve_authenticator_name(passkey, None), "Bitwarden")
        self.assertEqual(PasskeyType.resolve_public_key(passkey, None)["crv"], "P-256")


# ---------------------------------------------------------------------------
# Management mutations + the shared recovery codes
# ---------------------------------------------------------------------------


class PasskeyRegistrationMutationTest(PasskeyTestCase):
    def test_begin_requires_fresh_session(self):
        from backend.graphene.mutations.mfa import BeginPasskeyRegistrationMutation

        with self.assertRaises(GraphQLError) as ctx:
            BeginPasskeyRegistrationMutation.mutate(None, self.info(fresh=False))
        self.assertIn("reauth_required", str(ctx.exception))

    def test_begin_refuses_past_the_limit(self):
        from api.utils.passkeys import MAX_PASSKEYS_PER_USER
        from backend.graphene.mutations.mfa import BeginPasskeyRegistrationMutation

        for i in range(MAX_PASSKEYS_PER_USER):
            self.models.passkey.create(
                user=self.user, name=f"k{i}", credential_id=f"id{i}", public_key=b""
            )
        with self.assertRaises(GraphQLError) as ctx:
            BeginPasskeyRegistrationMutation.mutate(None, self.info())
        self.assertIn("up to", str(ctx.exception))

    def test_first_factor_passkey_issues_recovery_codes(self):
        result = self.register(SoftAuthenticator(), name="  YubiKey 5C  ")

        self.assertEqual(len(result.recovery_codes), 10)
        self.assertEqual(len(self.recovery_rows()), 10)
        self.assertEqual(result.passkey.name, "YubiKey 5C")
        self.assertTrue(result.passkey.prf_enabled)
        self.emails.send_passkey_status_email.assert_called_once()
        self.assertTrue(self.emails.send_passkey_status_email.call_args.kwargs["added"])

    def test_second_factor_requires_proof_and_keeps_codes(self):
        from backend.graphene.mutations.mfa import (
            BeginPasskeyRegistrationMutation,
            FinishPasskeyRegistrationMutation,
        )

        first = SoftAuthenticator()
        self.register(first)
        original_hashes = [r.code_hash for r in self.recovery_rows()]

        info = self.info()
        options = BeginPasskeyRegistrationMutation.mutate(None, info).options
        credential = SoftAuthenticator().create(options)
        with self.assertRaises(GraphQLError):
            FinishPasskeyRegistrationMutation.mutate(
                None, info, name="Phone", credential=credential
            )
        self.assertEqual(self.models.passkey.count(), 1)

        # The failed proof left the registration challenge in place: retry
        # with a proof from the first passkey.
        proof = self.manage_proof(first)
        result = FinishPasskeyRegistrationMutation.mutate(
            None, info, name="Phone", credential=credential, passkey_credential=proof
        )
        self.assertIsNone(result.recovery_codes)
        self.assertEqual(self.models.passkey.count(), 2)
        self.assertEqual([r.code_hash for r in self.recovery_rows()], original_hashes)

    def test_totp_user_adds_passkey_with_totp_code_and_keeps_codes(self):
        from api.utils.mfa import generate_recovery_codes

        self.enable_totp()
        codes = generate_recovery_codes(self.user)
        result = self.register(SoftAuthenticator(), code=self.totp_code())

        self.assertIsNone(result.recovery_codes)
        # The TOTP recovery codes still work for the passkey account
        from api.utils.mfa import consume_recovery_code

        self.assertTrue(consume_recovery_code(self.user, codes[0]))

    def test_rejected_credential_does_not_cost_the_proof(self):
        """A recovery code offered as proof survives a bad credential."""
        from api.utils.mfa import consume_recovery_code
        from backend.graphene.mutations.mfa import (
            BeginPasskeyRegistrationMutation,
            FinishPasskeyRegistrationMutation,
        )

        codes = self.register(SoftAuthenticator()).recovery_codes
        info = self.info()
        options = BeginPasskeyRegistrationMutation.mutate(None, info).options
        bad = SoftAuthenticator().create(options, origin="https://evil.test")
        with self.assertRaises(GraphQLError) as ctx:
            FinishPasskeyRegistrationMutation.mutate(
                None, info, name="Bad", credential=bad, recovery_code=codes[0]
            )
        self.assertEqual(ctx.exception.extensions["code"], "PASSKEY_REGISTRATION_FAILED")
        self.assertTrue(consume_recovery_code(self.user, codes[0]))

    def test_name_validation(self):
        from api.utils.passkeys import PASSKEY_NAME_MAX_LENGTH

        for name, message in [("   ", "name"), ("x" * (PASSKEY_NAME_MAX_LENGTH + 1), "at most")]:
            with self.assertRaises(GraphQLError) as ctx:
                self.register(SoftAuthenticator(), name=name)
            self.assertIn(message, str(ctx.exception))
        self.assertEqual(self.models.passkey.count(), 0)

    def test_expired_registration_surfaces_error(self):
        from backend.graphene.mutations.mfa import FinishPasskeyRegistrationMutation

        with self.assertRaises(GraphQLError) as ctx:
            FinishPasskeyRegistrationMutation.mutate(
                None,
                self.info(),
                name="Key",
                credential=SoftAuthenticator().create({"challenge": _b64(b"c" * 32)}),
            )
        self.assertIn("expired", str(ctx.exception))
        self.assertEqual(ctx.exception.extensions["code"], "PASSKEY_REGISTRATION_FAILED")

    def test_duplicate_credential_rejected(self):
        authenticator = SoftAuthenticator()
        self.register(authenticator)
        mallory = _make_user(user_id="uuid-mallory")
        with self.assertRaises(GraphQLError) as ctx:
            self.register(authenticator, user=mallory)
        self.assertIn("already registered", str(ctx.exception))
        # Not "failed": the client must not tell the provider to forget it
        self.assertEqual(ctx.exception.extensions["code"], "PASSKEY_ALREADY_REGISTERED")
        # The failed registration issued Mallory no recovery codes
        self.assertEqual(self.recovery_rows(mallory), [])


class PasskeyRemovalTest(PasskeyTestCase):
    def test_removing_needs_proof(self):
        from backend.graphene.mutations.mfa import DeletePasskeyMutation

        self.register(SoftAuthenticator())
        passkey = self.models.passkey.rows[0]
        with self.assertRaises(GraphQLError):
            DeletePasskeyMutation.mutate(None, self.info(), passkey_id=passkey.id)
        self.assertEqual(self.models.passkey.count(), 1)

    def test_removing_last_factor_deletes_recovery_codes(self):
        from backend.graphene.mutations.mfa import DeletePasskeyMutation

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        passkey = self.models.passkey.rows[0]
        result = DeletePasskeyMutation.mutate(
            None,
            self.info(),
            passkey_id=passkey.id,
            passkey_credential=self.manage_proof(authenticator),
        )
        self.assertTrue(result.ok)
        self.assertEqual(self.models.passkey.count(), 0)
        self.assertEqual(self.recovery_rows(), [])
        self.assertFalse(
            self.emails.send_passkey_status_email.call_args.kwargs["added"]
        )

    def test_removing_passkey_with_totp_left_keeps_codes(self):
        from backend.graphene.mutations.mfa import DeletePasskeyMutation

        self.register(SoftAuthenticator())
        self.enable_totp()
        passkey = self.models.passkey.rows[0]
        DeletePasskeyMutation.mutate(
            None, self.info(), passkey_id=passkey.id, code=self.totp_code()
        )
        self.assertEqual(len(self.recovery_rows()), 10)

    def test_recovery_code_proof_is_single_use(self):
        from backend.graphene.mutations.mfa import DeletePasskeyMutation

        codes = self.register(SoftAuthenticator()).recovery_codes
        self.register(SoftAuthenticator(), name="Backup key", recovery_code=codes[0])
        passkey = self.models.passkey.rows[0]
        # codes[0] was spent proving the second registration
        with self.assertRaises(GraphQLError):
            DeletePasskeyMutation.mutate(
                None, self.info(), passkey_id=passkey.id, recovery_code=codes[0]
            )
        DeletePasskeyMutation.mutate(
            None, self.info(), passkey_id=passkey.id, recovery_code=codes[1]
        )
        self.assertEqual(self.models.passkey.count(), 1)
        self.assertEqual(
            len(self.models.recovery.filter(used_at__isnull=True).rows), 8
        )

    def test_cannot_remove_another_users_passkey(self):
        from backend.graphene.mutations.mfa import DeletePasskeyMutation

        mallory = _make_user(user_id="uuid-mallory")
        self.register(SoftAuthenticator(), user=mallory)
        victim_key = self.models.passkey.rows[0]
        mine = SoftAuthenticator()
        self.register(mine)
        with self.assertRaises(GraphQLError) as ctx:
            DeletePasskeyMutation.mutate(
                None,
                self.info(),
                passkey_id=victim_key.id,
                passkey_credential=self.manage_proof(mine),
            )
        self.assertIn("not found", str(ctx.exception))

    def test_verification_options_need_a_passkey(self):
        from backend.graphene.mutations.mfa import BeginPasskeyVerificationMutation

        with self.assertRaises(GraphQLError):
            BeginPasskeyVerificationMutation.mutate(None, self.info())


class TotpAlongsidePasskeysTest(PasskeyTestCase):
    def _enroll(self):
        from backend.graphene.mutations.mfa import EnrollMfaMutation

        with patch("backend.graphene.mutations.mfa.generate_totp_secret", return_value=SEED), patch(
            "backend.graphene.mutations.mfa.encrypt_seed", return_value="ph:v1:ct"
        ):
            EnrollMfaMutation.mutate(None, self.info())

    def test_activating_totp_with_passkeys_needs_proof_and_keeps_codes(self):
        from backend.graphene.mutations.mfa import ActivateMfaMutation

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        original_hashes = [r.code_hash for r in self.recovery_rows()]
        self._enroll()

        with self.assertRaises(GraphQLError) as ctx:
            ActivateMfaMutation.mutate(None, self.info(), code=self.totp_code())
        self.assertIsNone(self.models.totp.rows[0].activated_at)
        # The code was right: it's the missing proof that failed
        self.assertNotEqual((ctx.exception.extensions or {}).get("code"), "TOTP_CODE_INVALID")
        with self.assertRaises(GraphQLError) as ctx:
            ActivateMfaMutation.mutate(None, self.info(), code="000000")
        self.assertEqual(ctx.exception.extensions["code"], "TOTP_CODE_INVALID")

        # The rejected attempt consumed that timestep; the next one works.
        next_code = pyotp.TOTP(SEED).at(int(time.time()) + 30)
        result = ActivateMfaMutation.mutate(
            None,
            self.info(),
            code=next_code,
            passkey_credential=self.manage_proof(authenticator),
        )
        self.assertIsNone(result.recovery_codes)
        self.assertIsNotNone(self.models.totp.rows[0].activated_at)
        self.assertEqual([r.code_hash for r in self.recovery_rows()], original_hashes)

    def test_totp_as_first_factor_still_issues_codes(self):
        from backend.graphene.mutations.mfa import ActivateMfaMutation

        self._enroll()
        result = ActivateMfaMutation.mutate(None, self.info(), code=self.totp_code())
        self.assertEqual(len(result.recovery_codes), 10)

    def test_disabling_totp_keeps_codes_while_a_passkey_remains(self):
        from backend.graphene.mutations.mfa import DisableMfaMutation

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        self.enable_totp()
        DisableMfaMutation.mutate(
            None, self.info(), passkey_credential=self.manage_proof(authenticator)
        )
        self.assertEqual(self.models.totp.count(), 0)
        self.assertEqual(len(self.recovery_rows()), 10)

    def test_disabling_totp_without_passkeys_deletes_codes(self):
        from api.utils.mfa import generate_recovery_codes
        from backend.graphene.mutations.mfa import DisableMfaMutation

        self.enable_totp()
        generate_recovery_codes(self.user)
        DisableMfaMutation.mutate(None, self.info(), code=self.totp_code())
        self.assertEqual(self.recovery_rows(), [])

    def test_disabling_totp_when_only_passkeys_are_enabled(self):
        from backend.graphene.mutations.mfa import DisableMfaMutation

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        with self.assertRaises(GraphQLError) as ctx:
            DisableMfaMutation.mutate(
                None, self.info(), passkey_credential=self.manage_proof(authenticator)
            )
        self.assertIn("not enabled", str(ctx.exception))

    def test_regenerate_with_passkey_proof(self):
        from backend.graphene.mutations.mfa import RegenerateRecoveryCodesMutation

        authenticator = SoftAuthenticator()
        old_codes = self.register(authenticator).recovery_codes
        result = RegenerateRecoveryCodesMutation.mutate(
            None, self.info(), passkey_credential=self.manage_proof(authenticator)
        )
        self.assertEqual(len(result.recovery_codes), 10)
        self.assertNotEqual(set(result.recovery_codes), set(old_codes))

    def test_failed_passkey_proof_is_reported_but_not_counted(self):
        """Passkeys can't be guessed: a failed one shows its own reason and
        spends no code attempts (so it can't lock the user out)."""
        from api.utils.mfa import mfa_locked_out, MFA_FAIL_LIMIT
        from backend.graphene.mutations.mfa import RegenerateRecoveryCodesMutation

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        proof = self.manage_proof(authenticator)
        RegenerateRecoveryCodesMutation.mutate(None, self.info(), passkey_credential=proof)
        messages = []
        for _ in range(MFA_FAIL_LIMIT):
            with self.assertRaises(GraphQLError) as ctx:
                RegenerateRecoveryCodesMutation.mutate(
                    None, self.info(), passkey_credential=proof
                )
            messages.append(str(ctx.exception))
        # The passkey's own reason (a replay finds its challenge used up),
        # not a generic "Invalid code."
        self.assertIn("request has expired", messages[0])
        self.assertFalse(mfa_locked_out(self.user.userId))

    def test_passkey_proof_spares_the_recovery_code(self):
        from api.utils.mfa import consume_recovery_code
        from backend.graphene.mutations.mfa import _verify_second_factor

        authenticator = SoftAuthenticator()
        codes = self.register(authenticator).recovery_codes
        _verify_second_factor(
            self.user,
            recovery_code=codes[0],
            passkey_credential=self.manage_proof(authenticator),
        )
        self.assertTrue(consume_recovery_code(self.user, codes[0]))

    def test_status_reports_passkeys(self):
        from backend.graphene.queries.account import resolve_mfa_status

        self.register(SoftAuthenticator(synced=True), name="iCloud Keychain")
        status = resolve_mfa_status(None, self.info())
        self.assertTrue(status.enabled)
        self.assertFalse(status.totp_enabled)
        self.assertEqual(status.recovery_codes_remaining, 10)
        self.assertEqual([p.name for p in status.passkeys], ["iCloud Keychain"])
        self.assertEqual(status.passkey_rp_id, RP_ID)

        from backend.graphene.types import PasskeyType

        self.assertTrue(PasskeyType.resolve_synced(status.passkeys[0], None))


# ---------------------------------------------------------------------------
# Pre-login: /auth/mfa/options/ and /auth/mfa/verify/
# ---------------------------------------------------------------------------


class PasskeyLoginTest(PasskeyTestCase):
    def setUp(self):
        super().setUp()
        for target in ("get_user_model", "login"):
            patcher = patch(f"api.views.auth_mfa.{target}")
            setattr(self, target, patcher.start())
            self.addCleanup(patcher.stop)
        lookup = self.get_user_model.return_value.objects.filter.return_value
        lookup.first.return_value = self.user

        # One session across requests, as the signed cookie would carry it.
        request = RequestFactory().get("/")
        _add_session_to_request(request)
        self.session = request.session
        self.start_pending_sign_in()

    def start_pending_sign_in(self):
        self.session["mfa_pending_user_id"] = self.user.userId
        self.session["mfa_pending_at"] = int(time.time())
        self.session["mfa_pending_method"] = "password"

    def _request(self, path, body=None):
        request = APIRequestFactory().post(path, data=body or {}, format="json")
        request.session = self.session
        return request

    def options(self):
        from api.views.auth_mfa import mfa_options

        return mfa_options(self._request("/auth/mfa/options/"))

    def verify(self, body):
        from api.views.auth_mfa import mfa_verify

        return mfa_verify(self._request("/auth/mfa/verify/", body))

    def test_options_without_pending_sign_in(self):
        self.session.pop("mfa_pending_user_id")
        response = self.options()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)["code"], "no_pending")

    def test_options_report_methods(self):
        self.enable_totp()
        data = json.loads(self.options().content)
        self.assertEqual(
            data, {"methods": ["totp"], "passkeyOptions": None, "codesLocked": False}
        )

        self.register(SoftAuthenticator(), code=self.totp_code())
        data = json.loads(self.options().content)
        self.assertEqual(data["methods"], ["totp", "passkey"])
        self.assertEqual(data["passkeyOptions"]["rpId"], RP_ID)

    def _lock_codes(self):
        from api.utils.mfa import MFA_FAIL_LIMIT, record_mfa_failure

        for _ in range(MFA_FAIL_LIMIT):
            record_mfa_failure(self.user.userId)

    def test_locked_codes_leave_the_passkey_open(self):
        """Ten wrong codes (say, from someone with the password) lock codes
        only: passkeys can't be guessed, so the owner still gets in."""
        self.enable_totp()
        authenticator = SoftAuthenticator()
        self.register(authenticator, code=self.totp_code())
        self._lock_codes()

        options = json.loads(self.options().content)
        self.assertTrue(options["codesLocked"])
        self.assertEqual(options["methods"], ["passkey"])
        locked = self.verify({"code": self.totp_code()})
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(json.loads(locked.content)["code"], "locked_out")

        response = self.verify(
            {"passkeyCredential": authenticator.get(options["passkeyOptions"])}
        )
        self.assertEqual(response.status_code, 200)

    def test_locked_codes_without_passkeys_end_the_challenge(self):
        self.enable_totp()
        self._lock_codes()
        response = self.options()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(json.loads(response.content)["code"], "locked_out")

    def test_failed_passkeys_spend_no_code_attempts(self):
        from api.utils.mfa import MFA_FAIL_LIMIT, mfa_locked_out

        self.register(SoftAuthenticator())
        stranger = SoftAuthenticator()
        # As many as would lock codes, if they counted
        for _ in range(MFA_FAIL_LIMIT):
            options = json.loads(self.options().content)
            response = self.verify(
                {"passkeyCredential": stranger.get(options["passkeyOptions"])}
            )
            self.assertEqual(response.status_code, 401)
        self.assertFalse(mfa_locked_out(self.user.userId))

    def test_codes_are_counted_before_they_are_checked(self):
        """Each code spends an attempt first, so requests racing past the
        lockout check still can't exceed the limit."""
        from api.utils.mfa import MFA_FAIL_LIMIT

        self.enable_totp()
        # As if every request raced past the lockout check (and the per-IP
        # rate limit, which is separate)
        with patch("api.views.auth_mfa.mfa_locked_out", return_value=False), patch(
            "api.views.auth_mfa.MfaVerifyThrottle.allow_request", return_value=True
        ):
            responses = [self.verify({"code": "000000"}) for _ in range(MFA_FAIL_LIMIT + 3)]
        statuses = [r.status_code for r in responses]
        self.assertEqual(statuses[:MFA_FAIL_LIMIT], [401] * MFA_FAIL_LIMIT)
        self.assertEqual(statuses[MFA_FAIL_LIMIT:], [429] * 3)
        self.assertEqual(json.loads(responses[-1].content)["code"], "locked_out")

    def test_passkey_only_user_signs_in_with_passkey(self):
        authenticator = SoftAuthenticator()
        self.register(authenticator)
        options = json.loads(self.options().content)
        self.assertEqual(options["methods"], ["passkey"])

        response = self.verify(
            {"passkeyCredential": authenticator.get(options["passkeyOptions"])}
        )
        self.assertEqual(response.status_code, 200)
        self.login.assert_called_once()
        self.assertIs(self.login.call_args.args[1], self.user)
        self.assertIn("auth_time", self.session)
        self.assertNotIn("mfa_pending_user_id", self.session)
        self.login_email.assert_called_once()

    def test_replayed_login_assertion_rejected(self):
        from api.utils.mfa import mfa_locked_out

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        options = json.loads(self.options().content)["passkeyOptions"]
        assertion = authenticator.get(options)
        self.assertEqual(self.verify({"passkeyCredential": assertion}).status_code, 200)

        # A new pending sign-in can't reuse the old assertion
        self.start_pending_sign_in()
        self.options()
        response = self.verify({"passkeyCredential": assertion})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)["code"], "passkey_expired")
        self.assertFalse(mfa_locked_out(self.user.userId))
        self.assertEqual(self.login.call_count, 1)

    def test_management_challenge_cannot_finish_a_login(self):
        authenticator = SoftAuthenticator()
        self.register(authenticator)
        assertion = self.manage_proof(authenticator)
        response = self.verify({"passkeyCredential": assertion})
        self.assertEqual(response.status_code, 401)
        data = json.loads(response.content)
        self.assertEqual(data["code"], "passkey_expired")
        self.assertIn("expired", data["error"])
        self.login.assert_not_called()

    def test_passkey_only_user_cannot_use_a_totp_code(self):
        self.register(SoftAuthenticator())
        response = self.verify({"code": self.totp_code()})
        self.assertEqual(response.status_code, 401)
        self.login.assert_not_called()

    def test_recovery_code_signs_in_passkey_only_user(self):
        codes = self.register(SoftAuthenticator()).recovery_codes
        response = self.verify({"recoveryCode": codes[3]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.models.recovery.filter(used_at__isnull=True).rows), 9)

    def test_user_with_no_factor_left_is_expired(self):
        response = self.verify({"code": "123456"})
        self.assertEqual(response.status_code, 410)


class PasswordLoginGateTest(PasskeyTestCase):
    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.get_user_model")
    @patch("api.views.auth_password._password_auth_enabled", return_value=True)
    def test_passkey_only_user_is_challenged(self, mock_enabled, mock_get_user, mock_login):
        from api.views.auth_password import password_login

        self.register(SoftAuthenticator())
        user = self.user
        user.active = True
        user.check_password.return_value = True
        mock_get_user.return_value.objects.get.return_value = user

        request = APIRequestFactory().post(
            "/auth/password/login/",
            data={"email": "alice@example.com", "authHash": "a" * 64},
            format="json",
        )
        _add_session_to_request(request)
        response = password_login(request)

        self.assertEqual(json.loads(response.content), {"mfaRequired": True})
        mock_login.assert_not_called()
        self.assertEqual(request.session["mfa_pending_user_id"], "uuid-user-1")


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------
# Security review regressions
# ---------------------------------------------------------------------------


class FailureCounterTest(unittest.TestCase):
    def _counter(self):
        from api.utils.mfa import FailureCounter

        return FailureCounter("t", limit=3, ttl=900)

    def test_a_key_recreated_by_incr_gets_its_ttl_back(self):
        """Expiring between incr()'s existence check and the INCR recreates
        the key without a TTL: a permanent lockout unless it's restored."""
        cache_mock = MagicMock()
        cache_mock.add.return_value = False
        cache_mock.incr.return_value = 1
        with patch("api.utils.mfa.cache", cache_mock):
            self.assertTrue(self._counter().attempt("u"))
        cache_mock.touch.assert_called_once_with("t_fail:u", 900)

    def test_a_key_gone_before_incr_starts_a_new_window(self):
        cache_mock = MagicMock()
        cache_mock.add.side_effect = [False, True]
        cache_mock.incr.side_effect = ValueError("Key not found")
        with patch("api.utils.mfa.cache", cache_mock):
            self.assertTrue(self._counter().attempt("u"))
        self.assertEqual(cache_mock.add.call_args.kwargs["timeout"], 900)

    def test_attempts_stop_at_the_limit(self):
        cache.clear()
        counter = self._counter()
        self.assertEqual([counter.attempt("u") for _ in range(5)], [True] * 3 + [False] * 2)
        counter.clear("u")
        self.assertTrue(counter.attempt("u"))


class SecurityReviewRegressionTest(PasskeyTestCase):
    DEEP = "[" * 20000

    def test_deeply_nested_credentials_are_refused_not_raised(self):
        from api.utils.passkeys import (
            PURPOSE_MANAGE,
            PasskeyError,
            verify_assertion,
            verify_registration,
        )

        for credential in (self.DEEP, json.dumps({"response": {"clientDataJSON": _b64(self.DEEP.encode())}})):
            with self.assertRaises(PasskeyError) as ctx:
                verify_assertion(self.user, PURPOSE_MANAGE, credential)
            self.assertEqual(ctx.exception.code, "invalid_response")
            with self.assertRaises(PasskeyError):
                verify_registration(self.user, credential)

    def test_credentials_must_be_strings(self):
        """An object (from a REST body) would skip the size cap."""
        from api.utils.passkeys import PURPOSE_LOGIN, PasskeyError, verify_assertion

        with self.assertRaises(PasskeyError) as ctx:
            verify_assertion(self.user, PURPOSE_LOGIN, {"id": "x", "response": {}})
        self.assertEqual(ctx.exception.code, "invalid_response")

    def test_a_malformed_passkey_proof_never_checks_the_code_beside_it(self):
        """The passkey is the proof when one is sent: a TOTP code riding
        along is never checked, so it can't be guessed outside the limit."""
        from backend.graphene.mutations.mfa import _verify_second_factor

        self.enable_totp()
        for _ in range(3):
            with self.assertRaises(GraphQLError):
                _verify_second_factor(
                    self.user, code=self.totp_code(), passkey_credential=self.DEEP
                )

    def test_passkey_proofs_work_while_codes_are_locked(self):
        from api.utils.mfa import MFA_FAIL_LIMIT, record_mfa_failure
        from backend.graphene.mutations.mfa import RegenerateRecoveryCodesMutation

        authenticator = SoftAuthenticator()
        self.register(authenticator)
        for _ in range(MFA_FAIL_LIMIT):
            record_mfa_failure(self.user.userId)
        with self.assertRaises(GraphQLError) as ctx:
            RegenerateRecoveryCodesMutation.mutate(None, self.info(), recovery_code="aaaaa-aaaaa")
        self.assertIn("Too many attempts", str(ctx.exception))
        result = RegenerateRecoveryCodesMutation.mutate(
            None, self.info(), passkey_credential=self.manage_proof(authenticator)
        )
        self.assertEqual(len(result.recovery_codes), 10)

    def test_passkey_names_refuse_hidden_characters_before_spending_a_proof(self):
        codes = self.register(SoftAuthenticator()).recovery_codes
        for name in ("Yubi\x00Key", "Key \u202egnp.exe", "\u200b"):
            with self.assertRaises(GraphQLError):
                self.register(SoftAuthenticator(), name=name, recovery_code=codes[0])
        # Refused before the proof: the recovery code still works
        self.register(SoftAuthenticator(), name="Backup", recovery_code=codes[0])
        self.assertEqual(self.models.passkey.count(), 2)

    def test_passkey_names_are_unique_per_user(self):
        codes = self.register(SoftAuthenticator(), name="Work key").recovery_codes
        with self.assertRaises(GraphQLError) as ctx:
            self.register(SoftAuthenticator(), name="  work KEY ", recovery_code=codes[0])
        self.assertIn("already have a passkey with this name", str(ctx.exception))

    def test_a_second_finish_of_the_same_passkey_reports_it_registered(self):
        """A double submit: the loser must not read as "failed", or the
        client would tell the password manager to forget a live passkey."""
        from backend.graphene.mutations.mfa import (
            BeginPasskeyRegistrationMutation,
            FinishPasskeyRegistrationMutation,
        )

        info = self.info()
        options = BeginPasskeyRegistrationMutation.mutate(None, info).options
        credential = SoftAuthenticator().create(options)
        FinishPasskeyRegistrationMutation.mutate(None, info, name="Key", credential=credential)
        with self.assertRaises(GraphQLError) as ctx:
            FinishPasskeyRegistrationMutation.mutate(None, info, name="Key 2", credential=credential)
        self.assertEqual(ctx.exception.extensions["code"], "PASSKEY_ALREADY_REGISTERED")

    def test_emails_say_whether_two_factor_is_still_on(self):
        from backend.graphene.mutations.mfa import DeletePasskeyMutation, DisableMfaMutation

        first, second = SoftAuthenticator(), SoftAuthenticator()
        self.register(first, name="First")
        sent = self.emails.send_passkey_status_email
        self.assertFalse(sent.call_args.kwargs["other_factors"])  # 2FA turned on
        self.register(second, name="Second", passkey_credential=self.manage_proof(first))
        self.assertTrue(sent.call_args.kwargs["other_factors"])

        self.enable_totp()
        DisableMfaMutation.mutate(None, self.info(), passkey_credential=self.manage_proof(first))
        self.assertTrue(self.emails.send_totp_status_email.call_args.kwargs["other_factors"])

        rows = {p.name: p.id for p in self.models.passkey.rows}
        DeletePasskeyMutation.mutate(
            None, self.info(), passkey_id=rows["Second"], passkey_credential=self.manage_proof(first)
        )
        self.assertTrue(sent.call_args.kwargs["other_factors"])
        DeletePasskeyMutation.mutate(
            None, self.info(), passkey_id=rows["First"], passkey_credential=self.manage_proof(first)
        )
        self.assertFalse(sent.call_args.kwargs["other_factors"])  # 2FA turned off
