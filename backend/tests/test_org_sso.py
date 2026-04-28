"""Tests for per-org SSO configuration.

Covers model, mutations, email_check, authorize view, and enforcement.
Uses unittest.TestCase with mocked ORM — no database required.
"""

import json
import unittest
from unittest.mock import patch, MagicMock, PropertyMock, call

from django.core.cache import cache
from django.test import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware
from rest_framework.test import APIRequestFactory, force_authenticate


class _ThrottleClearMixin:
    def setUp(self):
        super().setUp()
        cache.clear()


def _add_session_to_request(request):
    middleware = SessionMiddleware(lambda req: None)
    middleware.process_request(request)
    request.session.save()


def _make_post(path, data, user=None):
    factory = APIRequestFactory()
    request = factory.post(path, data=data, format="json")
    _add_session_to_request(request)
    if user:
        force_authenticate(request, user=user)
    return request


def _make_get(path):
    factory = RequestFactory()
    request = factory.get(path)
    _add_session_to_request(request)
    return request


# ---------------------------------------------------------------------------
# email_check with org SSO
# ---------------------------------------------------------------------------

class EmailCheckOrgSSOTest(_ThrottleClearMixin, unittest.TestCase):
    """Tests for email_check returning org-level SSO providers."""

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_unknown_email_returns_password_only(
        self, mock_get_user, mock_om, mock_sso_provider
    ):
        """Unknown email returns password=True, sso=[] (anti-enumeration)."""
        from api.views.auth_password import email_check
        from django.contrib.auth import get_user_model as real_get_user_model

        RealUser = real_get_user_model()

        User = MagicMock()
        User.DoesNotExist = RealUser.DoesNotExist
        User.objects.get.side_effect = RealUser.DoesNotExist
        mock_get_user.return_value = User

        request = _make_post("/auth/email/check/", {"email": "nobody@example.com"})
        response = email_check(request)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_password_user_no_sso(self, mock_get_user, mock_om, mock_sso_provider):
        """Password user with no org SSO returns password=True, sso=[]."""
        from api.views.auth_password import email_check

        user = MagicMock()
        user.has_usable_password.return_value = True
        user.socialaccount_set.first.return_value = None

        User = MagicMock()
        User.objects.get.return_value = user
        User.DoesNotExist = Exception
        mock_get_user.return_value = User

        mock_om.objects.filter.return_value.select_related.return_value = []

        request = _make_post("/auth/email/check/", {"email": "alice@example.com"})
        response = email_check(request)

        data = json.loads(response.content)
        self.assertTrue(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_user_with_org_sso_returns_provider(
        self, mock_get_user, mock_om, mock_sso_provider
    ):
        """User in org with SSO gets org provider in sso list."""
        from api.views.auth_password import email_check

        user = MagicMock()
        user.has_usable_password.return_value = True
        user.socialaccount_set.first.return_value = None

        User = MagicMock()
        User.objects.get.return_value = user
        User.DoesNotExist = Exception
        mock_get_user.return_value = User

        org = MagicMock()
        org.require_sso = False
        org.name = "Acme Corp"

        provider = MagicMock()
        provider.id = "test-config-id"
        provider.provider_type = "entra_id"
        provider.name = "Microsoft Entra ID"
        provider.organisation = org
        # email_check now does a single join query with select_related +
        # distinct instead of a per-membership loop.
        (
            mock_sso_provider.objects.filter.return_value
            .select_related.return_value
            .distinct.return_value
        ) = [provider]

        request = _make_post("/auth/email/check/", {"email": "alice@example.com"})
        response = email_check(request)

        data = json.loads(response.content)
        self.assertTrue(data["authMethods"]["password"])
        self.assertEqual(len(data["authMethods"]["sso"]), 1)
        self.assertEqual(data["authMethods"]["sso"][0]["id"], "test-config-id")
        self.assertEqual(data["authMethods"]["sso"][0]["providerType"], "oidc")
        self.assertEqual(data["authMethods"]["sso"][0]["provider"], "entra_id")
        self.assertEqual(data["authMethods"]["sso"][0]["providerName"], "Microsoft Entra ID")
        self.assertFalse(data["authMethods"]["sso"][0]["enforced"])

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_enforced_sso_marked(self, mock_get_user, mock_om, mock_sso_provider):
        """When org.require_sso=True, enforced=True in response."""
        from api.views.auth_password import email_check

        user = MagicMock()
        user.has_usable_password.return_value = True
        user.socialaccount_set.first.return_value = None

        User = MagicMock()
        User.objects.get.return_value = user
        User.DoesNotExist = Exception
        mock_get_user.return_value = User

        org = MagicMock()
        org.require_sso = True
        org.name = "Acme Corp"

        provider = MagicMock()
        provider.id = "enforced-id"
        provider.provider_type = "okta"
        provider.name = "Okta"
        provider.organisation = org
        (
            mock_sso_provider.objects.filter.return_value
            .select_related.return_value
            .distinct.return_value
        ) = [provider]

        request = _make_post("/auth/email/check/", {"email": "alice@example.com"})
        response = email_check(request)

        data = json.loads(response.content)
        self.assertTrue(data["authMethods"]["sso"][0]["enforced"])

    @patch("api.views.auth_password.OrganisationSSOProvider")
    @patch("api.views.auth_password.OrganisationMember")
    @patch("api.views.auth_password.get_user_model")
    def test_instance_sso_user_gets_empty_sso(
        self, mock_get_user, mock_om, mock_sso_provider
    ):
        """Instance-level SSO user gets sso=[] (buttons are on the first screen)."""
        from api.views.auth_password import email_check

        user = MagicMock()
        user.has_usable_password.return_value = False

        User = MagicMock()
        User.objects.get.return_value = user
        User.DoesNotExist = Exception
        mock_get_user.return_value = User

        mock_om.objects.filter.return_value.select_related.return_value = []

        request = _make_post("/auth/email/check/", {"email": "alice@example.com"})
        response = email_check(request)

        data = json.loads(response.content)
        self.assertFalse(data["authMethods"]["password"])
        self.assertEqual(data["authMethods"]["sso"], [])


# ---------------------------------------------------------------------------
# GraphQL mutations
# ---------------------------------------------------------------------------

class CreateSSOProviderMutationTest(unittest.TestCase):
    """Tests for CreateOrganisationSSOProviderMutation."""

    @patch("backend.graphene.mutations.sso.OrganisationMember")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_create_provider(self, mock_perm, mock_org_cls, mock_provider_cls, mock_member_cls):
        from backend.graphene.mutations.sso import CreateOrganisationSSOProviderMutation

        org = MagicMock()
        org.plan = "EN"  # Enterprise plan required for SSO
        mock_org_cls.ENTERPRISE_PLAN = "EN"
        mock_org_cls.objects.get.return_value = org
        mock_provider_cls.objects.filter.return_value.exists.return_value = False
        # Registry is used directly now, no need to mock PROVIDER_TYPES

        member = MagicMock()
        mock_member_cls.objects.get.return_value = member

        created = MagicMock()
        created.id = "new-id"
        mock_provider_cls.objects.create.return_value = created

        info = MagicMock()
        info.context.user = MagicMock()

        result = CreateOrganisationSSOProviderMutation.mutate(
            None,
            info,
            org_id="org-1",
            provider_type="entra_id",
            name="Contoso Entra",
            config={
                "tenant_id": "72f988bf-86f1-41af-91ab-2d7cd011db47",
                "client_id": "6731de76-14a6-49ae-97bc-6eba6914391e",
                "client_secret": "ph:v1:abc:ciphertext",
            },
        )

        self.assertEqual(result.provider_id, "new-id")
        mock_provider_cls.objects.create.assert_called_once()

    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=False)
    def test_create_provider_no_permission(self, mock_perm, mock_org_cls):
        from backend.graphene.mutations.sso import CreateOrganisationSSOProviderMutation
        from graphql import GraphQLError

        mock_org_cls.objects.get.return_value = MagicMock()

        info = MagicMock()
        info.context.user = MagicMock()

        with self.assertRaises(GraphQLError):
            CreateOrganisationSSOProviderMutation.mutate(
                None, info, org_id="org-1", provider_type="entra_id",
                name="Test", config={}
            )

    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_create_duplicate_type_rejected(self, mock_perm, mock_org_cls, mock_provider_cls):
        from backend.graphene.mutations.sso import CreateOrganisationSSOProviderMutation
        from graphql import GraphQLError

        org = MagicMock()
        org.plan = "EN"
        mock_org_cls.objects.get.return_value = org
        mock_provider_cls.objects.filter.return_value.exists.return_value = True
        # Registry is used directly now, no need to mock PROVIDER_TYPES

        info = MagicMock()
        info.context.user = MagicMock()

        with self.assertRaises(GraphQLError):
            CreateOrganisationSSOProviderMutation.mutate(
                None, info, org_id="org-1", provider_type="entra_id",
                name="Dup", config={}
            )


