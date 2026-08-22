"""Tests for account identity management: the fresh-session re-auth gate,
identity enumeration, the SSO link flow, and unlinking.

Uses unittest.TestCase with mocked ORM — no database required.
"""

import json
import time
import unittest
from unittest.mock import patch, MagicMock

from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache
from django.test import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware
from rest_framework.test import APIRequestFactory, force_authenticate


def _add_session_to_request(request):
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


def _fresh_session(request):
    request.session["auth_time"] = int(time.time())


def _make_user(user_id="uuid-user-1", email="alice@example.com"):
    user = MagicMock()
    user.userId = user_id
    user.pk = user_id
    user.email = email
    user.username = email
    user.full_name = "Alice Test"
    user.is_authenticated = True
    return user


def _mock_social_account(pk=1, provider="google", uid="uid-1", user=None, extra=None):
    sa = MagicMock()
    sa.pk = pk
    sa.provider = provider
    sa.uid = uid
    sa.user = user
    sa.user_id = user.pk if user is not None else None
    sa.extra_data = extra or {"email": "alice@example.com", "name": "Alice"}
    sa.date_joined = None
    sa.last_login = None
    return sa


# ---------------------------------------------------------------------------
# Fresh-session gate
# ---------------------------------------------------------------------------


class SessionFreshnessTest(unittest.TestCase):
    def _request(self):
        request = RequestFactory().get("/")
        _add_session_to_request(request)
        return request

    def test_missing_auth_time_is_stale(self):
        from api.utils.reauth import session_is_fresh

        self.assertFalse(session_is_fresh(self._request()))

    def test_old_auth_time_is_stale(self):
        from api.utils.reauth import AUTH_FRESHNESS_MAX_AGE, session_is_fresh

        request = self._request()
        request.session["auth_time"] = int(time.time()) - AUTH_FRESHNESS_MAX_AGE - 10
        self.assertFalse(session_is_fresh(request))

    def test_recent_auth_time_is_fresh(self):
        from api.utils.reauth import session_is_fresh

        request = self._request()
        _fresh_session(request)
        self.assertTrue(session_is_fresh(request))

    def test_non_integer_auth_time_is_stale(self):
        from api.utils.reauth import session_is_fresh

        request = self._request()
        request.session["auth_time"] = "yesterday"
        self.assertFalse(session_is_fresh(request))

    def test_stamp_then_check_round_trip(self):
        from api.utils.reauth import stamp_auth_time, session_is_fresh

        request = self._request()
        stamp_auth_time(request)
        self.assertTrue(session_is_fresh(request))

    def test_require_fresh_session_returns_401(self):
        from api.utils.reauth import require_fresh_session

        @require_fresh_session
        def view(request):  # pragma: no cover - short-circuited
            raise AssertionError("should not be reached")

        response = view(self._request())
        self.assertEqual(response.status_code, 401)
        data = json.loads(response.content)
        self.assertEqual(data["code"], "reauth_required")


class AuthTimeStampingTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    @patch("api.views.auth_password.user_has_active_totp", return_value=False)
    @patch("api.emails.send_login_email")
    @patch("api.views.auth_password.login")
    @patch("api.views.auth_password.get_user_model")
    @patch("api.views.auth_password._password_auth_enabled", return_value=True)
    def test_password_login_stamps_auth_time(
        self, mock_enabled, mock_get_user, mock_login, mock_email, mock_totp
    ):
        from api.views.auth_password import password_login

        User = MagicMock()
        user = MagicMock()
        user.active = True
        user.userId = "uuid-123"
        user.email = "alice@example.com"
        user.full_name = ""
        user.auth_method = "password"
        user.check_password.return_value = True
        user.socialaccount_set.first.return_value = None
        User.objects.get.return_value = user
        mock_get_user.return_value = User

        factory = APIRequestFactory()
        request = factory.post(
            "/auth/password/login/",
            data={"email": "alice@example.com", "authHash": "a" * 64},
            format="json",
        )
        _add_session_to_request(request)
        response = password_login(request)

        self.assertEqual(response.status_code, 200)
        self.assertIn("auth_time", request.session)


