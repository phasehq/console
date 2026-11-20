"""OrganisationType fields that describe the calling member."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.graphene.types import OrganisationType


def test_individual_app_ids_reads_the_callers_direct_app_memberships():
    """The console adds the org role to a member's app permissions only for
    these apps, so the list must come from direct membership, never from
    team access."""
    member = MagicMock()
    member.apps.filter.return_value.values_list.return_value = ["app-1", "app-2"]
    org = SimpleNamespace(_cached_member=member)

    result = OrganisationType.resolve_individual_app_ids(org, MagicMock())

    assert result == ["app-1", "app-2"]
    member.apps.filter.assert_called_once_with(is_deleted=False)
    member.apps.filter.return_value.values_list.assert_called_once_with("id", flat=True)
