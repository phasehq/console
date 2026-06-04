"""Tests for /service prefix routing.

Two layers covered:
- ``ServicePrefixMiddleware`` — strips ``/service`` from ``request.path_info`` so
  the rest of the stack sees a single canonical path. No-op for everything else.
- URL resolution — ``public_urls`` is mounted at both root and ``/public/`` so
  cloud (``api.phase.dev/v1/...``) and legacy / self-hosted nginx
  (``/public/v1/...``) topologies converge on the same views.
"""

import json
import unittest
from unittest.mock import MagicMock

from django.test import RequestFactory
from django.urls import Resolver404, resolve

from backend.middleware import HealthCheckMiddleware, ServicePrefixMiddleware


class HealthCheckMiddlewareTest(unittest.TestCase):
    """Middleware short-circuits /health/; everything else passes through.

    The point of this middleware is to bypass Django's host validation so
    ALB health checks (Host: <task-ip>:<port>) don't fail under strict
    ALLOWED_HOSTS. The middleware delegates to the canonical view, so the
    response shape (200 + payload) and method enforcement (405 for non-GET)
    come from the view itself — these tests pin both behaviors so future
    drift in the view is caught here too.
    """

    def setUp(self):
        self.factory = RequestFactory()

    def test_get_health_returns_alive_without_calling_get_response(self):
        request = self.factory.get("/health/")
        get_response = MagicMock()

        response = HealthCheckMiddleware(get_response)(request)

        get_response.assert_not_called()
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body["status"], "alive")
        self.assertIn("version", body)

    def test_non_get_health_returns_405_without_calling_get_response(self):
        # View is GET-only via @api_view(["GET"]); non-GET must surface as
        # 405, not slip through the chain (where it'd hit host validation).
        request = self.factory.post("/health/")
        get_response = MagicMock()

        response = HealthCheckMiddleware(get_response)(request)

        get_response.assert_not_called()
        self.assertEqual(response.status_code, 405)

    def test_non_health_path_calls_get_response(self):
        request = MagicMock()
        request.path_info = "/v1/secrets/"
        get_response = MagicMock(return_value="response")

        result = HealthCheckMiddleware(get_response)(request)

        get_response.assert_called_once_with(request)
        self.assertEqual(result, "response")

    def test_health_lookalike_paths_are_not_intercepted(self):
        # /healthz, /health (no slash), /health/foo must go through the chain.
        for path in ("/healthz/", "/health", "/health/foo", "/api/health/"):
            with self.subTest(path=path):
                request = MagicMock()
                request.path_info = path
                get_response = MagicMock(return_value="response")

                HealthCheckMiddleware(get_response)(request)

                get_response.assert_called_once_with(request)


class ServicePrefixMiddlewareTest(unittest.TestCase):
    """Middleware strips /service; everything else passes through untouched."""

    def _strip(self, path):
        request = MagicMock()
        request.path_info = path
        ServicePrefixMiddleware(get_response=MagicMock())(request)
        return request.path_info

    # --- /service prefix is stripped ---

    def test_strips_prefix_from_nested_path(self):
        self.assertEqual(self._strip("/service/auth/me/"), "/auth/me/")

    def test_strips_prefix_from_v1_secrets(self):
        self.assertEqual(self._strip("/service/v1/secrets/"), "/v1/secrets/")

    def test_strips_prefix_when_legacy_public_path_under_service(self):
        self.assertEqual(self._strip("/service/public/v1/secrets/"), "/public/v1/secrets/")

    def test_strips_prefix_with_only_trailing_slash(self):
        self.assertEqual(self._strip("/service/"), "/")

    def test_strips_prefix_with_no_trailing_slash(self):
        # Cloud ALB may forward `/service` without a trailing slash; treat the
        # same as `/service/` — empty residual becomes "/".
        self.assertEqual(self._strip("/service"), "/")

    # --- lookalike paths must NOT be stripped ---

    def test_leaves_root_alone(self):
        self.assertEqual(self._strip("/"), "/")

    def test_leaves_unrelated_path_alone(self):
        self.assertEqual(self._strip("/auth/me/"), "/auth/me/")

    def test_leaves_services_plural_alone(self):
        # /services/* must not match the /service prefix.
        self.assertEqual(self._strip("/services/foo"), "/services/foo")

    def test_leaves_service_substring_alone(self):
        self.assertEqual(self._strip("/serviceabc"), "/serviceabc")

    def test_leaves_v1_secrets_alone(self):
        self.assertEqual(self._strip("/v1/secrets/"), "/v1/secrets/")

    # --- middleware contract: response chain is invoked ---

    def test_calls_get_response_with_modified_request(self):
        request = MagicMock()
        request.path_info = "/service/health/"
        get_response = MagicMock(return_value="response")
        result = ServicePrefixMiddleware(get_response)(request)
        get_response.assert_called_once_with(request)
        self.assertEqual(result, "response")
        self.assertEqual(request.path_info, "/health/")

    def test_passthrough_calls_get_response_with_unmodified_request(self):
        request = MagicMock()
        request.path_info = "/v1/secrets/"
        get_response = MagicMock(return_value="response")
        ServicePrefixMiddleware(get_response)(request)
        get_response.assert_called_once_with(request)
        self.assertEqual(request.path_info, "/v1/secrets/")


