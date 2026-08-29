"""Truth table for SecretEventType.resolve_actor_deleted — the server-side
signal that distinguishes a hard-deleted account from engine-driven events
and permission-based nulling."""

import unittest
from unittest.mock import MagicMock


def _event(
    user_id=None,
    service_token_id=None,
    service_account_id=None,
    service_account_token_id=None,
    secret_id="sec-1",
    rotating_secret_id=None,
):
    event = MagicMock()
    event.user_id = user_id
    event.service_token_id = service_token_id
    event.service_account_id = service_account_id
    event.service_account_token_id = service_account_token_id
    event.secret_id = secret_id
    event.secret.rotating_secret_id = rotating_secret_id
    return event


def _resolve(event):
    from backend.graphene.types import SecretEventType

    return SecretEventType.resolve_actor_deleted(event, None)


class ActorDeletedResolverTest(unittest.TestCase):
    def test_all_null_on_plain_secret_is_deleted_actor(self):
        self.assertTrue(_resolve(_event()))

    def test_user_actor_present(self):
        self.assertFalse(_resolve(_event(user_id="om-1")))

    def test_service_token_actor_present(self):
        self.assertFalse(_resolve(_event(service_token_id="st-1")))

    def test_service_account_actor_present(self):
        self.assertFalse(_resolve(_event(service_account_id="sa-1")))

    def test_sa_token_actor_present(self):
        self.assertFalse(_resolve(_event(service_account_token_id="sat-1")))

    def test_synthetic_rotating_read_is_engine(self):
        # No secret at all — synthetic rotating-secret read events
        self.assertFalse(_resolve(_event(secret_id=None)))

    def test_rotating_output_secret_is_engine(self):
        self.assertFalse(_resolve(_event(rotating_secret_id="rs-1")))


if __name__ == "__main__":
    unittest.main()

# ---------------------------------------------------------------------------
# AuditEventType.resolve_actor_deleted — same signal for the audit log UI.
# Keyed on actor_id (member rows are hard-deleted only by account deletion;
# org removal soft-deletes and those rows still resolve).
# ---------------------------------------------------------------------------

from unittest.mock import patch


def _audit_event(actor_type="user", actor_id="om-1", annotated=None):
    event = MagicMock()
    event.actor_type = actor_type
    event.actor_id = actor_id
    if annotated is None:
        # Simulate a row without the list resolver's Exists annotation
        del event.actor_member_exists
    else:
        event.actor_member_exists = annotated
    return event


def _resolve_audit(event):
    from backend.graphene.types import AuditEventType

    return AuditEventType.resolve_actor_deleted(event, None)


class AuditActorDeletedResolverTest(unittest.TestCase):
    def test_sa_actor_never_deleted(self):
        self.assertFalse(_resolve_audit(_audit_event(actor_type="sa")))

    def test_missing_actor_id_never_deleted(self):
        self.assertFalse(_resolve_audit(_audit_event(actor_id="")))

    def test_annotated_member_exists(self):
        self.assertFalse(_resolve_audit(_audit_event(annotated=True)))

    def test_annotated_member_gone_is_deleted(self):
        self.assertTrue(_resolve_audit(_audit_event(annotated=False)))

    @patch("backend.graphene.types.OrganisationMember")
    def test_fallback_lookup_includes_soft_deleted_rows(self, mock_om):
        # Soft-deleted member row still exists -> removed from org, NOT a
        # deleted account: the unfiltered queryset must find it.
        mock_om.objects.filter.return_value.exists.return_value = True
        self.assertFalse(_resolve_audit(_audit_event()))
        mock_om.objects.filter.assert_called_once_with(id="om-1")

    @patch("backend.graphene.types.OrganisationMember")
    def test_fallback_lookup_no_row_is_deleted(self, mock_om):
        mock_om.objects.filter.return_value.exists.return_value = False
        self.assertTrue(_resolve_audit(_audit_event()))
