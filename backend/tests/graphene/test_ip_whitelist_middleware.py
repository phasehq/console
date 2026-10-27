"""IPWhitelistMiddleware refuses signed-out requests. A mutation that ends the
session itself (account deletion, SSO enforcement) must still return its result."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import graphene
from django.contrib.auth.models import AnonymousUser

from backend.graphene.middleware import IPWhitelistMiddleware


class EndSession(graphene.Mutation):
    ok = graphene.Boolean()

    def mutate(root, info):
        info.context.user = AnonymousUser()  # what logout(request) does
        return EndSession(ok=True)


class Query(graphene.ObjectType):
    ping = graphene.Boolean()

    def resolve_ping(root, info):
        return True


class Mutation(graphene.ObjectType):
    end_session = EndSession.Field()


schema = graphene.Schema(query=Query, mutation=Mutation)


def _execute(query, user):
    return schema.execute(
        query,
        context_value=SimpleNamespace(user=user),
        middleware=[IPWhitelistMiddleware()],
    )


def test_signed_out_requests_are_refused():
    result = _execute("{ ping }", AnonymousUser())

    assert [error.message for error in result.errors] == ["Authentication required"]


def test_a_mutation_that_ends_the_session_returns_its_result():
    result = _execute(
        "mutation { endSession { ok } }", MagicMock(is_authenticated=True)
    )

    assert result.errors is None
    assert result.data == {"endSession": {"ok": True}}
