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

    def test_log_stream_models_resolve(self):
        """The stream_id / delivery_event_id aliases depend on these BFS
        paths existing — LogStream via its direct organisation FK, delivery
        events through their stream."""
        from api.utils.access.org_resolution import _path_to_organisation
        self.assertEqual(_path_to_organisation("LogStream"), "organisation__id")
        path = _path_to_organisation("LogStreamDeliveryEvent")
        self.assertTrue(path.endswith("organisation__id"))
        self.assertIn("stream", path)

    def test_prefers_non_null_fks(self):
        """The shortest path can cross a nullable FK, which finds no org once
        it's NULL: root credentials are SET_NULL on delete, a lease a service
        account created has no organisation_member."""
        from api.utils.access.org_resolution import _path_to_organisation

        expected = {
            "RotatingSecret": "environment__app__organisation__id",
            "DynamicSecret": "environment__app__organisation__id",
            "DynamicSecretLease": "secret__environment__app__organisation__id",
            "EnvironmentSync": "environment__app__organisation__id",
            "EnvironmentKey": "environment__app__organisation__id",
            "EnvironmentToken": "environment__app__organisation__id",
        }
        for model_name, path in expected.items():
            self.assertEqual(_path_to_organisation(model_name), path, model_name)

    def test_only_models_without_a_non_null_path_cross_a_nullable_fk(self):
        """UserToken reaches its org only through a nullable FK."""
        from django.apps import apps
        from api.utils.access.org_resolution import _path_to_organisation

        crossing = set()
        for model in apps.get_app_config("api").get_models():
            path = _path_to_organisation(model.__name__)
            if not path:
                continue
            cls = model
            for name in path.split("__")[:-1]:
                field = cls._meta.get_field(name)
                if field.null:
                    crossing.add(model.__name__)
                    break
                cls = field.related_model

        self.assertEqual(crossing, {"UserToken"})


class ModelForKwargTest(unittest.TestCase):
    def test_model_for_kwarg(self):
        from api.utils.access.org_resolution import model_for_kwarg

        self.assertEqual(model_for_kwarg("app_id"), "App")
        self.assertEqual(model_for_kwarg("env_id"), "Environment")
        self.assertEqual(model_for_kwarg("folder_id"), "SecretFolder")
        self.assertEqual(model_for_kwarg("authentication_id"), "ProviderCredentials")
        self.assertEqual(model_for_kwarg("source_rotating_secret_id"), "RotatingSecret")
        self.assertEqual(model_for_kwarg("source_dynamic_secret_id"), "DynamicSecret")
        self.assertIsNone(model_for_kwarg("org_id"))
        self.assertIsNone(model_for_kwarg("token_id"))
        self.assertIsNone(model_for_kwarg("name"))

    def test_every_alias_names_a_model_with_a_path_to_organisation(self):
        """An alias to a missing model (e.g. `Folder`) resolves no org."""
        from api.utils.access.org_resolution import (
            KWARG_MODEL_ALIASES,
            _path_to_organisation,
        )

        for kwarg, model_name in KWARG_MODEL_ALIASES.items():
            self.assertIsNotNone(_path_to_organisation(model_name), kwarg)


