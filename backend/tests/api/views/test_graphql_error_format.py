"""A database error or a programming error raised inside a resolver is logged,
and the client gets a fixed message instead of the original text. Other
errors are passed on as they are."""

import logging
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.db import DataError, IntegrityError, OperationalError
from graphql import GraphQLError

from api.views.graphql import (
    ALREADY_EXISTS_MESSAGE,
    UNEXPECTED_ERROR_MESSAGE,
    PrivateGraphQLView,
)
from backend.schema import schema

DUPLICATE_KEY = (
    'duplicate key value violates unique constraint "api_app_pkey"\n'
    "DETAIL:  Key (id)=(0b0f4c5e) already exists.\n"
)


def _driver_error(pgcode):
    """Stands in for the psycopg2 exception Django chains its own error from."""
    return type("DriverError", (Exception,), {"pgcode": pgcode})()


def _unique_violation():
    error = IntegrityError(DUPLICATE_KEY)
    error.__cause__ = _driver_error("23505")
    return error


def _foreign_key_violation():
    error = IntegrityError(
        'insert or update on table "api_app" violates foreign key constraint '
        '"api_app_organisation_id_fk"'
    )
    error.__cause__ = _driver_error("23503")
    return error


def _formatted_errors(raised=None, query="{ organisations { id } }"):
    """Run `query` with the root resolver raising `raised`, then format the
    errors the way the view does."""
    field = schema.graphql_schema.query_type.fields["organisations"]
    with patch.object(field, "resolve", side_effect=raised):
        result = schema.execute(
            query, context_value=SimpleNamespace(user=SimpleNamespace(userId="u"))
        )
    return [PrivateGraphQLView.format_error(error) for error in result.errors]


def test_unique_violation_becomes_already_exists():
    (error,) = _formatted_errors(_unique_violation())

    assert error["message"] == ALREADY_EXISTS_MESSAGE
    assert error["path"] == ["organisations"]


@pytest.mark.parametrize(
    "raised",
    [
        _foreign_key_violation(),
        IntegrityError("null value in column violates not-null constraint"),
        DataError("value too long for type character varying(100)"),
        OperationalError("could not connect to server: Connection refused"),
    ],
)
def test_other_database_errors_become_a_fixed_message(raised):
    (error,) = _formatted_errors(raised)

    assert error["message"] == UNEXPECTED_ERROR_MESSAGE


@pytest.mark.parametrize(
    "raised", [_unique_violation(), DataError("value too long for type varchar")]
)
def test_driver_text_is_not_returned(raised):
    (error,) = _formatted_errors(raised)

    for fragment in ("constraint", "api_app", "0b0f4c5e", "varchar", "DETAIL"):
        assert fragment not in str(error)


def test_database_errors_are_logged_with_the_operation(caplog):
    with caplog.at_level(logging.WARNING, logger="api.views.graphql"):
        _formatted_errors(_unique_violation())
        _formatted_errors(DataError("value too long for type varchar"))

    duplicate, other = caplog.records
    assert duplicate.levelno == logging.WARNING
    assert "organisations" in duplicate.getMessage()
    assert "api_app_pkey" in duplicate.getMessage()
    assert other.levelno == logging.ERROR
    assert "organisations" in other.getMessage()
    assert isinstance(other.exc_info[1], DataError)


PROGRAMMING_ERRORS = [
    TypeError("Query.resolve_apps() missing 1 required positional argument: 'app_id'"),
    AttributeError("'NoneType' object has no attribute 'organisation'"),
    KeyError("private_key"),
    IndexError("list index out of range"),
]


@pytest.mark.parametrize("raised", PROGRAMMING_ERRORS)
def test_programming_errors_become_a_fixed_message(raised, caplog):
    with caplog.at_level(logging.WARNING, logger="api.views.graphql"):
        (error,) = _formatted_errors(raised)

    assert error["message"] == UNEXPECTED_ERROR_MESSAGE
    for fragment in ("resolve_apps", "NoneType", "private_key", "list index"):
        assert fragment not in str(error)

    (record,) = caplog.records
    assert record.levelno == logging.ERROR
    assert "organisations" in record.getMessage()
    assert record.exc_info[1] is raised


def test_an_error_without_a_path_is_formatted():
    """Not every error comes from a resolver."""
    assert PrivateGraphQLView.format_error(RuntimeError("no path")) == {
        "message": "no path"
    }


@pytest.mark.parametrize(
    "raised, message",
    [
        (GraphQLError("App name cannot be blank"), "App name cannot be blank"),
        # Messages written for the user that are not GraphQLErrors
        (
            ValueError("Cannot add more apps to this plan."),
            "Cannot add more apps to this plan.",
        ),
    ],
)
def test_messages_written_for_the_user_are_unchanged(raised, message, caplog):
    with caplog.at_level(logging.WARNING, logger="api.views.graphql"):
        (error,) = _formatted_errors(raised)

    assert error["message"] == message
    assert caplog.records == []


def test_query_errors_are_unchanged():
    (error,) = _formatted_errors(query="{ organisations { nope } }")

    assert "Cannot query field 'nope'" in error["message"]
