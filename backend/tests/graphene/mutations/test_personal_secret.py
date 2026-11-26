"""Personal secret override mutations must return GraphQLError for missing,
soft-deleted, or inaccessible secrets instead of leaking raw ORM DoesNotExist
exceptions.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

_M = "backend.graphene.mutations.environment"


class _DoesNotExist(Exception):
    pass


def _info():
    info = MagicMock()
    info.context.user.userId = "user-1"
    return info


def _secret(secret_id="secret-1", env_id="env-1"):
    return SimpleNamespace(
        id=secret_id,
        environment=SimpleNamespace(
            id=env_id,
            app=SimpleNamespace(organisation="org-1"),
        ),
    )


@pytest.fixture
def personal_mocks():
    with ExitStack() as stack:
        m = MagicMock()
        for name in ("Secret", "OrganisationMember", "PersonalSecret"):
            stack.enter_context(patch(f"{_M}.{name}", getattr(m, name)))

        m.Secret.DoesNotExist = _DoesNotExist
        m.OrganisationMember.DoesNotExist = _DoesNotExist
        m.Secret.objects.get.return_value = _secret()

        m.user_can_access_environment = stack.enter_context(
            patch(f"{_M}.user_can_access_environment", return_value=True)
        )
        m.override = MagicMock()
        m.PersonalSecret.objects.get_or_create.return_value = (m.override, True)
        yield m


def test_create_override_missing_secret_raises_graphql_error(personal_mocks):
    from backend.graphene.mutations.environment import CreatePersonalSecretMutation

    personal_mocks.Secret.objects.get.side_effect = _DoesNotExist()
    override_data = SimpleNamespace(secret_id="unsaved-id", value="val", is_active=True)

    with pytest.raises(GraphQLError, match="Secret not found"):
        CreatePersonalSecretMutation.mutate(None, _info(), override_data=override_data)

    personal_mocks.Secret.objects.get.assert_called_once_with(
        id="unsaved-id", deleted_at=None
    )
    personal_mocks.PersonalSecret.objects.get_or_create.assert_not_called()


def test_create_override_empty_input_raises_graphql_error(personal_mocks):
    from backend.graphene.mutations.environment import CreatePersonalSecretMutation

    with pytest.raises(GraphQLError, match="Secret not found"):
        CreatePersonalSecretMutation.mutate(None, _info(), override_data=None)

    personal_mocks.Secret.objects.get.assert_not_called()


def test_create_override_inaccessible_env_raises_graphql_error(personal_mocks):
    from backend.graphene.mutations.environment import CreatePersonalSecretMutation

    personal_mocks.user_can_access_environment.return_value = False
    override_data = SimpleNamespace(secret_id="secret-1", value="val", is_active=True)

    with pytest.raises(GraphQLError, match="You don't have access to this secret"):
        CreatePersonalSecretMutation.mutate(None, _info(), override_data=override_data)

    personal_mocks.OrganisationMember.objects.get.assert_not_called()
    personal_mocks.PersonalSecret.objects.get_or_create.assert_not_called()


def test_create_override_non_member_raises_graphql_error(personal_mocks):
    from backend.graphene.mutations.environment import CreatePersonalSecretMutation

    personal_mocks.OrganisationMember.objects.get.side_effect = _DoesNotExist()
    override_data = SimpleNamespace(secret_id="secret-1", value="val", is_active=True)

    with pytest.raises(GraphQLError, match="You don't have access to this secret"):
        CreatePersonalSecretMutation.mutate(None, _info(), override_data=override_data)

    personal_mocks.PersonalSecret.objects.get_or_create.assert_not_called()


def test_create_override_success(personal_mocks):
    from backend.graphene.mutations.environment import CreatePersonalSecretMutation

    override_data = SimpleNamespace(secret_id="secret-1", value="enc-val", is_active=True)

    result = CreatePersonalSecretMutation.mutate(
        None, _info(), override_data=override_data
    )

    assert result.override is personal_mocks.override
    assert personal_mocks.override.value == "enc-val"
    assert personal_mocks.override.is_active is True
    personal_mocks.override.save.assert_called_once_with()


def test_delete_override_missing_secret_raises_graphql_error(personal_mocks):
    from backend.graphene.mutations.environment import DeletePersonalSecretMutation

    personal_mocks.Secret.objects.get.side_effect = _DoesNotExist()

    with pytest.raises(GraphQLError, match="Secret not found"):
        DeletePersonalSecretMutation.mutate(None, _info(), secret_id="missing-id")

    personal_mocks.Secret.objects.get.assert_called_once_with(
        id="missing-id", deleted_at=None
    )
    personal_mocks.PersonalSecret.objects.filter.assert_not_called()


def test_delete_override_inaccessible_env_raises_graphql_error(personal_mocks):
    from backend.graphene.mutations.environment import DeletePersonalSecretMutation

    personal_mocks.user_can_access_environment.return_value = False

    with pytest.raises(GraphQLError, match="You don't have access to this secret"):
        DeletePersonalSecretMutation.mutate(None, _info(), secret_id="secret-1")

    personal_mocks.OrganisationMember.objects.get.assert_not_called()
    personal_mocks.PersonalSecret.objects.filter.assert_not_called()


def test_delete_override_success(personal_mocks):
    from backend.graphene.mutations.environment import DeletePersonalSecretMutation

    result = DeletePersonalSecretMutation.mutate(None, _info(), secret_id="secret-1")

    assert result.ok is True
    personal_mocks.PersonalSecret.objects.filter.assert_called_once_with(
        secret_id="secret-1",
        user=personal_mocks.OrganisationMember.objects.get.return_value,
    )
    personal_mocks.PersonalSecret.objects.filter.return_value.delete.assert_called_once_with()
