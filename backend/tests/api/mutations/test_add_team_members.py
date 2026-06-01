"""AddTeamMembersMutation: a team-owned ServiceAccount must not be
attachable to a different team. RemoveTeamMemberMutation already
enforced the symmetric guard (can't remove an SA from its owning team);
the add path had no equivalent, creating a cross-team exfiltration
channel where the owning team's handlers gain access to a foreign
team's secrets via the SA's tokens.
"""

from unittest.mock import MagicMock, patch

import pytest


_M = "backend.graphene.mutations.teams"


@pytest.fixture(autouse=True)
def _bypass_transaction_atomic():
    """The mutation is decorated with @transaction.atomic, which opens a
    real DB connection. We mock every query the body issues, so the
    transaction wrapper is the only real DB touch — bypass it."""
    with patch("django.db.transaction.Atomic.__enter__", return_value=None), \
         patch("django.db.transaction.Atomic.__exit__", return_value=False):
        yield


def _info(user):
    info = MagicMock()
    info.context.user = user
    info.context.user.userId = "user-1"
    return info


@patch(f"{_M}._check_team_membership")
@patch(f"{_M}.user_has_permission", return_value=True)
@patch(f"{_M}.user_is_org_member", return_value=True)
@patch(f"{_M}.ServiceAccount")
@patch(f"{_M}.Team")
def test_refuses_attaching_sa_owned_by_another_team(
    MockTeam, MockSA, _mock_org, _mock_perm, _mock_team_member
):
    """SA whose team_id ≠ target team must be refused."""
    from backend.graphene.mutations.teams import AddTeamMembersMutation, MemberType
    from graphql import GraphQLError

    target_team = MagicMock(id="team-A", organisation=MagicMock(id="org-1"))
    MockTeam.objects.get.return_value = target_team

    foreign_sa = MagicMock(team_id="team-B")  # owned by a different team
    MockSA.objects.get.return_value = foreign_sa

    with pytest.raises(GraphQLError, match="owned by another team"):
        AddTeamMembersMutation.mutate(
            None, _info(MagicMock()),
            team_id="team-A",
            member_ids=["foreign-sa-id"],
            member_type=MemberType.SERVICE,
        )


@patch(f"{_M}._check_team_membership")
@patch(f"{_M}.user_has_permission", return_value=True)
@patch(f"{_M}.user_is_org_member", return_value=True)
@patch(f"{_M}.TeamAppEnvironment")
@patch(f"{_M}.TeamMembership")
@patch(f"{_M}.ServiceAccount")
@patch(f"{_M}.Team")
def test_allows_attaching_org_level_sa(
    MockTeam, MockSA, MockTM, MockTAE, _mock_org, _mock_perm, _mock_team_member
):
    """Org-level SA (team_id=None) is still attachable to any team."""
    from backend.graphene.mutations.teams import AddTeamMembersMutation, MemberType

    target_team = MagicMock(id="team-A", organisation=MagicMock(id="org-1"))
    MockTeam.objects.get.return_value = target_team

    org_sa = MagicMock(team_id=None)
    MockSA.objects.get.return_value = org_sa

    MockTM.objects.filter.return_value.exists.return_value = False
    MockTAE.objects.filter.return_value.values_list.return_value.distinct.return_value = []

    result = AddTeamMembersMutation.mutate(
        None, _info(MagicMock()),
        team_id="team-A",
        member_ids=["org-sa-id"],
        member_type=MemberType.SERVICE,
    )
    MockTM.objects.create.assert_called_once_with(team=target_team, service_account=org_sa)
    assert result.team is target_team


@patch(f"{_M}._check_team_membership")
@patch(f"{_M}.user_has_permission", return_value=True)
@patch(f"{_M}.user_is_org_member", return_value=True)
@patch(f"{_M}.TeamAppEnvironment")
@patch(f"{_M}.TeamMembership")
@patch(f"{_M}.ServiceAccount")
@patch(f"{_M}.Team")
def test_allows_owning_team_sa_idempotent(
    MockTeam, MockSA, MockTM, MockTAE, _mock_org, _mock_perm, _mock_team_member
):
    """SA owned by the target team itself is fine — guard only blocks
    cross-team attachment, not the SA's home team."""
    from backend.graphene.mutations.teams import AddTeamMembersMutation, MemberType

    target_team = MagicMock(id="team-A", organisation=MagicMock(id="org-1"))
    MockTeam.objects.get.return_value = target_team

    home_sa = MagicMock(team_id="team-A")  # same as target
    MockSA.objects.get.return_value = home_sa

    MockTM.objects.filter.return_value.exists.return_value = False
    MockTAE.objects.filter.return_value.values_list.return_value.distinct.return_value = []

    AddTeamMembersMutation.mutate(
        None, _info(MagicMock()),
        team_id="team-A",
        member_ids=["home-sa-id"],
        member_type=MemberType.SERVICE,
    )
    MockTM.objects.create.assert_called_once_with(team=target_team, service_account=home_sa)
