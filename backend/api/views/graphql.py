import logging

from django.contrib.auth.mixins import LoginRequiredMixin
from django.db import Error as DatabaseError
from graphene_django.views import GraphQLView
from graphql import specified_rules

from backend.graphene.validation import DuplicateFieldLimitRule, AliasUsageLimitRule

logger = logging.getLogger(__name__)

CUSTOM_RULES = tuple(specified_rules) + (
    DuplicateFieldLimitRule,
    AliasUsageLimitRule,
)

ALREADY_EXISTS_MESSAGE = "A record with these details already exists."
UNEXPECTED_ERROR_MESSAGE = "Something went wrong. Please try again."

# PostgreSQL's code for a unique constraint violation
UNIQUE_VIOLATION = "23505"

# Raised by a mistake in the code, never on purpose with a message for the user
PROGRAMMING_ERRORS = (TypeError, AttributeError, KeyError, IndexError)


class PrivateGraphQLView(LoginRequiredMixin, GraphQLView):
    raise_exception = True
    validation_rules = CUSTOM_RULES

    @staticmethod
    def format_error(error):
        """Some errors are written for developers, not users. Database errors
        name the engine, tables, constraints and values; programming errors
        name functions and attributes. A resolver that lets one through gets
        it logged here and replaced with a fixed message."""
        formatted = GraphQLView.format_error(error)

        cause = getattr(error, "original_error", None)
        path = getattr(error, "path", None) or []
        operation = ".".join(str(step) for step in path)
        if isinstance(cause, DatabaseError):
            if getattr(cause.__cause__, "pgcode", None) == UNIQUE_VIOLATION:
                logger.warning("GraphQL %s: %s", operation, str(cause).strip())
                formatted["message"] = ALREADY_EXISTS_MESSAGE
            else:
                logger.error(
                    "GraphQL %s: unhandled database error", operation, exc_info=cause
                )
                formatted["message"] = UNEXPECTED_ERROR_MESSAGE
        elif isinstance(cause, PROGRAMMING_ERRORS):
            logger.error("GraphQL %s: unhandled error", operation, exc_info=cause)
            formatted["message"] = UNEXPECTED_ERROR_MESSAGE

        return formatted