# ---------------------------------------------------------------------------
# Identity enumeration — GET /auth/identities/
# ---------------------------------------------------------------------------


class IdentitiesViewTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    def _get(self, user):
        factory = APIRequestFactory()
        request = factory.get("/auth/identities/")
        _add_session_to_request(request)
        force_authenticate(request, user=user)
        return request

    def _call(self, user, registry=None):
        from api.views.identity import identities_view

        with patch.dict(
            "api.views.sso.SSO_PROVIDER_REGISTRY",
            registry if registry is not None else {},
            clear=True,
        ):
            response = identities_view(self._get(user))
        return json.loads(response.content), response

    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    def test_single_identity_no_password_is_last_method(
        self, mock_enabled, mock_sso_provider
    ):
        user = _make_user()
        user.has_usable_password.return_value = True  # disabled instance-wide
        sa = _mock_social_account(user=user)
        user.socialaccount_set.all.return_value.order_by.return_value = [sa]
        mock_sso_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = (
            []
        )

        data, response = self._call(user)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(data["identities"]), 1)
        identity = data["identities"][0]
        self.assertTrue(identity["isLastMethod"])
        self.assertEqual(identity["blockedReason"], "last_method")
        # Password auth disabled instance-wide: not offered as a method
        self.assertFalse(data["hasUsablePassword"])

    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=True)
    def test_usable_password_lifts_last_method(self, mock_enabled, mock_sso_provider):
        user = _make_user()
        user.has_usable_password.return_value = True
        sa = _mock_social_account(user=user)
        user.socialaccount_set.all.return_value.order_by.return_value = [sa]
        mock_sso_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = (
            []
        )

        data, _ = self._call(user)

        identity = data["identities"][0]
        self.assertFalse(identity["isLastMethod"])
        self.assertIsNone(identity["blockedReason"])
        self.assertTrue(data["hasUsablePassword"])

    @patch("api.views.identity.SCIMUser")
    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    def test_enforced_org_provider_blocks_matching_identity(
        self, mock_enabled, mock_sso_provider, mock_scim
    ):
        user = _make_user()
        user.has_usable_password.return_value = False
        google_sa = _mock_social_account(pk=1, provider="google", uid="g-1", user=user)
        ms_sa = _mock_social_account(pk=2, provider="microsoft", uid="oid-1", user=user)
        user.socialaccount_set.all.return_value.order_by.return_value = [
            google_sa,
            ms_sa,
        ]

        org_provider = MagicMock()
        org_provider.id = "cfg-1"
        org_provider.provider_type = "entra_id"
        org_provider.name = "Entra"
        org_provider.organisation.name = "Acme"
        org_provider.organisation.require_sso = True
        mock_sso_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = [
            org_provider
        ]
        mock_scim.objects.filter.return_value.exists.return_value = False

        data, _ = self._call(user)

        by_provider = {i["provider"]: i for i in data["identities"]}
        self.assertEqual(by_provider["microsoft"]["blockedReason"], "org_enforced")
        self.assertEqual(by_provider["microsoft"]["blockedOrgName"], "Acme")
        self.assertTrue(by_provider["microsoft"]["managedByOrg"])
        self.assertIsNone(by_provider["google"]["blockedReason"])
        # Org-level identity is labelled with its org; the instance-level
        # Google identity is not.
        self.assertEqual(by_provider["microsoft"]["organisationName"], "Acme")
        self.assertIsNone(by_provider["google"]["organisationName"])
        # Org provider appears in availableToLink with both id spaces
        self.assertEqual(
            data["availableToLink"]["org"],
            [
                {
                    "id": "cfg-1",
                    "provider": "entra_id",
                    "providerId": "microsoft",
                    "providerName": "Entra",
                    "organisationName": "Acme",
                }
            ],
        )

    @patch("api.views.identity.SCIMUser")
    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    def test_scim_managed_blocks_matching_identity(
        self, mock_enabled, mock_sso_provider, mock_scim
    ):
        user = _make_user()
        user.has_usable_password.return_value = False
        ms_sa = _mock_social_account(pk=2, provider="microsoft", uid="oid-1", user=user)
        other = _mock_social_account(pk=3, provider="github", uid="gh-1", user=user)
        user.socialaccount_set.all.return_value.order_by.return_value = [ms_sa, other]

        org_provider = MagicMock()
        org_provider.id = "cfg-2"
        org_provider.provider_type = "entra_id"
        org_provider.name = "Entra"
        org_provider.organisation.name = "Acme"
        org_provider.organisation.require_sso = False
        mock_sso_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = [
            org_provider
        ]
        mock_scim.objects.filter.return_value.exists.return_value = True

        data, _ = self._call(user)

        by_provider = {i["provider"]: i for i in data["identities"]}
        self.assertEqual(by_provider["microsoft"]["blockedReason"], "scim_managed")

    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    def test_available_instance_providers_from_registry(
        self, mock_enabled, mock_sso_provider
    ):
        user = _make_user()
        user.has_usable_password.return_value = False
        user.socialaccount_set.all.return_value.order_by.return_value = []
        mock_sso_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = (
            []
        )

        registry = {
            "google": {"provider_id": "google"},
            "entra-id-oidc": {"provider_id": "microsoft"},
        }
        data, _ = self._call(user, registry=registry)

        self.assertEqual(
            data["availableToLink"]["instance"],
            [
                {"slug": "google", "providerId": "google"},
                {"slug": "entra-id-oidc", "providerId": "microsoft"},
            ],
        )


