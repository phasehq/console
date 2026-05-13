"""Unit tests for the SCIM filter parser — no database required."""

from unittest.mock import MagicMock

import pytest

from ee.authentication.scim.filters import (
    InvalidSCIMFilter,
    SCIM_GROUP_ATTR_MAP,
    SCIM_USER_ATTR_MAP,
    parse_patch_path_filter,
    parse_scim_filter,
    scim_filter_to_queryset,
)


class TestParseScimFilter:
    """Tests for the SCIM filter expression parser."""

    def test_simple_eq(self):
        result = parse_scim_filter('userName eq "alice@example.com"')
        assert result == [("username", "eq", "alice@example.com")]

    def test_eq_case_insensitive_operator(self):
        result = parse_scim_filter('userName EQ "alice@example.com"')
        assert result == [("username", "eq", "alice@example.com")]

    def test_and_conjunction(self):
        result = parse_scim_filter(
            'userName eq "alice@example.com" and externalId eq "ext-123"'
        )
        assert result == [
            ("username", "eq", "alice@example.com"),
            ("externalid", "eq", "ext-123"),
        ]

    def test_and_case_insensitive(self):
        result = parse_scim_filter(
            'userName eq "alice@example.com" AND externalId eq "ext-123"'
        )
        assert len(result) == 2

    def test_empty_string(self):
        assert parse_scim_filter("") == []

    def test_none_value(self):
        assert parse_scim_filter(None) == []

    def test_external_id_filter(self):
        result = parse_scim_filter('externalId eq "abc-123-def"')
        assert result == [("externalid", "eq", "abc-123-def")]

    def test_display_name_filter(self):
        result = parse_scim_filter('displayName eq "Engineering"')
        assert result == [("displayname", "eq", "Engineering")]

    def test_unsupported_operator_still_parsed(self):
        """Parser extracts clauses regardless of operator; queryset builder ignores non-eq."""
        result = parse_scim_filter('userName co "alice"')
        assert result == [("username", "co", "alice")]

    def test_malformed_filter_no_quotes(self):
        result = parse_scim_filter("userName eq alice")
        assert result == []

    def test_malformed_filter_missing_value(self):
        result = parse_scim_filter('userName eq ""')
        assert result == [("username", "eq", "")]

    def test_email_with_special_chars(self):
        result = parse_scim_filter('userName eq "user+tag@sub.example.com"')
        assert result == [("username", "eq", "user+tag@sub.example.com")]

    def test_attribute_lowercased(self):
        result = parse_scim_filter('UserName eq "test"')
        assert result[0][0] == "username"

    def test_schema_uri_prefix_stripped_user(self):
        """RFC 7643 §3.1: spec-compliant IdPs may send fully-qualified attribute
        paths. Strip the User core schema URI so the attribute resolves."""
        result = parse_scim_filter(
            'urn:ietf:params:scim:schemas:core:2.0:User:userName eq "alice@example.com"'
        )
        assert result == [("username", "eq", "alice@example.com")]

    def test_schema_uri_prefix_stripped_group(self):
        result = parse_scim_filter(
            'urn:ietf:params:scim:schemas:core:2.0:Group:displayName eq "Engineering"'
        )
        assert result == [("displayname", "eq", "Engineering")]

    def test_all_supported_operators_parse(self):
        for op in ("eq", "ne", "co", "sw", "ew"):
            result = parse_scim_filter(f'userName {op} "alice"')
            assert result == [("username", op, "alice")], f"failed for op={op}"


