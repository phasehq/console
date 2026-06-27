"""
DB-backed tests for Lockbox disclosure/consumption.

These exercise the real ORM (no mocks) against a real database so they actually
cover the behaviour the feature depends on:
  - GET returns metadata only and never consumes a view or leaks the payload
  - POST (reveal) is the sole discloser and atomically consumes exactly one view
  - the view limit is enforced server-side and cannot be exceeded
"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from api.models import Lockbox
from api.views.lockbox import LockboxView

pytestmark = pytest.mark.django_db

factory = APIRequestFactory()
view = LockboxView.as_view()

CIPHERTEXT = {"data": "encrypted-payload", "nonce": "abc"}


def make_box(allowed_views=1, views=0, expires_at=None, data=None):
    return Lockbox.objects.create(
        data=data if data is not None else CIPHERTEXT,
        views=views,
        allowed_views=allowed_views,
        expires_at=expires_at,
    )


class TestGetIsMetadataOnly:
    def test_get_returns_metadata_without_payload(self):
        box = make_box(allowed_views=1)
        response = view(factory.get(f"/lockbox/{box.id}"), box_id=box.id)
        assert response.status_code == 200
        # The ciphertext must never be served from GET.
        assert "data" not in response.data
        assert str(response.data["id"]) == str(box.id)

    def test_get_does_not_consume_a_view(self):
        box = make_box(allowed_views=1)
        view(factory.get(f"/lockbox/{box.id}"), box_id=box.id)
        box.refresh_from_db()
        assert box.views == 0

    def test_repeated_gets_never_consume(self):
        # Models a one-time link being fetched by unfurlers / link scanners / refreshes.
        box = make_box(allowed_views=1)
        for _ in range(5):
            assert view(factory.get(f"/lockbox/{box.id}"), box_id=box.id).status_code == 200
        box.refresh_from_db()
        assert box.views == 0  # the human can still reveal it once

    def test_get_403_once_limit_reached(self):
        box = make_box(allowed_views=1, views=1)
        assert view(factory.get(f"/lockbox/{box.id}"), box_id=box.id).status_code == 403


class TestRevealConsumesAndEnforces:
    def test_reveal_returns_payload_and_consumes_one_view(self):
        box = make_box(allowed_views=1)
        response = view(factory.post(f"/lockbox/{box.id}"), box_id=box.id)
        assert response.status_code == 200
        assert response.data["data"] == CIPHERTEXT  # payload disclosed here, and only here
        box.refresh_from_db()
        assert box.views == 1

    def test_reveal_enforces_limit_across_calls(self):
        box = make_box(allowed_views=2)
        assert view(factory.post(f"/lockbox/{box.id}"), box_id=box.id).status_code == 200
        assert view(factory.post(f"/lockbox/{box.id}"), box_id=box.id).status_code == 200
        third = view(factory.post(f"/lockbox/{box.id}"), box_id=box.id)
        assert third.status_code == 403  # third reveal is refused
        box.refresh_from_db()
        assert box.views == 2  # never advanced past the limit

    def test_reveal_response_reports_post_increment_count(self):
        # Finding #3: the returned count reflects this consumption, not the stale pre-count.
        box = make_box(allowed_views=3, views=0)
        response = view(factory.post(f"/lockbox/{box.id}"), box_id=box.id)
        assert response.data["views"] == 1

    def test_unlimited_box_reveals_without_blocking(self):
        box = make_box(allowed_views=None, views=100)
        assert view(factory.post(f"/lockbox/{box.id}"), box_id=box.id).status_code == 200
        assert view(factory.get(f"/lockbox/{box.id}"), box_id=box.id).status_code == 200


class TestLifecycleEdges:
    def test_expired_box_404_on_both_methods(self):
        box = make_box(expires_at=timezone.now() - timedelta(minutes=1))
        assert view(factory.get(f"/lockbox/{box.id}"), box_id=box.id).status_code == 404
        assert view(factory.post(f"/lockbox/{box.id}"), box_id=box.id).status_code == 404

    def test_missing_box_404_on_both_methods(self):
        assert view(factory.get("/lockbox/nope"), box_id="nope").status_code == 404
        assert view(factory.post("/lockbox/nope"), box_id="nope").status_code == 404

    def test_put_method_is_gone(self):
        # The old client-fired PUT increment endpoint must not exist.
        box = make_box()
        assert view(factory.put(f"/lockbox/{box.id}"), box_id=box.id).status_code == 405