# ---------------------------------------------------------------------------
# Link flow — authorize views
# ---------------------------------------------------------------------------

_FAKE_GOOGLE_CONFIG = {
    "client_id": "test-client",
    "client_secret": "test-secret",
    "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_url": "https://oauth2.googleapis.com/token",
    "scopes": "openid profile email",
    "provider_id": "google",
    "token_auth_method": "client_secret_post",
}


class LinkAuthorizeTest(unittest.TestCase):
    def setUp(self):
        cache.clear()
        patcher = patch.dict(
            "api.views.sso.SSO_PROVIDER_REGISTRY",
            {"google": dict(_FAKE_GOOGLE_CONFIG)},
            clear=True,
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _get(self, path, user=None):
        request = RequestFactory().get(path)
        _add_session_to_request(request)
        request.user = user if user is not None else AnonymousUser()
        return request

    def _call(self, request):
        from api.views.sso import SSOAuthorizeView

        return SSOAuthorizeView.as_view()(request, provider="google")

    def test_link_requires_authentication(self):
        response = self._call(self._get("/auth/sso/google/authorize/?intent=link"))
        self.assertEqual(response.status_code, 302)
        self.assertIn("/login?callbackUrl=%2Faccount", response.url)
        self.assertNotIn("reauth", response.url)

    def test_link_requires_fresh_session(self):
        request = self._get("/auth/sso/google/authorize/?intent=link", user=_make_user())
        response = self._call(request)
        self.assertEqual(response.status_code, 302)
        self.assertIn("reauth=1", response.url)

    def test_link_sets_session_state(self):
        user = _make_user()
        request = self._get("/auth/sso/google/authorize/?intent=link", user=user)
        _fresh_session(request)
        response = self._call(request)

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.url.startswith(_FAKE_GOOGLE_CONFIG["authorize_url"]))
        self.assertEqual(request.session["sso_link_user_id"], str(user.userId))
        self.assertEqual(request.session["sso_return_to"], "/account")

    def test_normal_login_pops_stale_link_flag(self):
        request = self._get("/auth/sso/google/authorize/")
        request.session["sso_link_user_id"] = "stale-user"
        response = self._call(request)

        self.assertEqual(response.status_code, 302)
        self.assertNotIn("sso_link_user_id", request.session)


# ---------------------------------------------------------------------------
# Link flow — callback binding + _complete_link
# ---------------------------------------------------------------------------


class LinkCallbackBindingTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    def _callback_request(self, link_user_id, session_user):
        request = RequestFactory().get(
            "/auth/sso/google/callback/?code=abc&state=st-1"
        )
        _add_session_to_request(request)
        request.session["sso_state"] = "st-1"
        request.session["sso_link_user_id"] = link_user_id
        # The marker is claimed only when bound to this round trip's state.
        request.session["sso_link_state"] = "st-1"
        request.user = session_user
        return request

    def _call(self, request):
        from api.views.sso import SSOCallbackView

        return SSOCallbackView.as_view()(request, provider="google")

    def test_initiator_mismatch_fails_with_session_changed(self):
        other_user = _make_user(user_id="uuid-other")
        request = self._callback_request("uuid-initiator", other_user)
        response = self._call(request)

        self.assertEqual(response.status_code, 302)
        self.assertIn("/account?error=session_changed", response.url)

    def test_unauthenticated_callback_fails_with_session_changed(self):
        request = self._callback_request("uuid-initiator", AnonymousUser())
        response = self._call(request)

        self.assertEqual(response.status_code, 302)
        self.assertIn("/account?error=session_changed", response.url)

    def test_state_is_single_use(self):
        request = self._callback_request("uuid-initiator", AnonymousUser())
        self._call(request)
        self.assertNotIn("sso_state", request.session)

    def test_link_mode_errors_redirect_to_account(self):
        request = RequestFactory().get(
            "/auth/sso/google/callback/?error=access_denied"
        )
        _add_session_to_request(request)
        request.session["sso_link_user_id"] = "uuid-initiator"
        request.session["sso_link_state"] = "st-1"
        request.user = AnonymousUser()
        response = self._call(request)

        self.assertEqual(response.status_code, 302)
        # A pending link routes IdP-error failures to /account (peeked
        # marker); the marker is left for its own matching callback.
        self.assertIn("/account?error=", response.url)

    def test_mismatched_state_does_not_claim_link_marker(self):
        """A callback whose state doesn't match the pending link's state
        must not claim the marker — it dispatches as a login, and the
        marker is left intact for its own callback."""
        request = RequestFactory().get(
            "/auth/sso/google/callback/?code=abc&state=other-state"
        )
        _add_session_to_request(request)
        request.session["sso_state"] = "other-state"
        request.session["sso_link_user_id"] = "uuid-initiator"
        request.session["sso_link_state"] = "st-1"
        request.user = AnonymousUser()

        with patch(
            "api.views.sso._exchange_code_for_token", side_effect=Exception("stop")
        ):
            response = self._call(request)

        # The security property: a mismatched-state callback must NOT
        # consume the link marker — it survives intact for its own
        # matching round trip (so a concurrent login can't demote a link).
        self.assertEqual(response.status_code, 302)
        self.assertEqual(request.session.get("sso_link_user_id"), "uuid-initiator")
        self.assertEqual(request.session.get("sso_link_state"), "st-1")


class CompleteLinkTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    def _request(self, user):
        request = RequestFactory().get("/auth/sso/google/callback/")
        _add_session_to_request(request)
        request.user = user
        return request

    def _social_login(self, provider="google", uid="uid-new", extra=None):
        social_login = MagicMock()
        social_login.account.provider = provider
        social_login.account.uid = uid
        social_login.account.extra_data = extra or {
            "email": "alice@work.example",
            "name": "Alice",
        }
        return social_login

    @patch("api.emails.send_identity_linked_email")
    @patch("api.views.identity.log_org_identity_events")
    @patch("api.views.sso.login")
    @patch("api.views.sso.SocialToken")
    @patch("api.views.sso.SocialAccount")
    def test_link_creates_social_account_without_login(
        self, mock_sa, mock_token, mock_login, mock_audit, mock_email
    ):
        from api.views.sso import _complete_link

        user = _make_user()
        mock_sa.objects.filter.return_value.first.return_value = None

        result = _complete_link(
            self._request(user), self._social_login(), token=None
        )

        mock_sa.objects.create.assert_called_once_with(
            provider="google",
            uid="uid-new",
            user=user,
            extra_data={"email": "alice@work.example", "name": "Alice"},
        )
        mock_login.assert_not_called()
        mock_email.assert_called_once()
        mock_audit.assert_called_once()

    @patch("api.emails.send_identity_linked_email")
    @patch("api.views.identity.log_org_identity_events")
    @patch("api.views.sso.SocialToken")
    @patch("api.views.sso.SocialAccount")
    def test_relink_own_identity_is_idempotent(
        self, mock_sa, mock_token, mock_audit, mock_email
    ):
        from api.views.sso import _complete_link

        user = _make_user()
        existing = _mock_social_account(provider="google", uid="uid-1", user=user)
        mock_sa.objects.filter.return_value.first.return_value = existing

        _complete_link(
            self._request(user), self._social_login(uid="uid-1"), token=None
        )

        mock_sa.objects.create.assert_not_called()
        existing.save.assert_called_once_with(
            update_fields=["extra_data", "last_login"]
        )
        # No notification for a no-op refresh
        mock_email.assert_not_called()
        mock_audit.assert_not_called()

    @patch("api.views.sso.SocialToken")
    @patch("api.views.sso.SocialAccount")
    def test_link_refuses_identity_owned_by_another_user(self, mock_sa, mock_token):
        from api.views.sso import _complete_link

        user = _make_user(user_id="uuid-requester")
        owner = _make_user(user_id="uuid-owner")
        existing = _mock_social_account(provider="google", uid="uid-1", user=owner)
        mock_sa.objects.filter.return_value.first.return_value = existing

        with self.assertRaises(ValueError) as ctx:
            _complete_link(
                self._request(user), self._social_login(uid="uid-1"), token=None
            )
        self.assertEqual(str(ctx.exception), "identity_in_use")
        mock_sa.objects.create.assert_not_called()
        existing.save.assert_not_called()

    @patch("api.views.sso.SocialToken")
    @patch("api.views.sso.SocialAccount")
    def test_link_refuses_unverified_email(self, mock_sa, mock_token):
        from api.views.sso import _complete_link

        user = _make_user()
        social_login = self._social_login(
            extra={"email": "a@b.c", "email_verified": False}
        )
        with self.assertRaises(ValueError) as ctx:
            _complete_link(self._request(user), social_login, token=None)
        self.assertEqual(str(ctx.exception), "not_verified")
        mock_sa.objects.filter.assert_not_called()

    @patch("api.emails.send_identity_linked_email")
    @patch("api.views.identity.log_org_identity_events")
    @patch("api.views.sso.SocialToken")
    @patch("api.views.sso.SocialAccount")
    def test_same_provider_different_uid_is_allowed(
        self, mock_sa, mock_token, mock_audit, mock_email
    ):
        """The multi-tenant Microsoft case: a second identity on the same
        provider under a different uid links fine."""
        from api.views.sso import _complete_link

        user = _make_user()
        mock_sa.objects.filter.return_value.first.return_value = None

        _complete_link(
            self._request(user),
            self._social_login(provider="microsoft", uid="tenant-b-oid"),
            token=None,
        )

        mock_sa.objects.create.assert_called_once()

    @patch("api.models.OrganisationMember")
    @patch("api.views.sso.OrganisationSSOProvider")
    @patch("api.views.sso.SocialToken")
    @patch("api.views.sso.SocialAccount")
    def test_org_link_requires_membership(
        self, mock_sa, mock_token, mock_provider, mock_om
    ):
        from api.views.sso import _complete_link

        user = _make_user()
        org_provider = MagicMock()
        mock_provider.objects.select_related.return_value.get.return_value = (
            org_provider
        )
        mock_provider.DoesNotExist = Exception
        mock_om.objects.filter.return_value.exists.return_value = False

        with self.assertRaises(ValueError) as ctx:
            _complete_link(
                self._request(user),
                self._social_login(provider="microsoft"),
                token=None,
                org_config_id="cfg-1",
            )
        self.assertEqual(str(ctx.exception), "not_a_member")


# ---------------------------------------------------------------------------
# Org-SSO login gate: linked identity passes despite IdP email mismatch
# ---------------------------------------------------------------------------


class OrgGateLinkedIdentityTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    @patch("api.views.sso.stamp_auth_time")
    @patch("api.views.sso.login")
    @patch("api.models.OrganisationMemberInvite")
    @patch("api.models.OrganisationMember")
    @patch("api.views.sso.OrganisationSSOProvider")
    @patch("api.views.sso.SocialToken")
    @patch("api.views.sso.SocialAccount")
    def test_linked_uid_member_passes_gate_with_mismatched_email(
        self,
        mock_sa,
        mock_token,
        mock_provider,
        mock_om,
        mock_invite,
        mock_login,
        mock_stamp,
    ):
        """A member whose Entra email differs from their Phase email must
        still log in via org SSO once the identity is linked."""
        from api.views.sso import _complete_login_bypassing_allauth

        member_user = _make_user(email="alice@phase-account.example")
        linked_sa = _mock_social_account(
            provider="microsoft",
            uid="entra-oid-1",
            user=member_user,
            extra={"email": "alice@corp.example"},
        )

        org_provider = MagicMock()
        mock_provider.objects.select_related.return_value.get.return_value = (
            org_provider
        )
        mock_provider.DoesNotExist = Exception

        # Linked-identity gate: SocialAccount exists, its user is a member
        mock_sa.objects.filter.return_value.first.return_value = linked_sa
        mock_om.objects.filter.return_value.exists.return_value = True
        # (provider, uid) fast path resolves the linked user
        mock_sa.DoesNotExist = Exception
        mock_sa.objects.get.return_value = linked_sa

        social_login = MagicMock()
        social_login.account.provider = "microsoft"
        social_login.account.uid = "entra-oid-1"
        # IdP-claimed email differs from the Phase account email
        social_login.account.extra_data = {"email": "alice@corp.example"}
        social_login.user.email = "alice@corp.example"

        request = RequestFactory().get("/auth/sso/entra-id-oidc/callback/")
        _add_session_to_request(request)

        user = _complete_login_bypassing_allauth(
            request, social_login, token=None, org_config_id="cfg-1"
        )

        self.assertIs(user, member_user)
        # login() is the callback's responsibility now (TOTP deferral)
        mock_login.assert_not_called()
        # The email-based membership query was never needed
        mock_om.objects.filter.assert_called_once()


# ---------------------------------------------------------------------------
# Unlink — POST /auth/identities/unlink/
# ---------------------------------------------------------------------------


