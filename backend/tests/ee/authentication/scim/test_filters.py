"""Unit tests for the SCIM filter parser — no database required."""

import pytest

from ee.authentication.scim.filters import (
    parse_patch_path_filter,
    parse_scim_filter,
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
