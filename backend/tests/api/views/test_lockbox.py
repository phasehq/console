import pytest
from unittest.mock import MagicMock, patch
from django.test import RequestFactory
from api.views.lockbox import LockboxView
from api.models import Lockbox as RealLockbox


class TestLockboxViewCounting:
    """Tests that lockbox view counting is enforced server-side."""

    @patch("api.views.lockbox.transaction")
    @patch("api.views.lockbox.Lockbox")
    @patch("api.views.lockbox.LockboxSerializer")
    def test_get_increments_view_count_atomically(
        self, MockSerializer, MockLockbox, mock_transaction
    ):
        """GET should atomically increment the view count."""
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        mock_transaction.atomic.return_value.__enter__ = MagicMock()
        mock_transaction.atomic.return_value.__exit__ = MagicMock(return_value=False)

        mock_box = MagicMock()
        mock_box.id = "box-123"
        mock_box.allowed_views = 3
        mock_box.views = 0

        mock_qs = MagicMock()
        mock_qs.get.return_value = mock_box
        MockLockbox.objects.select_for_update.return_value = mock_qs

        mock_filter_qs = MagicMock()
        MockLockbox.objects.filter.return_value = mock_filter_qs

        MockSerializer.return_value = MagicMock(data={"data": "encrypted"})

        factory = RequestFactory()
        request = factory.get("/lockbox/box-123")

        view = LockboxView()
        response = view.get(request, "box-123")

        assert response.status_code == 200
        MockLockbox.objects.filter.assert_called_once_with(id="box-123")
        mock_filter_qs.update.assert_called_once()

    @patch("api.views.lockbox.transaction")
    @patch("api.views.lockbox.Lockbox")
    def test_get_rejects_when_view_limit_reached(self, MockLockbox, mock_transaction):
        """GET should return 403 when allowed_views is exhausted."""
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        mock_transaction.atomic.return_value.__enter__ = MagicMock()
        mock_transaction.atomic.return_value.__exit__ = MagicMock(return_value=False)

        mock_box = MagicMock()
        mock_box.id = "box-123"
        mock_box.allowed_views = 1
        mock_box.views = 1

        mock_qs = MagicMock()
        mock_qs.get.return_value = mock_box
        MockLockbox.objects.select_for_update.return_value = mock_qs

        factory = RequestFactory()
        request = factory.get("/lockbox/box-123")

        view = LockboxView()
        response = view.get(request, "box-123")

        assert response.status_code == 403

    @patch("api.views.lockbox.transaction")
    @patch("api.views.lockbox.Lockbox")
    @patch("api.views.lockbox.LockboxSerializer")
    def test_get_allows_unlimited_views_when_allowed_views_is_none(
        self, MockSerializer, MockLockbox, mock_transaction
    ):
        """GET should allow reads when allowed_views is None (unlimited)."""
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        mock_transaction.atomic.return_value.__enter__ = MagicMock()
        mock_transaction.atomic.return_value.__exit__ = MagicMock(return_value=False)

        mock_box = MagicMock()
        mock_box.id = "box-123"
        mock_box.allowed_views = None
        mock_box.views = 100

        mock_qs = MagicMock()
        mock_qs.get.return_value = mock_box
        MockLockbox.objects.select_for_update.return_value = mock_qs

        mock_filter_qs = MagicMock()
        MockLockbox.objects.filter.return_value = mock_filter_qs

        MockSerializer.return_value = MagicMock(data={"data": "encrypted"})

        factory = RequestFactory()
        request = factory.get("/lockbox/box-123")

        view = LockboxView()
        response = view.get(request, "box-123")

        assert response.status_code == 200

    @patch("api.views.lockbox.transaction")
    @patch("api.views.lockbox.Lockbox")
    def test_get_returns_404_for_nonexistent_box(self, MockLockbox, mock_transaction):
        """GET should return 404 for missing lockboxes."""
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        mock_transaction.atomic.return_value.__enter__ = MagicMock()
        mock_transaction.atomic.return_value.__exit__ = MagicMock(return_value=False)

        mock_qs = MagicMock()
        mock_qs.get.side_effect = RealLockbox.DoesNotExist
        MockLockbox.objects.select_for_update.return_value = mock_qs

        factory = RequestFactory()
        request = factory.get("/lockbox/missing-id")

        view = LockboxView()
        response = view.get(request, "missing-id")

        assert response.status_code == 404

    def test_no_put_method(self):
        """LockboxView should not have a PUT method."""
        assert not hasattr(LockboxView, "put") or not callable(
            getattr(LockboxView, "put", None)
        )
