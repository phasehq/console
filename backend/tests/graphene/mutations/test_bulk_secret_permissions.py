"""Each bulk secret mutation checks its own Secrets action: creating needs
"create", editing needs "update" and deleting needs "delete". The console
sends all three in one request, so a role can hold any subset of them.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from backend.graphene.mutations.environment import (
    BulkCreateSecretMutation,
    BulkDeleteSecretMutation,
    BulkEditSecretMutation,
)

ENV_MUTATIONS = "backend.graphene.mutations.environment"


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _secret_input(**overrides):
    data = {
        "id": "secret-1",
        "env_id": "env-dev",
        "path": "/",
        "key": "encrypted-key",
        "key_digest": "digest",
        "value": "encrypted-value",
        "tags": [],
        "comment": "",
        "type": None,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


@pytest.fixture
def secrets():
    """Patch the models and helpers the bulk mutations touch. `allow` sets the
    Secrets actions the caller's role holds."""
    with ExitStack() as stack:
        m = MagicMock()
        for name in (
            "Environment",
            "Secret",
            "SecretTag",
            "OrganisationMember",
            "log_secret_events_bulk",
        ):
            stack.enter_context(patch(f"{ENV_MUTATIONS}.{name}", getattr(m, name)))
        stack.enter_context(
            patch(f"{ENV_MUTATIONS}.user_can_access_environment", return_value=True)
        )
        stack.enter_context(
            patch(
                f"{ENV_MUTATIONS}.get_resolver_request_meta",
                return_value=("127.0.0.1", "pytest"),
            )
        )

        granted = set()

        def has_permission(user, action, resource, org, is_app_resource, app=None):
            m.checks.append((action, resource, is_app_resource))
            return resource == "Secrets" and action in granted

        m.checks = []
        m.allow = lambda *actions: granted.update(actions)
        stack.enter_context(
            patch(f"{ENV_MUTATIONS}.user_has_permission", side_effect=has_permission)
        )

        existing = MagicMock(id="secret-1", type="secret", version=3)
        existing.rotating_secret_id = None
        m.Secret.objects.get.return_value = existing
        m.existing = existing
        yield m


def test_edit_checks_the_update_permission(secrets):
    secrets.allow("update")

    BulkEditSecretMutation.mutate(None, _info(), secrets_data=[_secret_input()])

    assert secrets.checks == [("update", "Secrets", True)]


def test_edit_is_allowed_without_the_create_permission(secrets):
    secrets.allow("read", "update")

    result = BulkEditSecretMutation.mutate(
        None, _info(), secrets_data=[_secret_input(comment="rotated")]
    )

    assert result.secrets == [secrets.existing]
    assert secrets.existing.comment == "rotated"
    assert secrets.existing.version == 4
    secrets.existing.save.assert_called_once()


def test_edit_is_rejected_with_only_the_create_permission(secrets):
    secrets.allow("create", "read", "delete")

    with pytest.raises(GraphQLError, match="permission to update secrets"):
        BulkEditSecretMutation.mutate(
            None, _info(), secrets_data=[_secret_input(comment="rotated")]
        )

    secrets.existing.save.assert_not_called()
    secrets.log_secret_events_bulk.assert_not_called()


def test_create_checks_the_create_permission(secrets):
    secrets.allow("create")

    BulkCreateSecretMutation.mutate(
        None, _info(), secrets_data=[_secret_input(id=None)]
    )

    assert secrets.checks == [("create", "Secrets", True)]


def test_create_is_rejected_with_only_the_update_permission(secrets):
    secrets.allow("read", "update", "delete")

    with pytest.raises(GraphQLError, match="permission to create secrets"):
        BulkCreateSecretMutation.mutate(
            None, _info(), secrets_data=[_secret_input(id=None)]
        )

    secrets.Secret.return_value.save.assert_not_called()


def test_delete_checks_the_delete_permission(secrets):
    secrets.allow("delete")

    BulkDeleteSecretMutation.mutate(None, _info(), ids=["secret-1"])

    assert secrets.checks == [("delete", "Secrets", True)]


def test_delete_is_rejected_without_the_delete_permission(secrets):
    secrets.allow("create", "read", "update")

    with pytest.raises(GraphQLError, match="permission to delete secrets"):
        BulkDeleteSecretMutation.mutate(None, _info(), ids=["secret-1"])

    secrets.existing.save.assert_not_called()


@pytest.mark.parametrize(
    "mutation, kwargs",
    [
        (BulkCreateSecretMutation, {"secrets_data": []}),
        (BulkEditSecretMutation, {"secrets_data": []}),
        (BulkDeleteSecretMutation, {"ids": []}),
    ],
)
def test_an_empty_list_needs_no_permission(secrets, mutation, kwargs):
    """The console always sends the three mutations together, with empty lists
    for the ones that have nothing to do."""
    result = mutation.mutate(None, _info(), **kwargs)

    assert result.secrets == []
    assert secrets.checks == []