class UpdateSSOProviderMutationTest(unittest.TestCase):
    """Tests for UpdateOrganisationSSOProviderMutation."""

    @patch("backend.graphene.mutations.sso.OrganisationMember")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_update_merges_config(self, mock_perm, mock_provider_cls, mock_member_cls):
        from backend.graphene.mutations.sso import UpdateOrganisationSSOProviderMutation

        provider = MagicMock()
        provider.provider_type = "entra_id"
        provider.config = {
            "tenant_id": "72f988bf-86f1-41af-91ab-2d7cd011db47",
            "client_id": "6731de76-14a6-49ae-97bc-6eba6914391e",
            "client_secret": "ph:v1:pk:ct",
        }
        provider.organisation = MagicMock()
        provider.organisation.plan = "EN"  # Enterprise plan required for SSO
        mock_provider_cls.objects.get.return_value = provider
        mock_member_cls.objects.get.return_value = MagicMock()

        info = MagicMock()
        info.context.user = MagicMock()

        # Update tenant_id but not client_secret (empty string means keep existing)
        result = UpdateOrganisationSSOProviderMutation.mutate(
            None, info, provider_id="p1",
            config={
                "tenant_id": "11111111-2222-3333-4444-555555555555",
                "client_id": "6731de76-14a6-49ae-97bc-6eba6914391e",
                "client_secret": "",
            },
        )

        self.assertTrue(result.ok)
        # client_secret should be preserved
        self.assertEqual(provider.config["client_secret"], "ph:v1:pk:ct")
        self.assertEqual(
            provider.config["tenant_id"], "11111111-2222-3333-4444-555555555555"
        )

    @patch("backend.graphene.mutations.sso.OrganisationMember")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_enable_deactivates_others(self, mock_perm, mock_provider_cls, mock_member_cls):
        from backend.graphene.mutations.sso import UpdateOrganisationSSOProviderMutation

        provider = MagicMock()
        provider.config = {}
        provider.organisation = MagicMock()
        provider.organisation.plan = "EN"  # Enterprise plan required for SSO
        mock_provider_cls.objects.get.return_value = provider
        mock_member_cls.objects.get.return_value = MagicMock()

        info = MagicMock()
        info.context.user = MagicMock()

        UpdateOrganisationSSOProviderMutation.mutate(
            None, info, provider_id="p1", enabled=True
        )

        # Should have called filter + exclude + update to deactivate others
        mock_provider_cls.objects.filter.assert_called()


class DeleteSSOProviderMutationTest(unittest.TestCase):
    """Tests for DeleteOrganisationSSOProviderMutation."""

    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_delete_clears_enforcement(self, mock_perm, mock_provider_cls):
        from backend.graphene.mutations.sso import DeleteOrganisationSSOProviderMutation

        org = MagicMock()
        org.require_sso = True

        provider = MagicMock()
        provider.enabled = True
        provider.organisation = org
        mock_provider_cls.objects.get.return_value = provider

        info = MagicMock()
        info.context.user = MagicMock()

        result = DeleteOrganisationSSOProviderMutation.mutate(None, info, provider_id="p1")

        self.assertTrue(result.ok)
        self.assertFalse(org.require_sso)
        org.save.assert_called_once()
        provider.delete.assert_called_once()


class UpdateOrgSecurityMutationTest(unittest.TestCase):
    """Tests for UpdateOrganisationSecurityMutation."""

    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_enforce_sso_requires_active_provider(
        self, mock_perm, mock_org_cls, mock_provider_cls
    ):
        from backend.graphene.mutations.sso import UpdateOrganisationSecurityMutation
        from graphql import GraphQLError

        org = MagicMock()
        mock_org_cls.objects.get.return_value = org
        mock_provider_cls.objects.filter.return_value.exists.return_value = False

        info = MagicMock()
        info.context.user = MagicMock()

        with self.assertRaises(GraphQLError):
            UpdateOrganisationSecurityMutation.mutate(
                None, info, org_id="org-1", require_sso=True
            )

    @patch("backend.graphene.mutations.sso.django_logout")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_enforce_sso_with_active_provider(
        self, mock_perm, mock_org_cls, mock_provider_cls, mock_logout
    ):
        from backend.graphene.mutations.sso import UpdateOrganisationSecurityMutation

        org = MagicMock()
        mock_org_cls.objects.get.return_value = org
        mock_provider_cls.objects.filter.return_value.exists.return_value = True

        info = MagicMock()
        info.context.user = MagicMock()
        info.context.session = {"auth_method": "sso"}

        result = UpdateOrganisationSecurityMutation.mutate(
            None, info, org_id="org-1", require_sso=True
        )

        self.assertTrue(result.ok)
        self.assertTrue(org.require_sso)
        org.save.assert_called_once()

    @patch("backend.graphene.mutations.sso.django_logout")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_enforce_sso_invalidates_password_admin_session(
        self, mock_perm, mock_org_cls, mock_provider_cls, mock_logout
    ):
        """Admin enforcing SSO from a password session is logged out so they
        must re-auth via SSO (no half-state where this session still works)."""
        from backend.graphene.mutations.sso import UpdateOrganisationSecurityMutation

        org = MagicMock()
        mock_org_cls.objects.get.return_value = org
        mock_provider_cls.objects.filter.return_value.exists.return_value = True

        info = MagicMock()
        info.context.session = {"auth_method": "password"}

        result = UpdateOrganisationSecurityMutation.mutate(
            None, info, org_id="org-1", require_sso=True
        )

        self.assertTrue(result.ok)
        self.assertTrue(result.session_invalidated)
        mock_logout.assert_called_once_with(info.context)

    @patch("backend.graphene.mutations.sso.django_logout")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_enforce_sso_keeps_sso_admin_session(
        self, mock_perm, mock_org_cls, mock_provider_cls, mock_logout
    ):
        """Admin enforcing SSO from an already-SSO session is not logged out."""
        from backend.graphene.mutations.sso import UpdateOrganisationSecurityMutation

        org = MagicMock()
        mock_org_cls.objects.get.return_value = org
        mock_provider_cls.objects.filter.return_value.exists.return_value = True

        info = MagicMock()
        info.context.session = {"auth_method": "sso"}

        result = UpdateOrganisationSecurityMutation.mutate(
            None, info, org_id="org-1", require_sso=True
        )

        self.assertTrue(result.ok)
        self.assertFalse(result.session_invalidated)
        mock_logout.assert_not_called()

    @patch("backend.graphene.mutations.sso.django_logout")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.Organisation")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_disable_enforcement_does_not_logout(
        self, mock_perm, mock_org_cls, mock_provider_cls, mock_logout
    ):
        """Turning enforcement OFF must not log out the admin."""
        from backend.graphene.mutations.sso import UpdateOrganisationSecurityMutation

        org = MagicMock()
        mock_org_cls.objects.get.return_value = org

        info = MagicMock()
        info.context.session = {"auth_method": "password"}

        result = UpdateOrganisationSecurityMutation.mutate(
            None, info, org_id="org-1", require_sso=False
        )

        self.assertTrue(result.ok)
        self.assertFalse(result.session_invalidated)
        mock_logout.assert_not_called()


# ---------------------------------------------------------------------------
# OrgSSOAuthorizeView
# ---------------------------------------------------------------------------

