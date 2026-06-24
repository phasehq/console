"""Tests for the gating on ServiceAccountType nested resolvers.

A reviewer found that any user with `Teams.read` could harvest team-
owned service-account tokens (raw token + wrapped_key_share +
identity_key) cross-team via:

    teams.members.serviceAccount.tokens

The fix gates `ServiceAccountType.resolve_tokens` and `resolve_handlers`
through `_check_sa_permission`, returning [] when the caller can't
access the SA. These tests pin that behaviour at the resolver level,
mocking the underlying permission check so we exercise the resolver's
contract (returns [] vs returns rows) without standing up a full DB.
"""

from unittest.mock import MagicMock, patch

from graphql import GraphQLError


def _info(user):
    info = MagicMock()
    info.context.user = user
    return info


def _make_sa(team=None):
    sa = MagicMock()
    sa.team = team
    sa.organisation = MagicMock()
    return sa


@patch("backend.graphene.types.ServiceAccountToken")
@patch("api.utils.access.permissions._check_sa_permission")
def test_resolve_tokens_returns_empty_when_caller_lacks_access(
    mock_check, mock_token_cls
):
    """Manager without team access → tokens resolver returns []. The
    main P0 vector — caller can reach the SA through teams.members but
    must not see the underlying token rows."""
    from backend.graphene.types import ServiceAccountType

    mock_check.side_effect = GraphQLError("denied")

    sa = _make_sa(team=MagicMock(id="team-1"))
    user = MagicMock()
    user.userId = "u1"

    result = ServiceAccountType.resolve_tokens(sa, _info(user))

    assert result == []
    mock_token_cls.objects.filter.assert_not_called()


@patch("backend.graphene.types.ServiceAccountToken")
@patch("api.utils.access.permissions._check_sa_permission")
def test_resolve_tokens_returns_rows_when_authorised(
    mock_check, mock_token_cls
):
    """Owner / team-member with the right permission → tokens are
    returned. Mocked check passes through (no exception)."""
    from backend.graphene.types import ServiceAccountType

    mock_check.return_value = None  # no exception → permitted

    sa = _make_sa(team=MagicMock(id="team-1"))
    user = MagicMock()
    user.userId = "u1"

    expected_qs = MagicMock()
    mock_token_cls.objects.filter.return_value = expected_qs

    result = ServiceAccountType.resolve_tokens(sa, _info(user))

    mock_token_cls.objects.filter.assert_called_once_with(
        service_account=sa, deleted_at=None
    )
    assert result is expected_qs
    # Confirm we actually invoked the gate with the right resource —
    # this is the difference between a token-leak and a metadata leak.
    args, _kwargs = mock_check.call_args
    assert args[2] == "read"
    assert args[3] == "ServiceAccountTokens"


@patch("backend.graphene.types.ServiceAccountHandler")
@patch("api.utils.access.permissions._check_sa_permission")
def test_resolve_handlers_returns_empty_when_caller_lacks_access(
    mock_check, mock_handler_cls
):
    """Same shape leak via `handlers` (exposes wrapped_keyring /
    wrapped_recovery via fields=__all__). Gate must reject the same
    way."""
    from backend.graphene.types import ServiceAccountType

    mock_check.side_effect = GraphQLError("denied")

    sa = _make_sa(team=MagicMock(id="team-1"))
    user = MagicMock()
    user.userId = "u1"

    result = ServiceAccountType.resolve_handlers(sa, _info(user))

    assert result == []
    mock_handler_cls.objects.filter.assert_not_called()


@patch("backend.graphene.types.ServiceAccountHandler")
@patch("api.utils.access.permissions._check_sa_permission")
def test_resolve_handlers_uses_serviceaccounts_resource(
    mock_check, mock_handler_cls
):
    """Handlers gate on `ServiceAccounts.read` (managing the SA itself),
    not `ServiceAccountTokens.read`. Pins the resource string so a
    future refactor can't silently weaken the check."""
    from backend.graphene.types import ServiceAccountType

    mock_check.return_value = None

    sa = _make_sa(team=MagicMock(id="team-1"))
    user = MagicMock()
    user.userId = "u1"

    ServiceAccountType.resolve_handlers(sa, _info(user))

    args, _kwargs = mock_check.call_args
    assert args[2] == "read"
    assert args[3] == "ServiceAccounts"


@patch("backend.graphene.types.ServiceAccountToken")
def test_resolve_tokens_uses_real_permission_path_for_org_level_sa(
    mock_token_cls,
):
    """End-to-end-ish: for an org-level (non-team) SA, the gate falls
    through to `user_has_permission` on the org. A user with no
    `ServiceAccountTokens.read` permission gets [].

    Exercises the real `_check_sa_permission` (no patch) so we confirm
    the relocation to api.utils.access.permissions didn't break
    behaviour for the org-level path."""
    from backend.graphene.types import ServiceAccountType

    sa = _make_sa(team=None)
    sa.organisation = MagicMock()
    user = MagicMock()
    user.userId = "u1"

    with patch(
        "api.utils.access.permissions.user_has_permission", return_value=False
    ):
        result = ServiceAccountType.resolve_tokens(sa, _info(user))

    assert result == []
    mock_token_cls.objects.filter.assert_not_called()