class UnlinkIdentityTest(unittest.TestCase):
    def setUp(self):
        cache.clear()

    def _post(self, body, user=None, fresh=True, content_type="application/json"):
        request = RequestFactory().post(
            "/auth/identities/unlink/",
            data=json.dumps(body),
            content_type=content_type,
        )
        _add_session_to_request(request)
        if fresh:
            _fresh_session(request)
        request.user = user if user is not None else AnonymousUser()
        return request

    def _call(self, request):
        from api.views.identity import unlink_identity

        return unlink_identity(request)

    def test_unauthenticated_returns_401(self):
        response = self._call(self._post({"accountId": "1"}))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)["code"], "unauthenticated")

    def test_stale_session_returns_reauth_required(self):
        user = _make_user()
        response = self._call(self._post({"accountId": "1"}, user=user, fresh=False))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)["code"], "reauth_required")

    @patch("api.views.identity.SocialAccount")
    def test_foreign_account_returns_404(self, mock_sa):
        from allauth.socialaccount.models import SocialAccount as RealSA

        user = _make_user()
        mock_sa.DoesNotExist = RealSA.DoesNotExist
        mock_sa.objects.get.side_effect = RealSA.DoesNotExist

        response = self._call(self._post({"accountId": "999"}, user=user))
        self.assertEqual(response.status_code, 404)
        mock_sa.objects.get.assert_called_once_with(pk="999", user=user)

    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    @patch("api.views.identity.SocialAccount")
    def test_last_method_is_refused(self, mock_sa, mock_enabled):
        user = _make_user()
        user.has_usable_password.return_value = True  # doesn't count when disabled
        sa = _mock_social_account(user=user)
        mock_sa.DoesNotExist = Exception
        mock_sa.objects.get.return_value = sa
        user.socialaccount_set.count.return_value = 1

        response = self._call(self._post({"accountId": "1"}, user=user))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "last_method")

    @patch("api.views.identity.send_identity_unlinked_email")
    @patch("api.views.identity.log_org_identity_events")
    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=True)
    @patch("api.views.identity.SocialToken")
    @patch("api.views.identity.SocialAccount")
    def test_usable_password_lifts_last_method_guard(
        self, mock_sa, mock_token, mock_enabled, mock_provider, mock_audit, mock_email
    ):
        user = _make_user()
        user.has_usable_password.return_value = True
        sa = _mock_social_account(user=user)
        mock_sa.DoesNotExist = Exception
        mock_sa.objects.get.return_value = sa
        user.socialaccount_set.count.return_value = 1
        mock_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = (
            []
        )

        response = self._call(self._post({"accountId": "1"}, user=user))
        self.assertEqual(response.status_code, 200)
        sa.delete.assert_called_once()
        mock_email.assert_called_once()

    @patch("api.views.identity.SCIMUser")
    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    @patch("api.views.identity.SocialToken")
    @patch("api.views.identity.SocialAccount")
    def test_enforced_org_provider_refuses_unlink(
        self, mock_sa, mock_token, mock_enabled, mock_provider, mock_scim
    ):
        user = _make_user()
        user.has_usable_password.return_value = False
        sa = _mock_social_account(provider="microsoft", user=user)
        mock_sa.DoesNotExist = Exception
        mock_sa.objects.get.return_value = sa
        user.socialaccount_set.count.return_value = 2

        org_provider = MagicMock()
        org_provider.provider_type = "entra_id"
        org_provider.organisation.name = "Acme"
        org_provider.organisation.require_sso = True
        mock_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = [
            org_provider
        ]

        response = self._call(self._post({"accountId": "1"}, user=user))
        self.assertEqual(response.status_code, 409)
        data = json.loads(response.content)
        self.assertEqual(data["code"], "org_enforced")
        self.assertEqual(data["organisation"], "Acme")
        sa.delete.assert_not_called()

    @patch("api.views.identity.SCIMUser")
    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    @patch("api.views.identity.SocialToken")
    @patch("api.views.identity.SocialAccount")
    def test_scim_managed_refuses_unlink(
        self, mock_sa, mock_token, mock_enabled, mock_provider, mock_scim
    ):
        user = _make_user()
        user.has_usable_password.return_value = False
        sa = _mock_social_account(provider="microsoft", user=user)
        mock_sa.DoesNotExist = Exception
        mock_sa.objects.get.return_value = sa
        user.socialaccount_set.count.return_value = 2

        org_provider = MagicMock()
        org_provider.provider_type = "entra_id"
        org_provider.organisation.name = "Acme"
        org_provider.organisation.require_sso = False
        mock_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = [
            org_provider
        ]
        mock_scim.objects.filter.return_value.exists.return_value = True

        response = self._call(self._post({"accountId": "1"}, user=user))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "scim_managed")

    @patch("api.views.identity.send_identity_unlinked_email")
    @patch("api.views.identity.log_org_identity_events")
    @patch("api.views.identity.OrganisationSSOProvider")
    @patch("api.views.auth_password._password_auth_enabled", return_value=False)
    @patch("api.views.identity.SocialToken")
    @patch("api.views.identity.SocialAccount")
    def test_unlink_happy_path_deletes_account_and_tokens(
        self, mock_sa, mock_token, mock_enabled, mock_provider, mock_audit, mock_email
    ):
        user = _make_user()
        user.has_usable_password.return_value = False
        sa = _mock_social_account(provider="github", user=user)
        mock_sa.DoesNotExist = Exception
        mock_sa.objects.get.return_value = sa
        user.socialaccount_set.count.return_value = 2
        mock_provider.objects.filter.return_value.select_related.return_value.distinct.return_value = (
            []
        )

        response = self._call(self._post({"accountId": "1"}, user=user))

        self.assertEqual(response.status_code, 200)
        mock_token.objects.filter.assert_called_once_with(account=sa)
        mock_token.objects.filter.return_value.delete.assert_called_once()
        sa.delete.assert_called_once()
        mock_email.assert_called_once()
        mock_audit.assert_called_once_with(unittest.mock.ANY, user, "github", "unlinked")

    def test_non_json_body_is_rejected(self):
        user = _make_user()
        request = RequestFactory().post(
            "/auth/identities/unlink/",
            data="accountId=1",
            content_type="application/x-www-form-urlencoded",
        )
        _add_session_to_request(request)
        _fresh_session(request)
        request.user = user

        response = self._call(request)
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