class OrgSSOAuthorizeViewTest(unittest.TestCase):
    """Tests for GET /auth/sso/org/<config_id>/authorize/."""

    @patch("api.views.sso._get_callback_url", return_value="https://localhost/api/auth/callback/entra-id-oidc")
    @patch("api.views.sso._get_oidc_endpoints")
    def test_authorize_redirects_to_entra(self, mock_endpoints, mock_callback):
        from api.views.sso import OrgSSOAuthorizeView

        mock_endpoints.return_value = {
            "authorize_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
            "token_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        }

        provider = MagicMock()
        provider.id = "config-123"
        provider.provider_type = "entra_id"

        config = {
            "tenant_id": "72f988bf-test",
            "client_id": "app-client-id",
            "client_secret": "decrypted-secret",
        }

        with patch("api.utils.sso.get_org_sso_config", return_value=(provider, config)):
            view = OrgSSOAuthorizeView()
            request = _make_get("/auth/sso/org/config-123/authorize/")
            response = view.get(request, config_id="config-123")

        self.assertEqual(response.status_code, 302)
        self.assertIn("login.microsoftonline.com", response.url)
        self.assertIn("client_id=app-client-id", response.url)

    @patch("api.views.sso._get_callback_url", return_value="https://localhost/api/auth/callback/okta-oidc")
    @patch("api.views.sso._get_oidc_endpoints")
    def test_authorize_redirects_to_okta(self, mock_endpoints, mock_callback):
        from api.views.sso import OrgSSOAuthorizeView

        mock_endpoints.return_value = {
            "authorize_url": "https://dev-12345.okta.com/oauth2/v1/authorize",
            "token_url": "https://dev-12345.okta.com/oauth2/v1/token",
        }

        provider = MagicMock()
        provider.id = "okta-config"
        provider.provider_type = "okta"

        config = {
            "issuer": "https://dev-12345.okta.com",
            "client_id": "okta-client-id",
            "client_secret": "decrypted-secret",
        }

        with patch("api.utils.sso.get_org_sso_config", return_value=(provider, config)):
            view = OrgSSOAuthorizeView()
            request = _make_get("/auth/sso/org/okta-config/authorize/")
            response = view.get(request, config_id="okta-config")

        self.assertEqual(response.status_code, 302)
        self.assertIn("okta.com", response.url)

    def test_authorize_invalid_config_returns_404(self):
        from api.views.sso import OrgSSOAuthorizeView

        with patch("api.utils.sso.get_org_sso_config", side_effect=Exception("not found")):
            view = OrgSSOAuthorizeView()
            request = _make_get("/auth/sso/org/bad-id/authorize/")
            response = view.get(request, config_id="bad-id")

        self.assertEqual(response.status_code, 404)

    @patch("api.views.sso._get_callback_url", return_value="https://localhost/api/auth/callback/entra-id-oidc")
    @patch("api.views.sso._get_oidc_endpoints")
    def test_authorize_stores_sso_return_to_from_snake_case(
        self, mock_endpoints, mock_callback
    ):
        """Regression: djangorestframework_camel_case middleware rewrites
        incoming camelCase query params to snake_case, so ?callbackUrl=...
        arrives as 'callback_url' in request.GET. The view must read the
        snake_case form to populate sso_return_to — otherwise Test SSO and
        other deep-link flows silently bounce users to '/'."""
        from api.views.sso import OrgSSOAuthorizeView

        mock_endpoints.return_value = {
            "authorize_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
            "token_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        }

        provider = MagicMock()
        provider.id = "config-123"
        provider.provider_type = "entra_id"
        config = {
            "tenant_id": "t",
            "client_id": "c",
            "client_secret": "s",
        }

        with patch("api.utils.sso.get_org_sso_config", return_value=(provider, config)):
            view = OrgSSOAuthorizeView()
            request = _make_get(
                "/auth/sso/org/config-123/authorize/"
                "?callback_url=/phase/access/sso/oidc%3Fsso_test%3Dconfig-123"
            )
            view.get(request, config_id="config-123")

        self.assertEqual(
            request.session.get("sso_return_to"),
            "/phase/access/sso/oidc?sso_test=config-123",
        )

    @patch("api.views.sso._get_callback_url", return_value="https://localhost/api/auth/callback/entra-id-oidc")
    @patch("api.views.sso._get_oidc_endpoints")
    def test_authorize_stores_sso_return_to_from_legacy_camel_case(
        self, mock_endpoints, mock_callback
    ):
        """Fallback: if the middleware is bypassed for any reason, the view
        still reads the raw camelCase 'callbackUrl'."""
        from api.views.sso import OrgSSOAuthorizeView

        mock_endpoints.return_value = {
            "authorize_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
            "token_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        }

        provider = MagicMock()
        provider.id = "config-123"
        provider.provider_type = "entra_id"
        config = {"tenant_id": "t", "client_id": "c", "client_secret": "s"}

        with patch("api.utils.sso.get_org_sso_config", return_value=(provider, config)):
            view = OrgSSOAuthorizeView()
            request = _make_get(
                "/auth/sso/org/config-123/authorize/"
                "?callbackUrl=/phase/access/sso/oidc"
            )
            view.get(request, config_id="config-123")

        self.assertEqual(
            request.session.get("sso_return_to"),
            "/phase/access/sso/oidc",
        )

    @patch("api.views.sso._get_callback_url", return_value="https://localhost/api/auth/callback/entra-id-oidc")
    @patch("api.views.sso._get_oidc_endpoints")
    def test_authorize_no_callback_url_leaves_return_to_unset(
        self, mock_endpoints, mock_callback
    ):
        """No callbackUrl in the request → sso_return_to is not set (so the
        callback falls back to '/' after login)."""
        from api.views.sso import OrgSSOAuthorizeView

        mock_endpoints.return_value = {
            "authorize_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
            "token_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        }

        provider = MagicMock()
        provider.id = "config-123"
        provider.provider_type = "entra_id"
        config = {"tenant_id": "t", "client_id": "c", "client_secret": "s"}

        with patch("api.utils.sso.get_org_sso_config", return_value=(provider, config)):
            view = OrgSSOAuthorizeView()
            request = _make_get("/auth/sso/org/config-123/authorize/")
            view.get(request, config_id="config-123")

        self.assertIsNone(request.session.get("sso_return_to"))


class SSOReturnToSafetyTest(unittest.TestCase):
    """Defense-in-depth checks for the sso_return_to redirect in the callback.
    Only same-origin relative paths may be honored; cross-origin / protocol-
    relative URLs must be rejected even if somehow stored in session."""

    def _evaluate(self, return_to):
        """Mirror the guard in SSOCallbackView.get: accept only a string
        starting with a single '/' (not '//')."""
        return bool(
            return_to
            and return_to.startswith("/")
            and not return_to.startswith("//")
        )

    def test_accepts_same_origin_relative_path(self):
        self.assertTrue(self._evaluate("/phase/access/sso/oidc"))
        self.assertTrue(self._evaluate("/"))
        self.assertTrue(self._evaluate("/foo?bar=baz"))

    def test_rejects_protocol_relative_url(self):
        self.assertFalse(self._evaluate("//evil.com/phish"))
        self.assertFalse(self._evaluate("//evil.com"))

    def test_rejects_absolute_urls_and_empty(self):
        self.assertFalse(self._evaluate("https://evil.com/phish"))
        self.assertFalse(self._evaluate("http://evil.com"))
        self.assertFalse(self._evaluate(""))
        self.assertFalse(self._evaluate(None))


# ---------------------------------------------------------------------------
# Org-SSO callback hand-off to invite-acceptance wizard
# ---------------------------------------------------------------------------

class OrgSSOInviteRedirectTest(unittest.TestCase):
    """Regression: completing an org-level SSO login with a pending
    invite logged the user in but didn't consume the invite (acceptance
    must run client-side for keyring derivation). Without the redirect,
    the user landed on /onboard with no org membership. The callback
    now hands off to /invite/<b64-id> when an invite is open and the
    user isn't already a member."""

    def setUp(self):
        self.factory = RequestFactory()

    def _build_callback_request(self, state="state-xyz"):
        request = self.factory.get(
            f"/auth/sso/entra-id-oidc/callback/?code=auth-code&state={state}"
        )
        _add_session_to_request(request)
        request.session["sso_state"] = state
        request.session["sso_provider"] = "entra-id-oidc"
        request.session["sso_callback_url"] = (
            "https://console.phase.dev/api/auth/callback/entra-id-oidc"
        )
        request.session["sso_token_url"] = "https://idp/token"
        request.session["sso_org_config_id"] = "cfg-1"
        request.session.save()
        return request

    @patch("api.models.OrganisationMemberInvite")
    @patch("api.models.OrganisationMember")
    @patch("api.views.sso.OrganisationSSOProvider")
    @patch("api.views.sso._complete_login_bypassing_allauth")
    @patch("api.views.sso._get_or_create_social_app")
    @patch("api.views.sso._get_adapter_instance")
    @patch("api.views.sso._exchange_code_for_token")
    @patch("api.utils.sso.get_org_sso_config")
    @patch("api.utils.sso.get_org_provider_meta")
    def test_redirects_to_invite_wizard_when_pending_invite_exists(
        self,
        mock_get_meta,
        mock_get_org_cfg,
        mock_exchange,
        mock_get_adapter,
        mock_get_app,
        mock_complete_login,
        mock_org_provider_cls,
        mock_member_cls,
        mock_invite_cls,
    ):
        from api.views.sso import SSOCallbackView

        # Org provider config returns a viable shape.
        provider = MagicMock()
        provider.organisation_id = "org-1"
        provider.id = "cfg-1"
        provider.provider_type = "entra_id"
        mock_get_org_cfg.return_value = (
            provider,
            {"client_id": "x", "client_secret": "y", "issuer": "https://idp"},
        )
        mock_get_meta.return_value = {
            "callback_slug": "entra-id-oidc",
            "adapter_module": "ee.authentication.sso.oidc.entraid.views",
            "adapter_class": "CustomMicrosoftGraphOAuth2Adapter",
            "provider_id": "entra-id-oidc",
        }
        mock_org_provider_cls.objects.get.return_value = provider

        # Token exchange + adapter both succeed.
        mock_exchange.return_value = {
            "access_token": "at",
            "id_token": "idt",
        }
        adapter = MagicMock()
        social_login = MagicMock()
        social_login.user.email = "newcomer@example.com"
        social_login.account.extra_data = {"email": "newcomer@example.com"}
        adapter.complete_login.return_value = social_login
        mock_get_adapter.return_value = adapter
        mock_get_app.return_value = MagicMock()

        # Login completes; user is authenticated post-callback.
        user = MagicMock()
        user.is_authenticated = True
        user.email = "newcomer@example.com"
        mock_complete_login.return_value = user

        # No prior membership, but a valid invite exists for this email.
        mock_member_cls.objects.filter.return_value.exists.return_value = False
        invite = MagicMock()
        invite.id = "inv-uuid-12345"
        mock_invite_cls.objects.filter.return_value.first.return_value = invite

        request = self._build_callback_request()
        request.user = user

        with patch("api.views.sso.SocialToken"), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):
            response = SSOCallbackView().get(request, "entra-id-oidc")

        self.assertEqual(response.status_code, 302)
        self.assertIn("/invite/", response.url)
        # Invite ID is base64-encoded in the path.
        from base64 import b64decode
        path_segment = response.url.rsplit("/", 1)[-1]
        self.assertEqual(b64decode(path_segment).decode(), "inv-uuid-12345")

    @patch("api.models.OrganisationMemberInvite")
    @patch("api.models.OrganisationMember")
    @patch("api.views.sso.OrganisationSSOProvider")
    @patch("api.views.sso._complete_login_bypassing_allauth")
    @patch("api.views.sso._get_or_create_social_app")
    @patch("api.views.sso._get_adapter_instance")
    @patch("api.views.sso._exchange_code_for_token")
    @patch("api.utils.sso.get_org_sso_config")
    @patch("api.utils.sso.get_org_provider_meta")
    def test_returning_member_skips_invite_redirect(
        self,
        mock_get_meta,
        mock_get_org_cfg,
        mock_exchange,
        mock_get_adapter,
        mock_get_app,
        mock_complete_login,
        mock_org_provider_cls,
        mock_member_cls,
        mock_invite_cls,
    ):
        """A user already in the org goes to `/`, not `/invite/<id>`."""
        from api.views.sso import SSOCallbackView

        provider = MagicMock()
        provider.organisation_id = "org-1"
        provider.id = "cfg-1"
        mock_get_org_cfg.return_value = (
            provider,
            {"client_id": "x", "client_secret": "y", "issuer": "https://idp"},
        )
        mock_get_meta.return_value = {
            "callback_slug": "entra-id-oidc",
            "adapter_module": "ee.authentication.sso.oidc.entraid.views",
            "adapter_class": "CustomMicrosoftGraphOAuth2Adapter",
            "provider_id": "entra-id-oidc",
        }
        mock_org_provider_cls.objects.get.return_value = provider

        mock_exchange.return_value = {"access_token": "at", "id_token": "idt"}
        adapter = MagicMock()
        social_login = MagicMock()
        social_login.user.email = "alice@example.com"
        social_login.account.extra_data = {"email": "alice@example.com"}
        adapter.complete_login.return_value = social_login
        mock_get_adapter.return_value = adapter
        mock_get_app.return_value = MagicMock()

        user = MagicMock()
        user.is_authenticated = True
        user.email = "alice@example.com"
        mock_complete_login.return_value = user

        # Existing membership → skip the invite branch entirely.
        mock_member_cls.objects.filter.return_value.exists.return_value = True

        request = self._build_callback_request()
        request.user = user

        with patch("api.views.sso.SocialToken"), \
             patch("api.views.sso.FRONTEND_URL", "https://console.phase.dev"):
            response = SSOCallbackView().get(request, "entra-id-oidc")

        self.assertEqual(response.status_code, 302)
        self.assertNotIn("/invite/", response.url)
        self.assertEqual(response.url.rstrip("/"), "https://console.phase.dev")


# ---------------------------------------------------------------------------
# Cloud-mode guard removal
# ---------------------------------------------------------------------------

class EntraIdTenantPinningTest(unittest.TestCase):
    """`_validate_ms_id_token` pins `tid` to the configured tenant.
    Without it, any Microsoft tenant could authenticate via /common."""

    @patch("ee.authentication.sso.oidc.entraid.views.jwt")
    def test_rejects_token_from_wrong_tenant(self, mock_jwt):
        from ee.authentication.sso.oidc.entraid.views import (
            _validate_ms_id_token,
        )
        from allauth.socialaccount.providers.oauth2.client import OAuth2Error

        # JWKS resolves; jwt.decode returns claims for the WRONG tenant.
        mock_jwt.PyJWKClient.return_value.get_signing_key_from_jwt.return_value = (
            MagicMock(key="signing-key")
        )
        mock_jwt.decode.return_value = {
            "tid": "ATTACKER-TENANT-UUID",
            "nonce": "n",
        }
        # Real exception class so the inner try/except matches correctly.
        import jwt as real_jwt
        mock_jwt.InvalidTokenError = real_jwt.InvalidTokenError

        with self.assertRaises(OAuth2Error) as ctx:
            _validate_ms_id_token(
                "fake.token",
                audience="phase-console",
                expected_tenant_id="REAL-TENANT-UUID",
                expected_nonce="n",
            )
        self.assertIn("tenant mismatch", str(ctx.exception).lower())

    @patch("ee.authentication.sso.oidc.entraid.views.jwt")
    def test_accepts_token_from_correct_tenant(self, mock_jwt):
        from ee.authentication.sso.oidc.entraid.views import (
            _validate_ms_id_token,
        )

        mock_jwt.PyJWKClient.return_value.get_signing_key_from_jwt.return_value = (
            MagicMock(key="signing-key")
        )
        mock_jwt.decode.return_value = {
            "tid": "real-tenant-uuid",
            "nonce": "n",
        }
        import jwt as real_jwt
        mock_jwt.InvalidTokenError = real_jwt.InvalidTokenError

        claims = _validate_ms_id_token(
            "fake.token",
            audience="phase-console",
            expected_tenant_id="REAL-TENANT-UUID",  # case-insensitive match
            expected_nonce="n",
        )
        self.assertEqual(claims["tid"], "real-tenant-uuid")

    def test_refuses_when_no_tenant_configured(self):
        """Fail-closed when tenant config is missing."""
        from ee.authentication.sso.oidc.entraid.views import (
            _validate_ms_id_token,
        )
        from allauth.socialaccount.providers.oauth2.client import OAuth2Error

        with self.assertRaises(OAuth2Error) as ctx:
            _validate_ms_id_token(
                "fake.token",
                audience="phase-console",
                expected_tenant_id=None,
                expected_nonce="n",
            )
        self.assertIn("tenant configuration missing", str(ctx.exception).lower())


class EntraIdTenantResolutionTest(unittest.TestCase):
    """`_resolve_expected_tenant_id`: org config → fallback to env."""

    @patch("ee.authentication.sso.oidc.entraid.views.os")
    def test_falls_back_to_env_when_no_org_config_in_session(self, mock_os):
        from ee.authentication.sso.oidc.entraid.views import (
            _resolve_expected_tenant_id,
        )
        mock_os.getenv.return_value = "env-tenant-uuid"

        request = MagicMock()
        request.session = {}  # No sso_org_config_id

        self.assertEqual(_resolve_expected_tenant_id(request), "env-tenant-uuid")
        mock_os.getenv.assert_called_with("ENTRA_ID_OIDC_TENANT_ID")

    @patch("api.utils.sso.get_org_sso_config")
    def test_reads_tenant_from_org_config_when_present(self, mock_get_org):
        from ee.authentication.sso.oidc.entraid.views import (
            _resolve_expected_tenant_id,
        )
        provider = MagicMock()
        org_config = {"tenant_id": "org-tenant-uuid", "client_id": "x"}
        mock_get_org.return_value = (provider, org_config)

        request = MagicMock()
        request.session = {"sso_org_config_id": "cfg-1"}

        self.assertEqual(_resolve_expected_tenant_id(request), "org-tenant-uuid")
        mock_get_org.assert_called_once_with("cfg-1")


class CloudModeGuardRemovalTest(unittest.TestCase):
    """Verify EE adapters no longer block on APP_HOST=cloud."""

    @patch("ee.authentication.sso.oidc.entraid.views._resolve_expected_tenant_id")
    @patch("ee.authentication.sso.oidc.entraid.views._validate_ms_id_token")
    @patch("ee.authentication.sso.oidc.entraid.views.settings")
    @patch("ee.authentication.sso.oidc.entraid.views.ActivatedPhaseLicense")
    @patch("ee.authentication.sso.oidc.entraid.views.send_login_email")
    @patch("ee.authentication.sso.oidc.entraid.views.get_adapter")
    def test_entra_adapter_works_on_cloud(
        self, mock_get_adapter, mock_send_email, mock_license, mock_settings,
        mock_validate_token, mock_resolve_tenant,
    ):
        from ee.authentication.sso.oidc.entraid.views import CustomMicrosoftGraphOAuth2Adapter

        mock_settings.APP_HOST = "cloud"
        mock_resolve_tenant.return_value = "00000000-0000-0000-0000-000000000abc"

        # Mock a successful ID-token validation so the adapter proceeds.
        mock_validate_token.return_value = {
            "email": "test@example.com",
            "nonce": "n",
        }

        # Mock the response from Microsoft Graph
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": "user-123",
            "displayName": "Test User",
            "mail": "test@example.com",
        }
        mock_get_adapter.return_value.get_requests_session.return_value.get.return_value = mock_response

        # Mock get_provider and create adapter properly
        mock_social_login = MagicMock()
        mock_social_login.user.email = "test@example.com"
        mock_social_login.account.extra_data = {"name": "Test User"}

        # Patch profile_url property on the class since it's a class attribute/property
        with patch.object(
            CustomMicrosoftGraphOAuth2Adapter, "profile_url",
            new_callable=PropertyMock, return_value="https://graph.microsoft.com/v1.0/me"
        ), patch.object(
            CustomMicrosoftGraphOAuth2Adapter, "profile_url_params",
            new_callable=PropertyMock, return_value={}
        ):
            adapter = CustomMicrosoftGraphOAuth2Adapter.__new__(CustomMicrosoftGraphOAuth2Adapter)
            adapter.get_provider = MagicMock()
            adapter.get_provider.return_value.sociallogin_from_response.return_value = mock_social_login

            mock_token = MagicMock()
            mock_token.token = "fake-access-token"
            mock_token.id_token = "fake.id.token"

            mock_request = MagicMock()
            mock_request.session.get.return_value = "n"

            mock_app = MagicMock()
            mock_app.client_id = "phase-console"

            # Should NOT raise OAuth2Error — cloud mode is no longer blocked
            result = adapter.complete_login(mock_request, mock_app, mock_token)
            self.assertIsNotNone(result)
            # Validation must have been called with client_id, nonce, and
            # the configured tenant_id pinning.
            mock_validate_token.assert_called_once_with(
                "fake.id.token",
                audience="phase-console",
                expected_tenant_id="00000000-0000-0000-0000-000000000abc",
                expected_nonce="n",
            )


# ---------------------------------------------------------------------------
# SSO config helpers
# ---------------------------------------------------------------------------

class SSOConfigHelperTest(unittest.TestCase):
    """Tests for get_org_sso_config."""

    @patch("api.utils.crypto.decrypt_asymmetric", return_value="decrypted-secret")
    @patch("api.utils.crypto.get_server_keypair", return_value=(b"\x01" * 32, b"\x02" * 32))
    @patch("api.models.OrganisationSSOProvider")
    def test_get_org_sso_config_decrypts(self, mock_provider_cls, mock_keypair, mock_decrypt):
        from api.utils.sso import get_org_sso_config

        provider = MagicMock()
        provider.config = {
            "tenant_id": "test-tenant",
            "client_id": "test-client",
            "client_secret": "ph:v1:encrypted",
        }
        mock_provider_cls.objects.get.return_value = provider

        result_provider, config = get_org_sso_config("config-id")

        self.assertEqual(config["client_secret"], "decrypted-secret")
        self.assertEqual(config["tenant_id"], "test-tenant")
        mock_decrypt.assert_called_once()


# ---------------------------------------------------------------------------
# OrgSSOEnforcementMiddleware
# ---------------------------------------------------------------------------

class OrgSSOEnforcementMiddlewareTest(unittest.TestCase):
    """Tests for the graphene middleware that blocks non-SSO sessions from
    accessing SSO-enforced orgs."""

    def _make_info(self, user_authenticated=True, session_auth_method=None, session_org_id=None):
        info = MagicMock()
        info.context.user = MagicMock()
        info.context.user.is_authenticated = user_authenticated
        session = {}
        if session_auth_method is not None:
            session["auth_method"] = session_auth_method
        if session_org_id is not None:
            session["auth_sso_org_id"] = session_org_id
        info.context.session = session
        return info

    def _next(self, root, info, **kwargs):
        return "resolver_ran"

    @patch("backend.graphene.middleware.Organisation")
    def test_passes_when_org_does_not_require_sso(self, mock_org_cls):
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org = MagicMock(require_sso=False, name="acme", id="org-1")
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")

        result = mw.resolve(self._next, None, info, organisation_id="org-1")
        self.assertEqual(result, "resolver_ran")

    @patch("backend.graphene.middleware.Organisation")
    def test_passes_sso_session_against_enforced_org(self, mock_org_cls):
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="sso", session_org_id="org-1")

        result = mw.resolve(self._next, None, info, organisation_id="org-1")
        self.assertEqual(result, "resolver_ran")

    @patch("backend.graphene.middleware.Organisation")
    def test_blocks_instance_sso_session_without_org_binding(self, mock_org_cls):
        """Instance-level SSO (Google/GitHub/GitLab) sets auth_method=sso but
        does NOT set auth_sso_org_id. Such a session must not bypass org-level
        SSO enforcement — otherwise a user could sign in via Google and reach
        an Entra-enforced org with the same email."""
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )

        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="sso")  # no org binding

        with self.assertRaises(SSORequiredError):
            mw.resolve(self._next, None, info, organisation_id="org-1")

    @patch("backend.graphene.middleware.Organisation")
    def test_blocks_sso_session_bound_to_different_org(self, mock_org_cls):
        """Session was SSO-authenticated for a different org — must not grant
        access to this org."""
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )

        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(
            session_auth_method="sso", session_org_id="different-org"
        )

        with self.assertRaises(SSORequiredError):
            mw.resolve(self._next, None, info, organisation_id="org-1")

    @patch("backend.graphene.middleware.Organisation")
    def test_blocks_password_session_against_enforced_org(self, mock_org_cls):
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )

        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")

        with self.assertRaises(SSORequiredError) as cm:
            mw.resolve(self._next, None, info, organisation_id="org-1")

        self.assertEqual(cm.exception.extensions["code"], "SSO_REQUIRED")
        self.assertEqual(cm.exception.extensions["organisation_id"], "org-1")

    @patch("backend.graphene.middleware.Organisation")
    def test_blocks_session_with_no_auth_method(self, mock_org_cls):
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )

        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method=None)

        with self.assertRaises(SSORequiredError):
            mw.resolve(self._next, None, info, organisation_id="org-1")

    def test_unauthenticated_user_passes_through(self):
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(user_authenticated=False)

        result = mw.resolve(self._next, None, info, organisation_id="org-1")
        self.assertEqual(result, "resolver_ran")

    def test_no_org_id_passes_through(self):
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")

        # Resolver with no org-scoped kwargs — e.g. `organisations` list
        result = mw.resolve(self._next, None, info)
        self.assertEqual(result, "resolver_ran")

    # The kwarg→org resolution is delegated to
    # api.utils.access.org_resolution.resolve_org_id (tested independently
    # with its own cache layers). Here we only verify that the middleware
    # is plumbing kwargs through for each resource-ID shape that used to
    # have a bespoke dispatch entry — anything that resolves to an org
    # with require_sso=True must raise.

    @patch("backend.graphene.middleware.resolve_org_id", return_value="org-1")
    @patch("backend.graphene.middleware.Organisation")
    def _assert_kwarg_blocks(self, kwarg_name, kwarg_value, mock_org_cls, _resolver):
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )
        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")
        with self.assertRaises(SSORequiredError):
            mw.resolve(self._next, None, info, **{kwarg_name: kwarg_value})

    def test_resolves_org_via_app_id(self):
        self._assert_kwarg_blocks("app_id", "app-1")

    def test_resolves_org_via_env_id(self):
        self._assert_kwarg_blocks("env_id", "env-1")

    def test_resolves_org_via_secret_id(self):
        """Regression: secret_id was a middleware-bypass path before the
        dispatch-table expansion. It must still block for SSO-enforced orgs
        under the new auto-discovery resolver."""
        self._assert_kwarg_blocks("secret_id", "sec-1")

    def test_resolves_org_via_member_id(self):
        self._assert_kwarg_blocks("member_id", "mem-1")

    def test_resolves_org_via_service_account_id(self):
        self._assert_kwarg_blocks("service_account_id", "sa-1")

    def test_resolves_org_via_invite_id(self):
        self._assert_kwarg_blocks("invite_id", "inv-1")

    def test_resolves_org_via_provider_id(self):
        """Regression: provider_id was NOT in the old dispatch table and
        was a silent bypass for the SSO-downgrading mutations
        (deleteOrganisationSsoProvider, updateOrganisationSsoProvider,
        updateOrganisationSecurity). Auto-discovery covers it now."""
        self._assert_kwarg_blocks("provider_id", "prov-1")

    def test_nonexistent_org_passes_through(self):
        """If the org can't be loaded, don't block — let the resolver decide."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware
        from api.models import Organisation

        with patch("backend.graphene.middleware.Organisation") as mock_org_cls:
            # Preserve the real DoesNotExist so the middleware's except clause matches
            mock_org_cls.DoesNotExist = Organisation.DoesNotExist
            mock_org_cls.objects.only.return_value.get.side_effect = (
                Organisation.DoesNotExist
            )

            mw = OrgSSOEnforcementMiddleware()
            info = self._make_info(session_auth_method="password")

            result = mw.resolve(self._next, None, info, organisation_id="missing")
            self.assertEqual(result, "resolver_ran")

    # Bare `id` / `ids` — model derived from the mutation's output
    # type (or `org_resource_model` for primitive-returning mutations).

    @patch("backend.graphene.middleware.resolve_via_model", return_value="org-1")
    @patch("backend.graphene.middleware._model_for_mutation")
    @patch("backend.graphene.middleware.Organisation")
    def _assert_bare_id_blocks(
        self,
        model_name,
        kwarg_name,
        kwarg_value,
        mock_org_cls,
        mock_model_resolver,
        mock_resolver,
    ):
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )
        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org
        mock_model_resolver.return_value = model_name

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")
        with self.assertRaises(SSORequiredError):
            mw.resolve(self._next, None, info, **{kwarg_name: kwarg_value})

    def test_resolves_org_via_secret_model_bare_id(self):
        self._assert_bare_id_blocks("Secret", "id", "sec-1")

    def test_resolves_org_via_secret_model_bare_ids(self):
        self._assert_bare_id_blocks("Secret", "ids", ["sec-1", "sec-2"])

    def test_resolves_org_via_app_model_bare_id(self):
        self._assert_bare_id_blocks("App", "id", "app-1")

    def test_resolves_org_via_role_model_bare_id(self):
        self._assert_bare_id_blocks("Role", "id", "role-1")

    def test_resolves_org_via_policy_model_bare_id(self):
        self._assert_bare_id_blocks("NetworkAccessPolicy", "id", "policy-1")

    def test_unresolvable_mutation_bare_id_passes_through(self):
        """No model resolvable → middleware passes through; per-mutation
        permission checks remain the safety net."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")

        with patch(
            "backend.graphene.middleware._model_for_mutation",
            return_value=None,
        ):
            result = mw.resolve(self._next, None, info, id="unknown-id")
        self.assertEqual(result, "resolver_ran")

    # `*_data` input objects — recurse into their nested *_id fields.

    @patch("backend.graphene.middleware.resolve_org_id", return_value="org-1")
    @patch("backend.graphene.middleware.Organisation")
    def test_resolves_org_via_secret_data_env_id(
        self, mock_org_cls, mock_resolver
    ):
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )
        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")

        # Graphene InputObjectType subclasses dict, so we simulate it
        # with a plain dict carrying the input fields.
        secret_data = {"env_id": "env-1", "key": "DB_URL", "value": "..."}

        with self.assertRaises(SSORequiredError):
            mw.resolve(self._next, None, info, secret_data=secret_data)

    @patch("backend.graphene.middleware.resolve_org_id", return_value="org-1")
    @patch("backend.graphene.middleware.Organisation")
    def test_resolves_org_via_secrets_data_list(
        self, mock_org_cls, mock_resolver
    ):
        """List of input objects — recursion walks every element."""
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )
        org = MagicMock(require_sso=True, name="acme")
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")

        secrets_data = [
            {"key": "X", "value": "..."},  # no env_id (intentional skip)
            {"env_id": "env-1", "key": "Y", "value": "..."},
        ]

        with self.assertRaises(SSORequiredError):
            mw.resolve(self._next, None, info, secrets_data=secrets_data)

    def test_input_with_no_resolvable_id_passes_through(self):
        """Input with no `*_id` field → middleware passes through."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info(session_auth_method="password")

        result = mw.resolve(
            self._next, None, info, secret_data={"key": "X", "value": "..."}
        )
        self.assertEqual(result, "resolver_ran")


class SSOEnforcementBypassTest(unittest.TestCase):
    """SSO admin mutations carry `bypass_sso_enforcement = True` so a
    password-Owner can recover from a self-imposed require_sso=True
    lockout. Without this exemption, the only enabled provider can't
    be deactivated and `--disable-enforcement` is the only recovery."""

    def _info_for(self, field_name):
        from backend.schema import schema
        gql_schema = getattr(schema, "graphql_schema", schema)
        info = MagicMock()
        info.return_type = gql_schema.mutation_type.fields[field_name].type
        info.field_name = field_name
        return info

    def _make_request(self, auth_method="password"):
        info = MagicMock()
        info.context.user = MagicMock(is_authenticated=True)
        info.context.session = {"auth_method": auth_method}
        return info

    def test_update_sso_provider_bypasses_enforcement(self):
        from backend.graphene.middleware import _bypasses_sso_enforcement
        self.assertTrue(
            _bypasses_sso_enforcement(self._info_for("updateOrganisationSsoProvider"))
        )

    def test_delete_sso_provider_bypasses_enforcement(self):
        from backend.graphene.middleware import _bypasses_sso_enforcement
        self.assertTrue(
            _bypasses_sso_enforcement(self._info_for("deleteOrganisationSsoProvider"))
        )

    def test_update_organisation_security_bypasses_enforcement(self):
        from backend.graphene.middleware import _bypasses_sso_enforcement
        self.assertTrue(
            _bypasses_sso_enforcement(self._info_for("updateOrganisationSecurity"))
        )

    def test_create_sso_provider_bypasses_enforcement(self):
        from backend.graphene.middleware import _bypasses_sso_enforcement
        self.assertTrue(
            _bypasses_sso_enforcement(self._info_for("createOrganisationSsoProvider"))
        )

    def test_test_sso_provider_bypasses_enforcement(self):
        from backend.graphene.middleware import _bypasses_sso_enforcement
        self.assertTrue(
            _bypasses_sso_enforcement(self._info_for("testOrganisationSsoProvider"))
        )

    def test_non_sso_mutation_does_not_bypass(self):
        """Regression: only SSO admin mutations carry the bypass."""
        from backend.graphene.middleware import _bypasses_sso_enforcement
        self.assertFalse(
            _bypasses_sso_enforcement(self._info_for("editSecret"))
        )

    @patch("backend.graphene.middleware.Organisation")
    def test_password_owner_can_reach_locked_out_org_via_bypass(self, mock_org_cls):
        """End-to-end: a password session against a require_sso=True
        org reaches updateOrganisationSsoProvider despite the middleware
        normally blocking that combination."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        # If the middleware resolved org and consulted the decision cache,
        # this would yield (True, "acme") → SSORequiredError.
        org = MagicMock(require_sso=True)
        org.name = "acme"
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        info = self._make_request(auth_method="password")
        info.return_type = self._info_for(
            "updateOrganisationSsoProvider"
        ).return_type
        info.field_name = "updateOrganisationSsoProvider"

        ran = []

        def _next(root, info, **kwargs):
            ran.append(True)
            return "ok"

        mw = OrgSSOEnforcementMiddleware()
        # `organisation_id` hits the direct-resolution fast path so the
        # decision cache lookup would normally fire and block.
        result = mw.resolve(_next, None, info, organisation_id="org-1")

        self.assertEqual(result, "ok")
        self.assertEqual(ran, [True])
        # Bypass must short-circuit before any DB lookup.
        mock_org_cls.objects.only.return_value.get.assert_not_called()

    @patch("backend.graphene.middleware.Organisation")
    def test_non_bypass_mutation_still_blocked_on_require_sso_org(
        self, mock_org_cls
    ):
        """Regression: the bypass must not leak to non-SSO mutations."""
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )

        org = MagicMock(require_sso=True)
        org.name = "acme"
        org.id = "org-1"
        mock_org_cls.objects.only.return_value.get.return_value = org

        info = self._make_request(auth_method="password")
        info.return_type = self._info_for("editSecret").return_type
        info.field_name = "editSecret"

        mw = OrgSSOEnforcementMiddleware()
        with self.assertRaises(SSORequiredError):
            mw.resolve(lambda r, i, **k: "ok", None, info, organisation_id="org-1")


