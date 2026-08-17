"""Log stream queries: permission + global-access gating.

Streams export org-wide activity, so read access additionally requires a
role with global access — a scoped custom role holding LogStreams:read must
not see org-wide egress configuration or delivery history.
"""

from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from ee.integrations.logs.streams.graphene import queries

_Q = "ee.integrations.logs.streams.graphene.queries"


def test_resolve_log_streams_requires_global_access():
    org = MagicMock()

    with patch(f"{_Q}.Organisation") as MockOrg, patch(
        f"{_Q}.user_has_permission", return_value=True
    ), patch(f"{_Q}.user_has_global_access", return_value=False):
        MockOrg.objects.get.return_value = org

        assert queries.resolve_log_streams(None, MagicMock(), "org-1") == []


def test_resolve_deliveries_requires_global_access():
    stream = MagicMock()

    with patch(f"{_Q}.LogStream") as MockStream, patch(
        f"{_Q}.user_has_permission", return_value=True
    ), patch(f"{_Q}.user_has_global_access", return_value=False):
        MockStream.objects.get.return_value = stream

        with pytest.raises(GraphQLError, match="permission"):
            queries.resolve_log_stream_deliveries(None, MagicMock(), "s-1")
