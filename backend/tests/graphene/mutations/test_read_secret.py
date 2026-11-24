"""ReadSecretMutation records a read for each secret a user reveals.

Revealing a whole grid sends every id in view at once, so the secrets are
fetched together and access is checked once per environment, with the result
unchanged: a read per id sent, or nothing at all if the caller lacks one of
the environments.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

_M = "backend.graphene.mutations.environment"


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _secret(secret_id, environment_id="env-dev"):
    return SimpleNamespace(
        id=secret_id,
        environment_id=environment_id,
        environment=SimpleNamespace(id=environment_id, app=SimpleNamespace(organisation="org")),
    )


class _Read:
    """Runs the mutation against the secrets that exist; keeps the mocks for assertions."""

    def __init__(self, existing, accessible=("env-dev", "env-prod")):
        self.existing = existing
        self.accessible = accessible

    def __call__(self, ids):
        from backend.graphene.mutations.environment import ReadSecretMutation

        with ExitStack() as stack:
            self.secrets = stack.enter_context(patch(f"{_M}.Secret"))
            self.access = stack.enter_context(
                patch(
                    f"{_M}.user_can_access_environment",
                    side_effect=lambda user_id, env_id: env_id in self.accessible,
                )
            )
            self.members = stack.enter_context(patch(f"{_M}.OrganisationMember"))
            self.log = stack.enter_context(patch(f"{_M}.log_secret_events_bulk"))
            stack.enter_context(
                patch(f"{_M}.get_resolver_request_meta", return_value=("127.0.0.1", "pytest"))
            )
            self.secrets.objects.filter.side_effect = self._fetch
            return ReadSecretMutation.mutate(None, _info(), ids)

    def _fetch(self, id__in):
        found = MagicMock()
        found.select_related.return_value = [s for s in self.existing if s.id in id__in]
        return found

    def logged(self):
        return [secret.id for secret in self.log.call_args.args[0]]


def test_logs_a_read_for_each_id_as_sent():
    dev, prod = _secret("s-dev"), _secret("s-prod", "env-prod")
    read = _Read([dev, prod])

    result = read(["s-prod", "s-gone", "s-dev", "s-prod"])

    assert result.ok is True
    # In the order sent, a repeat counted again, an id that matches nothing skipped
    assert read.logged() == ["s-prod", "s-dev", "s-prod"]
    secrets, event_type, member = read.log.call_args.args[:3]
    assert event_type == "R"
    assert member is read.members.objects.get.return_value


def test_refuses_everything_when_one_environment_is_out_of_reach():
    read = _Read([_secret("s-dev"), _secret("s-prod", "env-prod")], accessible=("env-dev",))

    with pytest.raises(GraphQLError, match="don't have permission"):
        read(["s-dev", "s-prod"])

    read.log.assert_not_called()


def test_ids_that_match_nothing_log_nothing():
    read = _Read([])

    assert read(["s-gone"]).ok is True

    read.access.assert_not_called()
    read.members.objects.get.assert_not_called()
    read.log.assert_not_called()


@pytest.mark.parametrize("count", [3, 300])
def test_lookups_do_not_grow_with_the_number_of_ids(count):
    existing = [_secret(f"s-{i}", "env-dev" if i % 2 else "env-prod") for i in range(count)]
    read = _Read(existing)

    read([secret.id for secret in existing])

    assert len(read.logged()) == count
    # One fetch for all of them, one access check per environment
    read.secrets.objects.filter.assert_called_once()
    read.secrets.objects.get.assert_not_called()
    assert sorted(call.args[1] for call in read.access.call_args_list) == ["env-dev", "env-prod"]
