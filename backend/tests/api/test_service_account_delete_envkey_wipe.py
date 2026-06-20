"""ServiceAccount.delete() must wipe the SA's EnvironmentKey wrapping
material — otherwise wrapped_seed / wrapped_salt outlive the principal
in the DB and a backup or restore exposes deleted-SA env access.
"""
import uuid
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from api.models import ServiceAccount


@contextmanager
def _stub_sa(tokens_manager):
    """Provide a token-set manager that bypasses Django's reverse-relation
    assignment guard."""
    with patch.object(
        ServiceAccount,
        "serviceaccounttoken_set",
        new=property(lambda self: tokens_manager),
    ):
        yield


@patch("api.models.EnvironmentKey")
def test_sa_delete_wipes_environment_key_wrapping(MockEK):
    sa = ServiceAccount(id=uuid.uuid4(), name="victim")
    sa.save = MagicMock()
    tokens = MagicMock()

    with _stub_sa(tokens):
        sa.delete()

    # SA is soft-deleted.
    sa.save.assert_called_once()
    assert sa.deleted_at is not None

    # Tokens get soft-deleted via the related manager.
    tokens.filter.assert_called_once_with(deleted_at__isnull=True)
    tokens.filter.return_value.update.assert_called_once()

    # EnvironmentKey rows for this SA are soft-deleted AND wiped — pin
    # the wipe kwargs so a future refactor can't quietly drop them.
    MockEK.objects.filter.assert_called_once_with(
        service_account=sa, deleted_at__isnull=True
    )
    update = MockEK.objects.filter.return_value.update
    update.assert_called_once()
    kwargs = update.call_args.kwargs
    assert kwargs["wrapped_seed"] == ""
    assert kwargs["wrapped_salt"] == ""
    assert kwargs["identity_key"] == ""
    assert "deleted_at" in kwargs


@patch("api.models.EnvironmentKey")
def test_sa_delete_skips_already_deleted_envkeys(MockEK):
    """The filter must restrict to deleted_at__isnull=True so already-
    soft-deleted EKs aren't touched again (would clobber their original
    deletion timestamp)."""
    sa = ServiceAccount(id=uuid.uuid4(), name="victim")
    sa.save = MagicMock()

    with _stub_sa(MagicMock()):
        sa.delete()

    filter_kwargs = MockEK.objects.filter.call_args.kwargs
    assert filter_kwargs.get("deleted_at__isnull") is True