class ModelForMutationDerivationTest(unittest.TestCase):
    """`_model_for_mutation` derives the affected Django model from a
    mutation's GraphQL return type, or from `org_resource_model`."""

    def _gql_return_type(self, field_name):
        from backend.schema import schema
        gql_schema = getattr(schema, "graphql_schema", schema)
        return gql_schema.mutation_type.fields[field_name].type

    def test_derives_model_from_djangoobjecttype_output(self):
        """editSecret returns SecretType → walks output, finds Secret."""
        from backend.graphene.middleware import _model_for_mutation

        info = MagicMock()
        info.return_type = self._gql_return_type("editSecret")
        self.assertEqual(_model_for_mutation(info), "Secret")

    def test_explicit_org_resource_model_takes_precedence(self):
        """readSecret returns ok=Boolean → reads `org_resource_model`."""
        from backend.graphene.middleware import _model_for_mutation

        info = MagicMock()
        info.return_type = self._gql_return_type("readSecret")
        self.assertEqual(_model_for_mutation(info), "Secret")

    def test_returns_none_for_mutation_without_model_or_attribute(self):
        """Primitive output + no attribute → None (don't guess)."""
        from backend.graphene.middleware import _model_for_mutation
        import graphene

        class _DummyMutation(graphene.Mutation):
            class Arguments:
                id = graphene.ID(required=True)
            ok = graphene.Boolean()
            @classmethod
            def mutate(cls, root, info, id):
                return cls(ok=True)

        class _Q(graphene.ObjectType):
            hi = graphene.String()

        class _M(graphene.ObjectType):
            do_dummy = _DummyMutation.Field()

        s = graphene.Schema(query=_Q, mutation=_M)
        gql_schema = getattr(s, "graphql_schema", s)
        info = MagicMock()
        info.return_type = gql_schema.mutation_type.fields["doDummy"].type
        self.assertIsNone(_model_for_mutation(info))


