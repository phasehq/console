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
