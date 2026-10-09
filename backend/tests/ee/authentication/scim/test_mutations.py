"""Tests for SCIM GraphQL mutations — fully mocked, no database."""

from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError

from ee.authentication.scim.graphene.mutations import (
    ToggleSCIMMutation,
    ToggleSCIMTokenMutation,
)

from .conftest import make_mock_organisation, make_mock_scim_token

# Patch targets — where names are looked up in mutations.py
_P = "ee.authentication.scim.graphene.mutations"


def _make_info():
    info = MagicMock()
    info.context.user = MagicMock()
    return info


# ---------------------------------------------------------------------------
# ToggleSCIMMutation
# ---------------------------------------------------------------------------


class TestToggleSCIMMutation:

    @pytest.mark.parametrize("plan", ["FR", "PR"])
    @patch(f"{_P}.user_has_permission", return_value=True)
    @patch(f"{_P}.Organisation")
    def test_disable_allowed_without_enterprise_plan(
        self, MockOrganisation, mock_perm, plan
    ):
        """An org that dropped from Enterprise can still turn SCIM off."""
        org = make_mock_organisation(plan=plan, scim_enabled=True)
        MockOrganisation.objects.get.return_value = org

        result = ToggleSCIMMutation.mutate(
            None, _make_info(), organisation_id=org.id, enabled=False
        )

        assert result.ok is True
        assert org.scim_enabled is False
        org.save.assert_called_once_with(update_fields=["scim_enabled"])

    @pytest.mark.parametrize("plan", ["FR", "PR"])
    @patch(f"{_P}.user_has_permission", return_value=True)
    @patch(f"{_P}.Organisation")
    def test_enable_rejected_without_enterprise_plan(
        self, MockOrganisation, mock_perm, plan
    ):
        org = make_mock_organisation(plan=plan, scim_enabled=False)
        MockOrganisation.objects.get.return_value = org

        with pytest.raises(GraphQLError, match="Enterprise plan"):
            ToggleSCIMMutation.mutate(
                None, _make_info(), organisation_id=org.id, enabled=True
            )

        assert org.scim_enabled is False
        org.save.assert_not_called()

    @patch(f"{_P}.user_has_permission", return_value=True)
    @patch(f"{_P}.Organisation")
    def test_enterprise_can_enable(self, MockOrganisation, mock_perm):
        org = make_mock_organisation(plan="EN", scim_enabled=False)
        MockOrganisation.objects.get.return_value = org

        result = ToggleSCIMMutation.mutate(
            None, _make_info(), organisation_id=org.id, enabled=True
        )

        assert result.ok is True
        assert org.scim_enabled is True
        org.save.assert_called_once_with(update_fields=["scim_enabled"])

    @pytest.mark.parametrize("enabled", [True, False])
    @patch(f"{_P}.user_has_permission", return_value=False)
    @patch(f"{_P}.Organisation")
    def test_requires_permission(self, MockOrganisation, mock_perm, enabled):
        org = make_mock_organisation(plan="EN", scim_enabled=not enabled)
        MockOrganisation.objects.get.return_value = org

        with pytest.raises(GraphQLError, match="permission"):
            ToggleSCIMMutation.mutate(
                None, _make_info(), organisation_id=org.id, enabled=enabled
            )

        org.save.assert_not_called()


# ---------------------------------------------------------------------------
# ToggleSCIMTokenMutation
# ---------------------------------------------------------------------------


class TestToggleSCIMTokenMutation:

    @pytest.mark.parametrize("plan", ["FR", "PR"])
    @patch(f"{_P}.user_has_permission", return_value=True)
    @patch(f"{_P}.SCIMToken")
    def test_disable_allowed_without_enterprise_plan(
        self, MockSCIMToken, mock_perm, plan
    ):
        """An org that dropped from Enterprise can still turn a token off."""
        token = make_mock_scim_token(
            organisation=make_mock_organisation(plan=plan), is_active=True
        )
        MockSCIMToken.objects.get.return_value = token

        result = ToggleSCIMTokenMutation.mutate(
            None, _make_info(), token_id=token.id, is_active=False
        )

        assert result.ok is True
        assert token.is_active is False
        token.save.assert_called_once_with(update_fields=["is_active"])

    @pytest.mark.parametrize("plan", ["FR", "PR"])
    @patch(f"{_P}.user_has_permission", return_value=True)
    @patch(f"{_P}.SCIMToken")
    def test_enable_rejected_without_enterprise_plan(
        self, MockSCIMToken, mock_perm, plan
    ):
        token = make_mock_scim_token(
            organisation=make_mock_organisation(plan=plan), is_active=False
        )
        MockSCIMToken.objects.get.return_value = token

        with pytest.raises(GraphQLError, match="Enterprise plan"):
            ToggleSCIMTokenMutation.mutate(
                None, _make_info(), token_id=token.id, is_active=True
            )

        assert token.is_active is False
        token.save.assert_not_called()

    @patch(f"{_P}.user_has_permission", return_value=True)
    @patch(f"{_P}.SCIMToken")
    def test_enterprise_can_enable(self, MockSCIMToken, mock_perm):
        token = make_mock_scim_token(
            organisation=make_mock_organisation(plan="EN"), is_active=False
        )
        MockSCIMToken.objects.get.return_value = token

        result = ToggleSCIMTokenMutation.mutate(
            None, _make_info(), token_id=token.id, is_active=True
        )

        assert result.ok is True
        assert token.is_active is True
        token.save.assert_called_once_with(update_fields=["is_active"])