class TestScimFilterToQueryset:
    """Tests for scim_filter_to_queryset — verifies operator dispatch,
    case-exact handling, and invalidFilter signalling."""

    def _qs(self):
        qs = MagicMock()
        qs.filter.return_value = qs
        qs.exclude.return_value = qs
        return qs

    def test_empty_filter_is_noop(self):
        qs = self._qs()
        out = scim_filter_to_queryset(qs, "", SCIM_USER_ATTR_MAP)
        assert out is qs
        qs.filter.assert_not_called()
        qs.exclude.assert_not_called()

    def test_eq_case_insensitive_attribute(self):
        qs = self._qs()
        scim_filter_to_queryset(qs, 'userName eq "Alice@Example.com"', SCIM_USER_ATTR_MAP)
        qs.filter.assert_called_once_with(email__iexact="Alice@Example.com")

    def test_eq_case_exact_attribute(self):
        """externalId has caseExact=true; use the case-sensitive lookup."""
        qs = self._qs()
        scim_filter_to_queryset(qs, 'externalId eq "Ext-123"', SCIM_USER_ATTR_MAP)
        qs.filter.assert_called_once_with(external_id__exact="Ext-123")

    def test_co_operator(self):
        qs = self._qs()
        scim_filter_to_queryset(qs, 'userName co "alice"', SCIM_USER_ATTR_MAP)
        qs.filter.assert_called_once_with(email__icontains="alice")

    def test_sw_operator(self):
        qs = self._qs()
        scim_filter_to_queryset(qs, 'userName sw "alice"', SCIM_USER_ATTR_MAP)
        qs.filter.assert_called_once_with(email__istartswith="alice")

    def test_ew_operator(self):
        qs = self._qs()
        scim_filter_to_queryset(qs, 'userName ew "@example.com"', SCIM_USER_ATTR_MAP)
        qs.filter.assert_called_once_with(email__iendswith="@example.com")

    def test_ne_uses_exclude(self):
        qs = self._qs()
        scim_filter_to_queryset(qs, 'userName ne "alice@example.com"', SCIM_USER_ATTR_MAP)
        qs.exclude.assert_called_once_with(email__iexact="alice@example.com")
        qs.filter.assert_not_called()

    def test_ne_case_exact(self):
        qs = self._qs()
        scim_filter_to_queryset(qs, 'externalId ne "Ext-1"', SCIM_USER_ATTR_MAP)
        qs.exclude.assert_called_once_with(external_id__exact="Ext-1")

    def test_and_conjunction_chains_filters(self):
        qs = self._qs()
        scim_filter_to_queryset(
            qs, 'userName eq "alice@example.com" and externalId eq "ext-1"',
            SCIM_USER_ATTR_MAP,
        )
        assert qs.filter.call_count == 2
        qs.filter.assert_any_call(email__iexact="alice@example.com")
        qs.filter.assert_any_call(external_id__exact="ext-1")

    def test_groups_attr_map(self):
        qs = self._qs()
        scim_filter_to_queryset(qs, 'displayName co "eng"', SCIM_GROUP_ATTR_MAP)
        qs.filter.assert_called_once_with(display_name__icontains="eng")

    def test_unparseable_filter_raises(self):
        with pytest.raises(InvalidSCIMFilter):
            scim_filter_to_queryset(self._qs(), "userName eq alice", SCIM_USER_ATTR_MAP)

    def test_unsupported_operator_raises(self):
        """gt/lt/ge/le/pr aren't useful against our schema and must yield 400."""
        for bad in ('userName gt "x"', 'userName lt "x"', 'userName pr'):
            with pytest.raises(InvalidSCIMFilter):
                scim_filter_to_queryset(self._qs(), bad, SCIM_USER_ATTR_MAP)

    def test_unknown_attribute_raises(self):
        with pytest.raises(InvalidSCIMFilter):
            scim_filter_to_queryset(
                self._qs(), 'phoneNumbers.value eq "555"', SCIM_USER_ATTR_MAP,
            )

    def test_unknown_attribute_for_groups_raises(self):
        with pytest.raises(InvalidSCIMFilter):
            scim_filter_to_queryset(
                self._qs(), 'userName eq "alice"', SCIM_GROUP_ATTR_MAP,
            )


class TestParsePatchPathFilter:
    """Tests for Azure Entra ID-style PATCH member removal path parsing."""

    def test_azure_entra_format(self):
        result = parse_patch_path_filter('members[value eq "abc-123-def"]')
        assert result == "abc-123-def"

    def test_uuid_value(self):
        result = parse_patch_path_filter(
            'members[value eq "550e8400-e29b-41d4-a716-446655440000"]'
        )
        assert result == "550e8400-e29b-41d4-a716-446655440000"

    def test_case_insensitive(self):
        result = parse_patch_path_filter('members[value EQ "abc-123"]')
        assert result == "abc-123"

    def test_non_member_path_returns_none(self):
        assert parse_patch_path_filter("displayName") is None

    def test_plain_members_returns_none(self):
        assert parse_patch_path_filter("members") is None

    def test_empty_string(self):
        assert parse_patch_path_filter("") is None

    def test_malformed_bracket(self):
        assert parse_patch_path_filter('members[value eq "abc"') is None