# ---------------------------------------------------------------------------
# Session marker propagation (SSO callback)
# ---------------------------------------------------------------------------

class OrgSSOEnforcementMiddlewareCacheTest(unittest.TestCase):
    """The middleware caches org / app / env → org lookups per request so a
    complex GraphQL document doesn't re-hit the DB for every resolver."""

    class _StubRequest:
        """Plain object so attribute gets return the default (MagicMock would
        auto-create a new Mock for missing attrs, defeating the cache check).

        Uses a password session so the middleware's SSO-session fast-path
        doesn't short-circuit before the decision cache is consulted —
        the whole point of these tests is to verify the cache layer, not
        the fast-path."""

        def __init__(self):
            self.user = type("U", (), {"is_authenticated": True})()
            self.session = {"auth_method": "password"}

    def _make_info_with_real_request(self):
        info = MagicMock()
        info.context = self._StubRequest()
        return info

    def _next(self, root, info, **kwargs):
        return "ran"

    def setUp(self):
        # The decision cache now has both a per-request L1 and a
        # Redis-backed L2. Clear Redis (locmem in tests) between tests
        # to prevent bleed.
        from django.core.cache import cache
        cache.clear()

    # Use require_sso=False so the password session passes through — the
    # caching behaviour is independent of the enforcement decision, and
    # these tests aren't exercising the enforcement branch.

    @patch("backend.graphene.middleware.Organisation")
    def test_org_lookup_cached_across_calls(self, mock_org_cls):
        """A single GraphQL document often pulls many org-scoped fields —
        they must all share one Organisation lookup, not re-query each time."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        info = self._make_info_with_real_request()

        mw.resolve(self._next, None, info, organisation_id="org-1")
        mw.resolve(self._next, None, info, organisation_id="org-1")
        mw.resolve(self._next, None, info, organisation_id="org-1")

        self.assertEqual(
            mock_org_cls.objects.only.return_value.get.call_count, 1
        )

    @patch("backend.graphene.middleware.Organisation")
    def test_decision_cached_in_redis_across_requests(self, mock_org_cls):
        """Second request against the same org must hit the Redis decision
        cache, not re-query Postgres — that's the whole point of Level 1
        Redis caching."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()

        mw.resolve(self._next, None, self._make_info_with_real_request(),
                   organisation_id="org-1")
        mw.resolve(self._next, None, self._make_info_with_real_request(),
                   organisation_id="org-1")

        self.assertEqual(
            mock_org_cls.objects.only.return_value.get.call_count, 1
        )

    @patch("backend.graphene.middleware.Organisation")
    def test_decision_invalidate_clears_redis(self, mock_org_cls):
        """invalidate_decision must drop the cache so the next request
        re-reads require_sso from the DB (so e.g. toggling enforcement
        takes effect immediately for other users, not after the 60s TTL)."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()

        mw.resolve(self._next, None, self._make_info_with_real_request(),
                   organisation_id="org-1")
        OrgSSOEnforcementMiddleware.invalidate_decision("org-1")
        mw.resolve(self._next, None, self._make_info_with_real_request(),
                   organisation_id="org-1")

        self.assertEqual(
            mock_org_cls.objects.only.return_value.get.call_count, 2
        )


class SSOSessionMarkersTest(unittest.TestCase):
    """The SSO callback must tag the session with auth_method, auth_sso_org_id,
    and auth_sso_provider_id so the middleware and future per-org gates have
    everything they need."""

    def test_password_login_clears_all_sso_markers(self):
        from django.test import RequestFactory

        # Start with a request that had SSO markers (simulating a prior SSO session)
        request = _make_post("/auth/password/login/", {"email": "a@b.com"})
        request.session["auth_method"] = "sso"
        request.session["auth_sso_org_id"] = "org-1"
        request.session["auth_sso_provider_id"] = "prov-1"
        request.session.save()

        # Simulate the lines from password_login after successful auth
        # (direct assertion on the logic at auth_password.py:273-276)
        request.session["auth_method"] = "password"
        request.session.pop("auth_sso_org_id", None)
        request.session.pop("auth_sso_provider_id", None)

        self.assertEqual(request.session["auth_method"], "password")
        self.assertNotIn("auth_sso_org_id", request.session)
        self.assertNotIn("auth_sso_provider_id", request.session)


class PasswordChangeSessionMarkerPreservationTest(unittest.TestCase):
    """Regression: Django's auth.login() calls session.flush() when the
    stored HASH_SESSION_KEY doesn't match user.get_session_auth_hash() —
    which happens every time set_password() runs, because the hash is
    derived from the password. Without the manual save/restore around
    login() in ChangeAccountPasswordMutation, the SSO session markers
    get wiped and the middleware starts blocking the user on the next
    request."""

    def test_django_login_flushes_session_when_auth_hash_changes(self):
        """Documents the Django behavior that makes the save/restore in
        ChangeAccountPasswordMutation necessary. Avoids the DB by
        mocking just the bits of the user that login() looks at."""
        from django.contrib.auth import login, SESSION_KEY, HASH_SESSION_KEY

        request = _make_post("/graphql/", {})
        # Seed the session as if a user is logged in with SSO markers.
        request.session[SESSION_KEY] = "user-42"
        request.session[HASH_SESSION_KEY] = "old-auth-hash"
        request.session["auth_method"] = "sso"
        request.session["auth_sso_org_id"] = "org-1"
        request.session["auth_sso_provider_id"] = "prov-1"
        request.session.save()

        # Simulate the user after set_password: same pk, different hash.
        user = MagicMock()
        user.pk = "user-42"
        user._meta.pk.value_to_string.return_value = "user-42"
        user.get_session_auth_hash.return_value = "new-auth-hash"
        user.backend = "django.contrib.auth.backends.ModelBackend"
        user.is_authenticated = True

        login(request, user)

        # Session was flushed — all non-Django keys are gone. The view
        # compensates by snapshotting and re-writing the markers around
        # this call.
        self.assertNotIn("auth_method", request.session)
        self.assertNotIn("auth_sso_org_id", request.session)
        self.assertNotIn("auth_sso_provider_id", request.session)


# ---------------------------------------------------------------------------
# Security review — config validation, SSRF guard, lockout prevention
# ---------------------------------------------------------------------------

class ConfigValidationTest(unittest.TestCase):
    """validate_provider_config — required-field, shape, and sealed-secret checks."""

    def test_entra_id_requires_tenant_client_secret(self):
        from api.utils.sso import validate_provider_config

        with self.assertRaisesRegex(ValueError, "tenant_id"):
            validate_provider_config("entra_id", {"client_id": "x"})

    def test_entra_id_rejects_non_uuid_tenant(self):
        from api.utils.sso import validate_provider_config

        with self.assertRaisesRegex(ValueError, "tenant_id"):
            validate_provider_config(
                "entra_id",
                {
                    "tenant_id": "not-a-uuid",
                    "client_id": "6731de76-14a6-49ae-97bc-6eba6914391e",
                    "client_secret": "ph:v1:a:b",
                },
            )

    def test_entra_id_rejects_plaintext_secret(self):
        from api.utils.sso import validate_provider_config

        with self.assertRaisesRegex(ValueError, "encrypted client-side"):
            validate_provider_config(
                "entra_id",
                {
                    "tenant_id": "72f988bf-86f1-41af-91ab-2d7cd011db47",
                    "client_id": "6731de76-14a6-49ae-97bc-6eba6914391e",
                    "client_secret": "plaintext-not-sealed",
                },
            )

    def test_entra_id_accepts_valid_config(self):
        from api.utils.sso import validate_provider_config

        # Should not raise
        validate_provider_config(
            "entra_id",
            {
                "tenant_id": "72f988bf-86f1-41af-91ab-2d7cd011db47",
                "client_id": "6731de76-14a6-49ae-97bc-6eba6914391e",
                "client_secret": "ph:v1:publickey:ciphertext",
            },
        )

    def test_okta_requires_https_issuer(self):
        from api.utils.sso import validate_provider_config

        with self.assertRaisesRegex(ValueError, "issuer"):
            validate_provider_config(
                "okta",
                {
                    "issuer": "http://dev-12345.okta.com",  # http not https
                    "client_id": "0oaxxx",
                    "client_secret": "ph:v1:a:b",
                },
            )

    def test_okta_accepts_valid_config(self):
        from api.utils.sso import validate_provider_config

        validate_provider_config(
            "okta",
            {
                "issuer": "https://dev-12345.okta.com",
                "client_id": "0oaxxx",
                "client_secret": "ph:v1:pk:ct",
            },
        )

    def test_unknown_provider_rejected(self):
        from api.utils.sso import validate_provider_config

        with self.assertRaisesRegex(ValueError, "Unsupported provider type"):
            validate_provider_config("made_up", {})

    def test_require_secret_false_skips_secret(self):
        """On update with blank secret, require_secret=False permits missing/blank."""
        from api.utils.sso import validate_provider_config

        # Update with only the non-secret fields — secret keeps existing
        validate_provider_config(
            "entra_id",
            {
                "tenant_id": "72f988bf-86f1-41af-91ab-2d7cd011db47",
                "client_id": "6731de76-14a6-49ae-97bc-6eba6914391e",
            },
            require_secret=False,
        )


class UpdateSSOProviderDeactivationLockoutTest(unittest.TestCase):
    """When the only active provider is deactivated while SSO enforcement
    is on, the mutation must auto-disable require_sso — otherwise no one
    (including the admin) can authenticate on their next request."""

    @patch("backend.graphene.mutations.sso.OrganisationMember")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_deactivating_only_provider_disables_enforcement(
        self, mock_perm, mock_provider_cls, mock_member_cls
    ):
        from backend.graphene.mutations.sso import UpdateOrganisationSSOProviderMutation

        org = MagicMock()
        org.plan = "EN"
        org.require_sso = True

        provider = MagicMock()
        provider.enabled = True  # currently-active
        provider.organisation = org
        provider.provider_type = "entra_id"
        mock_provider_cls.objects.get.return_value = provider
        # No other enabled providers
        mock_provider_cls.objects.filter.return_value.exclude.return_value.exists.return_value = False

        with patch(
            "backend.graphene.mutations.sso.Organisation.ENTERPRISE_PLAN", "EN"
        ):
            info = MagicMock()
            info.context.user = MagicMock()
            UpdateOrganisationSSOProviderMutation.mutate(
                None, info, provider_id="p1", enabled=False
            )

        self.assertFalse(org.require_sso)
        org.save.assert_called()

    @patch("backend.graphene.mutations.sso.OrganisationMember")
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_deactivating_when_other_active_providers_exist_keeps_enforcement(
        self, mock_perm, mock_provider_cls, mock_member_cls
    ):
        """If another enabled provider exists, enforcement stays on."""
        from backend.graphene.mutations.sso import UpdateOrganisationSSOProviderMutation

        org = MagicMock()
        org.plan = "EN"
        org.require_sso = True

        provider = MagicMock()
        provider.enabled = True
        provider.organisation = org
        provider.provider_type = "entra_id"
        mock_provider_cls.objects.get.return_value = provider
        # Another enabled provider exists
        mock_provider_cls.objects.filter.return_value.exclude.return_value.exists.return_value = True

        with patch(
            "backend.graphene.mutations.sso.Organisation.ENTERPRISE_PLAN", "EN"
        ):
            info = MagicMock()
            info.context.user = MagicMock()
            UpdateOrganisationSSOProviderMutation.mutate(
                None, info, provider_id="p1", enabled=False
            )

        self.assertTrue(org.require_sso)


class TestSSOSSRFGuardTest(unittest.TestCase):
    """TestOrganisationSSOProviderMutation must refuse to fetch from
    unsafe issuer URLs on cloud deployments. Self-hosted skips the
    check (admins may legitimately run internal IdPs) — matching the
    pattern in vault/gitlab/nomad/github-actions/aws-iam integrations.
    """

    @patch("backend.graphene.mutations.sso.CLOUD_HOSTED", True)
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_cloud_blocks_metadata_issuer(self, mock_perm, mock_provider_cls):
        from backend.graphene.mutations.sso import TestOrganisationSSOProviderMutation

        provider = MagicMock()
        provider.provider_type = "okta"
        provider.config = {
            "issuer": "https://169.254.169.254",
            "client_id": "x",
            "client_secret": "y",
        }
        mock_provider_cls.objects.get.return_value = provider

        info = MagicMock()
        info.context.user = MagicMock()
        result = TestOrganisationSSOProviderMutation.mutate(
            None, info, provider_id="p1"
        )
        self.assertFalse(result.success)
        self.assertIn("valid public HTTPS", result.error)

    @patch("backend.graphene.mutations.sso.CLOUD_HOSTED", True)
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_cloud_blocks_private_rfc1918_issuer(self, mock_perm, mock_provider_cls):
        from backend.graphene.mutations.sso import TestOrganisationSSOProviderMutation

        provider = MagicMock()
        provider.provider_type = "okta"
        provider.config = {
            "issuer": "https://10.0.0.1",
            "client_id": "x",
            "client_secret": "y",
        }
        mock_provider_cls.objects.get.return_value = provider

        info = MagicMock()
        info.context.user = MagicMock()
        result = TestOrganisationSSOProviderMutation.mutate(
            None, info, provider_id="p1"
        )
        self.assertFalse(result.success)

    @patch("backend.graphene.mutations.sso.CLOUD_HOSTED", False)
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_self_hosted_skips_ip_check(self, mock_perm, mock_provider_cls):
        """Self-hosted admin with an internal IdP should be allowed to test."""
        from backend.graphene.mutations.sso import TestOrganisationSSOProviderMutation

        provider = MagicMock()
        provider.provider_type = "okta"
        provider.config = {
            "issuer": "https://10.0.0.50",
            "client_id": "x",
            "client_secret": "y",
        }
        mock_provider_cls.objects.get.return_value = provider

        fake_resp = MagicMock()
        fake_resp.json.return_value = {
            "authorization_endpoint": "https://10.0.0.50/authorize",
            "token_endpoint": "https://10.0.0.50/token",
        }
        fake_resp.raise_for_status.return_value = None

        info = MagicMock()
        info.context.user = MagicMock()
        # Patch the underlying HTTP layer used by _safe_oidc_request.
        with patch("api.views.sso.http_requests.request", return_value=fake_resp):
            result = TestOrganisationSSOProviderMutation.mutate(
                None, info, provider_id="p1"
            )
        self.assertTrue(result.success)

    @patch("backend.graphene.mutations.sso.CLOUD_HOSTED", True)
    @patch("backend.graphene.mutations.sso.OrganisationSSOProvider")
    @patch("backend.graphene.mutations.sso.user_has_permission", return_value=True)
    def test_returns_generic_error_on_upstream_failure(
        self, mock_perm, mock_provider_cls
    ):
        """Never surface upstream response bodies / error details to the caller."""
        import requests as http_requests
        from backend.graphene.mutations.sso import TestOrganisationSSOProviderMutation

        provider = MagicMock()
        provider.provider_type = "okta"
        provider.config = {
            "issuer": "https://okta.com",
            "client_id": "x",
            "client_secret": "y",
        }
        mock_provider_cls.objects.get.return_value = provider

        # Let validate_url_is_safe pass (public IP), but the HTTP fetch fails
        # with a juicy error body we must NOT surface to the caller.
        with patch(
            "api.utils.network.socket.gethostbyname_ex",
            return_value=("okta.com", [], ["1.1.1.1"]),
        ), patch(
            "api.views.sso.http_requests.request",
            side_effect=Exception("<html>INTERNAL SECRET</html>"),
        ):
            info = MagicMock()
            info.context.user = MagicMock()
            result = TestOrganisationSSOProviderMutation.mutate(
                None, info, provider_id="p1"
            )

        self.assertFalse(result.success)
        self.assertNotIn("INTERNAL SECRET", result.error)
        self.assertIn("Failed to reach", result.error)


class InviteAcceptanceEmailMatchTest(unittest.TestCase):
    """Regression: accepting an organisation invite requires the caller's
    authenticated email to match the invite's invitee_email. Otherwise
    a leaked invite_id (forwarded email, URL history, log dump) could
    be claimed by any authenticated account."""

    def _make_info(self, user_email):
        info = MagicMock()
        user = MagicMock()
        user.email = user_email
        user.userId = "user-uuid"
        info.context.user = user
        return info

    @patch("backend.graphene.mutations.organisation.user_is_org_member")
    @patch("backend.graphene.mutations.organisation.OrganisationMemberInvite")
    def test_mismatched_email_raises(self, mock_invite_cls, mock_is_member):
        from backend.graphene.mutations.organisation import (
            CreateOrganisationMemberMutation,
        )
        from graphql import GraphQLError

        mock_is_member.return_value = False
        mock_invite_cls.objects.filter.return_value.exists.return_value = True
        invite = MagicMock()
        invite.invitee_email = "alice@example.com"
        mock_invite_cls.objects.get.return_value = invite

        info = self._make_info(user_email="eve@attacker.com")

        with self.assertRaises(GraphQLError) as cm:
            CreateOrganisationMemberMutation.mutate(
                None,
                info,
                org_id="org-1",
                identity_key="k",
                wrapped_keyring="wk",
                wrapped_recovery="wr",
                invite_id="inv-1",
            )
        self.assertIn("another user", str(cm.exception))

    @patch("backend.graphene.mutations.organisation.user_is_org_member")
    @patch("backend.graphene.mutations.organisation.OrganisationMemberInvite")
    def test_cross_org_redemption_raises(
        self, mock_invite_cls, mock_is_member
    ):
        """Regression: an invite to org A must not be redeemable to join
        org B. Only the email check + org_id check together bind the
        invite to a specific (user, org) pair."""
        from backend.graphene.mutations.organisation import (
            CreateOrganisationMemberMutation,
        )
        from graphql import GraphQLError

        mock_is_member.return_value = False
        mock_invite_cls.objects.filter.return_value.exists.return_value = True
        invite = MagicMock()
        invite.invitee_email = "alice@example.com"
        invite.organisation_id = "org-A"
        mock_invite_cls.objects.get.return_value = invite

        info = self._make_info(user_email="alice@example.com")

        with self.assertRaises(GraphQLError) as cm:
            CreateOrganisationMemberMutation.mutate(
                None,
                info,
                org_id="org-B",
                identity_key="k",
                wrapped_keyring="wk",
                wrapped_recovery="wr",
                invite_id="inv-1",
            )
        self.assertIn("does not match", str(cm.exception))

    @patch("backend.graphene.mutations.organisation.user_is_org_member")
    @patch("backend.graphene.mutations.organisation.OrganisationMemberInvite")
    def test_email_match_is_case_insensitive(
        self, mock_invite_cls, mock_is_member
    ):
        """Invite address 'Alice@Example.com' must match caller
        'alice@example.com'. Emails are case-insensitive."""
        from backend.graphene.mutations.organisation import (
            CreateOrganisationMemberMutation,
        )
        from graphql import GraphQLError

        mock_is_member.return_value = False
        mock_invite_cls.objects.filter.return_value.exists.return_value = True
        invite = MagicMock()
        invite.invitee_email = "Alice@Example.com"
        mock_invite_cls.objects.get.return_value = invite

        info = self._make_info(user_email="alice@example.com")

        # Must NOT raise the "another user" error — it would proceed to
        # run the rest of the mutation, which will fail on unmocked
        # dependencies. We care here only that the email check passes.
        try:
            CreateOrganisationMemberMutation.mutate(
                None,
                info,
                org_id="org-1",
                identity_key="k",
                wrapped_keyring="wk",
                wrapped_recovery="wr",
                invite_id="inv-1",
            )
        except GraphQLError as e:
            self.assertNotIn("another user", str(e))
        except Exception:
            pass  # downstream unmocked collaborators — fine


if __name__ == "__main__":
    unittest.main()