class ResolveManyTest(unittest.TestCase):
    """resolve_org_ids_via_model: one query for many IDs, cached per request."""

    def test_one_lookup_per_request(self):
        from api.utils.access import org_resolution

        request_cache = {}
        with patch.object(
            org_resolution, "_orgs_by_pk", return_value={"s1": "org-a", "s2": "org-b"}
        ) as lookup:
            first = org_resolution.resolve_org_ids_via_model(
                "Secret", ["s1", "s2", "missing"], request_cache
            )
            second = org_resolution.resolve_org_ids_via_model(
                "Secret", ["s1", "s2", "missing"], request_cache
            )

        self.assertEqual(first, {"org-a", "org-b"})
        self.assertEqual(second, first)
        lookup.assert_called_once_with("Secret", ["s1", "s2", "missing"])

    def test_one_query_for_many_ids(self):
        from api.utils.access import org_resolution

        model = MagicMock()
        model.objects.filter.return_value.values_list.return_value = [
            ("s1", "org-a"),
            ("s2", "org-b"),
        ]
        with patch.object(
            org_resolution.apps, "get_model", return_value=model
        ), patch.object(
            org_resolution, "_path_to_organisation", return_value="organisation__id"
        ):
            found = org_resolution._orgs_by_pk("Secret", ["s1", "s2", "s3"])

        self.assertEqual(found, {"s1": "org-a", "s2": "org-b"})
        model.objects.filter.assert_called_once_with(pk__in=["s1", "s2", "s3"])
        model.objects.filter.return_value.values_list.assert_called_once_with(
            "pk", "organisation__id"
        )

    def test_a_malformed_id_does_not_hide_the_others(self):
        from api.utils.access import org_resolution

        def filter(**lookup):
            if "pk__in" in lookup or lookup["pk"] == "bad":
                raise ValueError("Field 'id' expected a number")
            rows = MagicMock()
            rows.values_list.return_value.first.return_value = "org-a"
            return rows

        model = MagicMock()
        model.objects.filter.side_effect = filter
        with patch.object(
            org_resolution.apps, "get_model", return_value=model
        ), patch.object(
            org_resolution, "_path_to_organisation", return_value="organisation__id"
        ):
            found = org_resolution._orgs_by_pk("Secret", ["1", "bad"])

        self.assertEqual(found, {"1": "org-a"})


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

    def test_log_stream_aliases_resolve(self):
        """Regression: stream_id / delivery_event_id were unresolvable —
        snake_to_pascal produces 'Stream'/'DeliveryEvent', which are not
        models, and an unresolvable kwarg is a silent SSO-enforcement
        bypass for the log stream toggle/delete/retry/deliveries ops."""
        from api.utils.access.org_resolution import resolve_org_id

        for kwarg, model_name in (
            ("stream_id", "LogStream"),
            ("delivery_event_id", "LogStreamDeliveryEvent"),
        ):
            cache.clear()
            mock_model = MagicMock()
            (
                mock_model.objects.filter.return_value.values_list.return_value.first.return_value
            ) = "org-resolved"

            with patch(
                "api.utils.access.org_resolution.apps.get_model",
                return_value=mock_model,
            ) as mock_get, patch(
                "api.utils.access.org_resolution._path_to_organisation",
                return_value="organisation__id",
            ):
                result = resolve_org_id(kwarg, "obj-1", {})

            self.assertEqual(result, "org-resolved")
            mock_get.assert_called_once_with("api", model_name)


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

    @patch("backend.graphene.middleware.OrganisationMember")
    @patch("backend.graphene.middleware.Organisation")
    def test_sso_session_bound_to_different_org_does_not_skip(
        self, mock_org_cls, mock_om_cls
    ):
        """Session bound to org A must NOT short-circuit for requests
        targeting org B — the DB check must run to enforce B's require_sso."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        cache.clear()
        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org
        mock_om_cls.objects.filter.return_value.exists.return_value = False

        mw = OrgSSOEnforcementMiddleware()
        mw.resolve(
            self._next,
            None,
            self._info({"auth_method": "sso", "auth_sso_org_id": "org-A"}),
            organisation_id="org-B",
        )

        mock_org_cls.objects.only.return_value.get.assert_called_once()


class MiddlewareSCIMEnforcementTest(unittest.TestCase):
    """SCIM-managed members must access via SSO regardless of the org's
    require_sso flag — the IdP is the source of truth for that
    membership. Per-org check, so multi-org users with non-SCIM
    memberships elsewhere are unaffected."""

    class _StubUser:
        is_authenticated = True

        def __init__(self, user_id="user-1"):
            self.userId = user_id

    class _StubRequest:
        def __init__(self, session, user=None):
            self.user = user or MiddlewareSCIMEnforcementTest._StubUser()
            self.session = session

    def _info(self, session, user=None):
        info = MagicMock()
        info.context = self._StubRequest(session, user)
        info.return_type = MagicMock()
        return info

    def _next(self, root, info, **kwargs):
        return "ran"

    def setUp(self):
        cache.clear()

    @patch("backend.graphene.middleware.OrganisationMember")
    @patch("backend.graphene.middleware.Organisation")
    def test_password_session_scim_managed_blocks(self, mock_org_cls, mock_om_cls):
        """Password-auth user accessing an org where they're SCIM-managed
        must be rejected even when require_sso is False."""
        from backend.graphene.middleware import (
            OrgSSOEnforcementMiddleware,
            SSORequiredError,
        )

        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org
        mock_om_cls.objects.filter.return_value.exists.return_value = True

        mw = OrgSSOEnforcementMiddleware()
        with self.assertRaises(SSORequiredError):
            mw.resolve(
                self._next,
                None,
                self._info({"auth_method": "password"}),
                organisation_id="org-1",
            )

    @patch("backend.graphene.middleware.OrganisationMember")
    @patch("backend.graphene.middleware.Organisation")
    def test_password_session_non_scim_member_allowed(
        self, mock_org_cls, mock_om_cls
    ):
        """Regression: password-auth user in an org with require_sso=False
        and no SCIM membership passes through — no false positives from
        the new branch."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org
        mock_om_cls.objects.filter.return_value.exists.return_value = False

        mw = OrgSSOEnforcementMiddleware()
        result = mw.resolve(
            self._next,
            None,
            self._info({"auth_method": "password"}),
            organisation_id="org-1",
        )
        self.assertEqual(result, "ran")

    @patch("backend.graphene.middleware.OrganisationMember")
    @patch("backend.graphene.middleware.Organisation")
    def test_scim_member_with_org_bound_sso_session_allowed(
        self, mock_org_cls, mock_om_cls
    ):
        """SCIM-managed member with a session SSO-bound to that org skips
        all checks via the existing fast path — SCIM lookup never even
        runs."""
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
        mock_om_cls.objects.filter.assert_not_called()

    @patch("backend.graphene.middleware.OrganisationMember")
    @patch("backend.graphene.middleware.Organisation")
    def test_password_session_scim_in_other_org_allowed_for_password_org(
        self, mock_org_cls, mock_om_cls
    ):
        """Multi-org isolation: a user who is SCIM-managed in org A can
        still password-auth into org C where they're a regular member —
        SCIM enforcement is per-(user, org), not global."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org_c = MagicMock(require_sso=False)
        org_c.name = "personal"
        mock_org_cls.objects.only.return_value.get.return_value = org_c
        # No SCIM membership in org C even though the user is SCIM-managed elsewhere.
        mock_om_cls.objects.filter.return_value.exists.return_value = False

        mw = OrgSSOEnforcementMiddleware()
        result = mw.resolve(
            self._next,
            None,
            self._info({"auth_method": "password"}),
            organisation_id="org-C",
        )
        self.assertEqual(result, "ran")

    @patch("backend.graphene.middleware._bypasses_sso_enforcement", return_value=True)
    @patch("backend.graphene.middleware.OrganisationMember")
    @patch("backend.graphene.middleware.Organisation")
    def test_bypass_flag_overrides_scim_enforcement(
        self, mock_org_cls, mock_om_cls, _mock_bypass
    ):
        """SSO admin recovery mutations carry bypass_sso_enforcement=True;
        SCIM enforcement must not block them, otherwise an admin who
        accidentally SCIM-locked themselves can't recover."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        mw = OrgSSOEnforcementMiddleware()
        result = mw.resolve(
            self._next,
            None,
            self._info({"auth_method": "password"}),
            organisation_id="org-1",
        )
        self.assertEqual(result, "ran")
        # Bypass short-circuits before any DB query.
        mock_org_cls.objects.only.return_value.get.assert_not_called()
        mock_om_cls.objects.filter.assert_not_called()

    @patch("backend.graphene.middleware.OrganisationMember")
    @patch("backend.graphene.middleware.Organisation")
    def test_scim_lookup_cached_per_request(self, mock_org_cls, mock_om_cls):
        """Within a single request, the SCIM membership query runs once
        per (user, org). A second resolver call with the same kwargs hits
        the request-scoped cache instead of the DB."""
        from backend.graphene.middleware import OrgSSOEnforcementMiddleware

        org = MagicMock(require_sso=False)
        org.name = "acme"
        mock_org_cls.objects.only.return_value.get.return_value = org
        mock_om_cls.objects.filter.return_value.exists.return_value = False

        mw = OrgSSOEnforcementMiddleware()
        info = self._info({"auth_method": "password"})

        mw.resolve(self._next, None, info, organisation_id="org-1")
        mw.resolve(self._next, None, info, organisation_id="org-1")

        # filter() called once across both resolves.
        self.assertEqual(mock_om_cls.objects.filter.call_count, 1)


if __name__ == "__main__":
    unittest.main()
