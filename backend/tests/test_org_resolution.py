"""Tests for api.utils.access.org_resolution.

Covers the three cache layers (per-request dict, Django cache / Redis,
DB fallback), auto-discovery of the FK path to Organisation, signal-
driven invalidation, and graceful degradation when the cache backend
is unavailable.
"""

import unittest
from unittest.mock import patch, MagicMock

from django.core.cache import cache


class PathDiscoveryTest(unittest.TestCase):
    """BFS through Django model FKs to find the path to Organisation."""

    def setUp(self):
        from api.utils.access.org_resolution import _path_to_organisation
        # Each test starts with a fresh lru_cache so path discovery
        # re-runs against the current app state.
        _path_to_organisation.cache_clear()

    def test_organisation_itself_resolves_to_id(self):
        from api.utils.access.org_resolution import _path_to_organisation
        self.assertEqual(_path_to_organisation("Organisation"), "id")

    def test_direct_fk_to_organisation(self):
        """App.organisation is a direct FK — path is one hop."""
        from api.utils.access.org_resolution import _path_to_organisation
        path = _path_to_organisation("App")
        self.assertEqual(path, "organisation__id")

    def test_transitive_fk_chain(self):
        """Secret → Environment → App → Organisation — three hops."""
        from api.utils.access.org_resolution import _path_to_organisation
        path = _path_to_organisation("Secret")
        # Exact path depends on FK layout; just assert it ends at
        # organisation__id and goes through environment + app.
        self.assertTrue(path.endswith("organisation__id"))
        self.assertIn("environment", path)

    def test_unknown_model_returns_none(self):
        from api.utils.access.org_resolution import _path_to_organisation
        self.assertIsNone(_path_to_organisation("Nonexistent"))


class ResolveOrgIdTest(unittest.TestCase):
    """End-to-end org-id resolution with all three cache layers."""

    def setUp(self):
        cache.clear()
        # Clear lru_cache so each test sees a fresh path lookup.
        from api.utils.access.org_resolution import _path_to_organisation
        _path_to_organisation.cache_clear()

    def test_direct_org_id_kwargs_bypass_lookups(self):
        """organisation_id and org_id are passed through verbatim — no
        DB query, no cache hit."""
        from api.utils.access.org_resolution import resolve_org_id
        request_cache = {}
        with patch("api.utils.access.org_resolution.apps.get_model") as mock_get:
            self.assertEqual(
                resolve_org_id("organisation_id", "abc", request_cache), "abc"
            )
            self.assertEqual(
                resolve_org_id("org_id", "xyz", request_cache), "xyz"
            )
            mock_get.assert_not_called()

    def test_non_id_kwarg_returns_none(self):
        """A kwarg that isn't a *_id shape should be ignored."""
        from api.utils.access.org_resolution import resolve_org_id
        self.assertIsNone(resolve_org_id("name", "something", {}))
        self.assertIsNone(resolve_org_id("email", "x@y.com", {}))

    def test_empty_value_returns_none(self):
        from api.utils.access.org_resolution import resolve_org_id
        self.assertIsNone(resolve_org_id("app_id", None, {}))
        self.assertIsNone(resolve_org_id("app_id", "", {}))

    def test_ambiguous_kwarg_skipped(self):
        """token_id deliberately bypasses the generic resolver — the
        middleware has a dedicated probe for it."""
        from api.utils.access.org_resolution import resolve_org_id
        self.assertIsNone(resolve_org_id("token_id", "tkn-1", {}))

    def test_l1_cache_hit_skips_redis_and_db(self):
        from api.utils.access.org_resolution import resolve_org_id
        request_cache = {("app_id", "app-1"): "org-pre-cached"}
        with patch("api.utils.access.org_resolution.apps.get_model") as mock_get:
            with patch("api.utils.access.org_resolution.cache") as mock_cache:
                result = resolve_org_id("app_id", "app-1", request_cache)
        self.assertEqual(result, "org-pre-cached")
        mock_get.assert_not_called()
        mock_cache.get.assert_not_called()

    def test_l2_cache_hit_populates_l1(self):
        from api.utils.access.org_resolution import resolve_org_id
        request_cache = {}
        # Pre-seed L2 (cache) with a known value
        cache.set("org_for:app:app-2", "org-from-redis", timeout=60)
        with patch("api.utils.access.org_resolution.apps.get_model") as mock_get:
            result = resolve_org_id("app_id", "app-2", request_cache)
        self.assertEqual(result, "org-from-redis")
        mock_get.assert_not_called()
        # L1 should now contain the result too
        self.assertEqual(request_cache.get(("app_id", "app-2")), "org-from-redis")

    def test_l2_negative_sentinel_treated_as_not_found(self):
        """An empty-string cache entry means 'we looked, it wasn't
        there'. Return None without hitting the DB."""
        from api.utils.access.org_resolution import resolve_org_id
        cache.set("org_for:app:ghost-app", "", timeout=60)
        with patch("api.utils.access.org_resolution.apps.get_model") as mock_get:
            result = resolve_org_id("app_id", "ghost-app", {})
        self.assertIsNone(result)
        mock_get.assert_not_called()

    def test_cache_miss_falls_through_to_db_and_populates_both_layers(self):
        from api.utils.access.org_resolution import resolve_org_id

        mock_model = MagicMock()
        mock_model.objects.filter.return_value.values_list.return_value.first.return_value = (
            "org-from-db"
        )

        request_cache = {}
        with patch(
            "api.utils.access.org_resolution.apps.get_model",
            return_value=mock_model,
        ), patch(
            "api.utils.access.org_resolution._path_to_organisation",
            return_value="organisation__id",
        ):
            result = resolve_org_id("app_id", "app-3", request_cache)

        self.assertEqual(result, "org-from-db")
        # L1 populated
        self.assertEqual(request_cache.get(("app_id", "app-3")), "org-from-db")
        # L2 populated
        self.assertEqual(cache.get("org_for:app:app-3"), "org-from-db")

    def test_redis_failure_falls_through_to_db(self):
        """If Redis is down, cache ops raise — we must not break the
        request path. Resolution must complete via the DB."""
        from api.utils.access.org_resolution import resolve_org_id

        mock_model = MagicMock()
        mock_model.objects.filter.return_value.values_list.return_value.first.return_value = (
            "org-from-db"
        )

        class _BrokenCache:
            def get(self, *args, **kwargs):
                raise ConnectionError("redis down")

            def set(self, *args, **kwargs):
                raise ConnectionError("redis down")

        with patch(
            "api.utils.access.org_resolution.apps.get_model",
            return_value=mock_model,
        ), patch(
            "api.utils.access.org_resolution._path_to_organisation",
            return_value="organisation__id",
        ), patch(
            "api.utils.access.org_resolution.cache", new=_BrokenCache()
        ):
            result = resolve_org_id("app_id", "app-4", {})

        self.assertEqual(result, "org-from-db")

    def test_provider_id_alias_resolves(self):
        """Regression: provider_id was the middleware bypass that motivated
        the auto-discovery refactor. It must resolve via the
        OrganisationSSOProvider alias."""
        from api.utils.access.org_resolution import resolve_org_id

        mock_model = MagicMock()
        mock_model.objects.filter.return_value.values_list.return_value.first.return_value = (
            "org-for-provider"
        )

        with patch(
            "api.utils.access.org_resolution.apps.get_model",
            return_value=mock_model,
        ) as mock_get, patch(
            "api.utils.access.org_resolution._path_to_organisation",
            return_value="organisation__id",
        ):
            result = resolve_org_id("provider_id", "p-1", {})

        self.assertEqual(result, "org-for-provider")
        # Must have looked up the right Django model.
        mock_get.assert_called_once_with("api", "OrganisationSSOProvider")


