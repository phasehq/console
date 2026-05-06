"""Tests for /service prefix routing.

Two layers covered:
- ``ServicePrefixMiddleware`` — strips ``/service`` from ``request.path_info`` so
  the rest of the stack sees a single canonical path. No-op for everything else.
- URL resolution — ``public_urls`` is mounted at both root and ``/public/`` so
  cloud (``api.phase.dev/v1/...``) and legacy / self-hosted nginx
  (``/public/v1/...``) topologies converge on the same views.
"""

import unittest
from unittest.mock import MagicMock

from django.urls import Resolver404, resolve

from backend.middleware import ServicePrefixMiddleware


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
