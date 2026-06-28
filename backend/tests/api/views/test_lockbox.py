"""
Unit tests for Lockbox disclosure / consumption.

These mock the ORM (no database required) but assert the security-relevant SHAPE
of the view, so they fail if the enforcement is weakened:

  - GET returns metadata only and NEVER consumes a view or touches the counter
    (so link unfurlers / scanners / refreshes can't burn a one-time box).
  - POST (reveal) is the only path that discloses the payload and the only one
    that consumes a view, and it does so atomically: row-locked inside a
    transaction, incrementing via an F() expression (not a read-modify-write).
"""

from unittest.mock import MagicMock, patch

from django.db.models.expressions import CombinedExpression
from django.test import RequestFactory

from api.models import Lockbox as RealLockbox
from api.views.lockbox import LockboxView

factory = RequestFactory()


def _mock_box(views=0, allowed_views=1):
    box = MagicMock()
    box.id = "box-123"
    box.views = views  # real ints so the limit comparison is real
    box.allowed_views = allowed_views
    return box


class TestGetIsMetadataOnly:
    @patch("api.views.lockbox.LockboxMetadataSerializer")
    @patch("api.views.lockbox.LockboxSerializer")
    @patch("api.views.lockbox.Lockbox")
    def test_get_uses_metadata_serializer_not_payload(self, MockLockbox, MockPayload, MockMeta):
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        MockLockbox.objects.get.return_value = _mock_box(views=0, allowed_views=1)
        MockMeta.return_value = MagicMock(data={"id": "box-123"})

        response = LockboxView().get(factory.get("/lockbox/box-123"), "box-123")

        assert response.status_code == 200
        MockMeta.assert_called_once()  # metadata is rendered
        MockPayload.assert_not_called()  # the ciphertext serializer is NOT used on GET

    @patch("api.views.lockbox.LockboxMetadataSerializer")
    @patch("api.views.lockbox.Lockbox")
    def test_get_never_consumes_a_view(self, MockLockbox, MockMeta):
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        MockLockbox.objects.get.return_value = _mock_box(views=0, allowed_views=1)

        LockboxView().get(factory.get("/lockbox/box-123"), "box-123")

        # No write path on GET: the counter is never locked or updated.
        MockLockbox.objects.filter.assert_not_called()
        MockLockbox.objects.select_for_update.assert_not_called()

    @patch("api.views.lockbox.Lockbox")
    def test_get_403_when_limit_reached(self, MockLockbox):
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        MockLockbox.objects.get.return_value = _mock_box(views=1, allowed_views=1)
        response = LockboxView().get(factory.get("/lockbox/box-123"), "box-123")
        assert response.status_code == 403

    @patch("api.views.lockbox.Lockbox")
    def test_get_404_when_missing(self, MockLockbox):
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        MockLockbox.objects.get.side_effect = RealLockbox.DoesNotExist
        response = LockboxView().get(factory.get("/lockbox/missing"), "missing")
        assert response.status_code == 404


class TestRevealConsumesAtomically:
    @staticmethod
    def _wire(MockLockbox, mock_transaction, box):
        MockLockbox.DoesNotExist = RealLockbox.DoesNotExist
        mock_transaction.atomic.return_value.__enter__ = MagicMock()
        mock_transaction.atomic.return_value.__exit__ = MagicMock(return_value=False)
        MockLockbox.objects.select_for_update.return_value.get.return_value = box

    @patch("api.views.lockbox.LockboxSerializer")
    @patch("api.views.lockbox.transaction")
    @patch("api.views.lockbox.Lockbox")
    def test_reveal_locks_increments_with_F_and_discloses(
        self, MockLockbox, mock_transaction, MockPayload
    ):
        box = _mock_box(views=0, allowed_views=1)
        self._wire(MockLockbox, mock_transaction, box)
        MockPayload.return_value = MagicMock(data={"data": "ciphertext"})

        response = LockboxView().post(factory.post("/lockbox/box-123"), "box-123")

        assert response.status_code == 200
        # Locked inside a transaction.
        mock_transaction.atomic.assert_called_once()
        MockLockbox.objects.select_for_update.assert_called_once()
        # Consumed atomically via an F() expression, scoped to this box...
        MockLockbox.objects.filter.assert_called_once_with(id="box-123")
        update_kwargs = MockLockbox.objects.filter.return_value.update.call_args.kwargs
        assert isinstance(update_kwargs["views"], CombinedExpression)  # F("views") + 1, not a literal
        # ...NOT the racy read-modify-write that this fix replaced.
        box.save.assert_not_called()
        # Response reflects the post-increment count (finding #3) and returns the payload.
        box.refresh_from_db.assert_called_once()
        MockPayload.assert_called_once_with(box)

    @patch("api.views.lockbox.LockboxSerializer")
    @patch("api.views.lockbox.transaction")
    @patch("api.views.lockbox.Lockbox")
    def test_reveal_403_when_limit_reached_consumes_and_discloses_nothing(
        self, MockLockbox, mock_transaction, MockPayload
    ):
        box = _mock_box(views=1, allowed_views=1)
        self._wire(MockLockbox, mock_transaction, box)

        response = LockboxView().post(factory.post("/lockbox/box-123"), "box-123")

        assert response.status_code == 403
        MockLockbox.objects.filter.assert_not_called()  # refused reveal consumes nothing
        MockPayload.assert_not_called()  # and discloses nothing

    @patch("api.views.lockbox.transaction")
    @patch("api.views.lockbox.Lockbox")
    def test_reveal_404_when_missing(self, MockLockbox, mock_transaction):
        self._wire(MockLockbox, mock_transaction, _mock_box())
        MockLockbox.objects.select_for_update.return_value.get.side_effect = (
            RealLockbox.DoesNotExist
        )
        response = LockboxView().post(factory.post("/lockbox/missing"), "missing")
        assert response.status_code == 404


class TestNoLegacyPutEndpoint:
    def test_put_method_removed(self):
        # The old client-fired PUT increment endpoint must not exist.
        assert not hasattr(LockboxView, "put")