class InvalidationTest(unittest.TestCase):
    """post_delete signal drops the cache entry so hard-deleted resources
    don't leave stale mappings in Redis."""

    def setUp(self):
        cache.clear()

    def test_invalidate_drops_cache_entry(self):
        from api.utils.access.org_resolution import invalidate_org_for
        from api.models import App

        cache.set("org_for:app:some-id", "org-1", timeout=60)
        self.assertEqual(cache.get("org_for:app:some-id"), "org-1")

        instance = MagicMock()
        instance.pk = "some-id"
        invalidate_org_for(App, instance.pk)
        self.assertIsNone(cache.get("org_for:app:some-id"))

    def test_invalidate_covers_aliased_kind(self):
        """OrganisationSSOProvider is cached under the alias kwarg prefix
        ('provider') because that's the only kwarg shape resolvers use.
        Invalidation must clear that key."""
        from api.utils.access.org_resolution import invalidate_org_for
        from api.models import OrganisationSSOProvider

        cache.set("org_for:provider:p-1", "org-a", timeout=60)
        invalidate_org_for(OrganisationSSOProvider, "p-1")
        self.assertIsNone(cache.get("org_for:provider:p-1"))


class MiddlewareFastPathTest(unittest.TestCase):
    """The session fast-path skips the decision cache and DB lookup
    entirely when the session is already SSO-bound to the target org."""

    class _StubRequest:
        def __init__(self, session):
            self.user = type("U", (), {"is_authenticated": True})()
            self.session = session

    def _info(self, session):
        info = MagicMock()
        info.context = self._StubRequest(session)
        return info

    def _next(self, root, info, **kwargs):
        return "ran"

    @patch("backend.graphene.middleware.Organisation")
    def test_sso_session_bound_to_org_skips_db(self, mock_org_cls):
        """Session has auth_method=sso + matching auth_sso_org_id → no
        DB query, no cache lookup, just pass through."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        mw = OrgSSOEnforcementMiddleware()
        result = mw.resolve(
            self._next,
            None,
            self._info({"auth_method": "sso", "auth_sso_org_id": "org-1"}),
            organisation_id="org-1",
        )

        self.assertEqual(result, "ran")
        mock_org_cls.objects.only.return_value.get.assert_not_called()

    @patch("backend.graphene.middleware.Organisation")
    def test_sso_session_bound_to_different_org_does_not_skip(
        self, mock_org_cls
    ):
        """Session bound to org A must NOT short-circuit for requests
        targeting org B — the DB check must run to enforce B's require_sso."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        cache.clear()
        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org

        mw = OrgSSOEnforcementMiddleware()
        mw.resolve(
            self._next,
            None,
            self._info({"auth_method": "sso", "auth_sso_org_id": "org-A"}),
            organisation_id="org-B",
        )

        mock_org_cls.objects.only.return_value.get.assert_called_once()


if __name__ == "__main__":
    unittest.main()