class URLRoutingTest(unittest.TestCase):
    """Routes resolve at the post-strip paths the middleware forwards.

    These resolve calls don't go through middleware — they assert that *given*
    the path the middleware would forward, the URL resolver finds a route.
    Together with the middleware tests above, this covers the full chain.
    """

    def assertResolves(self, path):
        try:
            resolve(path)
        except Resolver404:
            self.fail(f"path did not resolve: {path}")

    def assertNotResolves(self, path):
        with self.assertRaises(Resolver404):
            resolve(path)

    # --- top-level routes (post-strip from /service/<route>) ---

    def test_health_at_root(self):
        self.assertResolves("/health/")

    def test_graphql_at_root(self):
        self.assertResolves("/graphql/")

    def test_auth_me_at_root(self):
        self.assertResolves("/auth/me/")

    def test_logout_at_root(self):
        self.assertResolves("/logout/")

    def test_lockbox_at_root(self):
        self.assertResolves("/lockbox/some-box-id")

    # --- public_urls mounted at root (cloud canonical: api.phase.dev/v1/...) ---

    def test_root_endpoint_at_root(self):
        self.assertResolves("/")

    def test_v1_secrets_at_root(self):
        self.assertResolves("/v1/secrets/")

    def test_aws_iam_auth_at_root(self):
        self.assertResolves("/identities/external/v1/aws/iam/auth/")

    def test_azure_entra_auth_at_root(self):
        self.assertResolves("/identities/external/v1/azure/entra/auth/")

    # --- public_urls also at /public/ (legacy form / nginx-stripped self-hosted) ---

    def test_root_endpoint_at_public(self):
        self.assertResolves("/public/")

    def test_v1_secrets_at_public(self):
        self.assertResolves("/public/v1/secrets/")

    def test_aws_iam_auth_at_public(self):
        self.assertResolves("/public/identities/external/v1/aws/iam/auth/")

    # --- non-routes still 404 (sanity: we didn't accidentally match-all) ---

    def test_unknown_path_does_not_resolve(self):
        self.assertNotResolves("/no/such/endpoint/")

    def test_lookalike_services_does_not_resolve(self):
        self.assertNotResolves("/services/")


class UnslashedUrlReturns404Test(unittest.TestCase):
    """APPEND_SLASH is disabled — unslashed URLs must 404 instead of 301.

    The previous 301 redirect dropped POST bodies and (behind nginx that
    strips ``/service/``) terminated on the frontend login page with a
    200 + HTML body, which SDKs interpreted as success.
    """

    def setUp(self):
        from django.test import Client
        self.client = Client()

    def test_unslashed_under_service_prefix_returns_404(self):
        response = self.client.get("/service/secrets", follow=False)
        self.assertEqual(response.status_code, 404)

    def test_unslashed_at_root_returns_404(self):
        response = self.client.get("/secrets", follow=False)
        self.assertEqual(response.status_code, 404)

    def test_slashed_routes_still_resolve_normally(self):
        # Baseline: a known-good slashed URL still routes (auth still
        # required, so we expect 401 / 403 — anything but 404).
        response = self.client.get("/service/v1/apps/", follow=False)
        self.assertNotEqual(response.status_code, 404)
