import hashlib
import uuid
from datetime import datetime, timezone as dt_tz
from unittest.mock import MagicMock, Mock, patch

import pytest
from rest_framework.test import APIClient


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCIM_CONTENT_TYPE = "application/scim+json"

TOKEN_RAW = "ph_scim:v1:testpfx:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
TOKEN_HASH = hashlib.sha256(TOKEN_RAW.encode()).hexdigest()
TOKEN_PREFIX = "testpfx"


def scim_auth_header(token=TOKEN_RAW):
    return f"Bearer {token}"


# ---------------------------------------------------------------------------
# Payload helpers (pure data — no DB)
# ---------------------------------------------------------------------------


def make_scim_user_payload(
    username,
    external_id,
    display_name=None,
    given_name=None,
    family_name=None,
    active=True,
):
    """Build a SCIM User resource payload matching what IdPs send."""
    given = given_name or username.split("@")[0].title()
    family = family_name or "Test"
    display = display_name or f"{given} {family}"

    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "externalId": external_id,
        "userName": username,
        "displayName": display,
        "name": {
            "givenName": given,
            "familyName": family,
            "formatted": display,
        },
        "emails": [{"value": username, "type": "work", "primary": True}],
        "active": active,
    }


def make_scim_group_payload(display_name, external_id, members=None, description=None):
    """Build a SCIM Group resource payload."""
    payload = {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "externalId": external_id,
        "displayName": display_name,
        "members": members or [],
    }
    if description:
        payload["description"] = description
    return payload


def make_patch_op(operations):
    """Build a SCIM PatchOp payload."""
    return {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        "Operations": operations,
    }


# ---------------------------------------------------------------------------
# Mock factories
# ---------------------------------------------------------------------------


def make_mock_organisation(**overrides):
    """Create a mock Organisation with sensible defaults."""
    org = MagicMock()
    org.id = overrides.get("id", str(uuid.uuid4()))
    org.name = overrides.get("name", "TestOrg-SCIM")
    org.plan = overrides.get("plan", "EN")
    org.scim_enabled = overrides.get("scim_enabled", True)
    org.identity_key = overrides.get("identity_key", "test-org-identity-key")
    return org


def make_mock_scim_token(organisation=None, **overrides):
    """Create a mock SCIMToken."""
    token = MagicMock()
    token.id = overrides.get("id", str(uuid.uuid4()))
    token.organisation = organisation or make_mock_organisation()
    token.name = overrides.get("name", "Test IdP")
    token.token_hash = overrides.get("token_hash", TOKEN_HASH)
    token.token_prefix = overrides.get("token_prefix", TOKEN_PREFIX)
    token.is_active = overrides.get("is_active", True)
    token.expires_at = overrides.get("expires_at", None)
    token.deleted_at = overrides.get("deleted_at", None)
    token.last_used_at = overrides.get("last_used_at", None)
    token.created_by = overrides.get("created_by", MagicMock())
    return token


def make_mock_user(**overrides):
    """Create a mock CustomUser."""
    user = MagicMock()
    user.userId = overrides.get("userId", str(uuid.uuid4()))
    user.username = overrides.get("username", "user@example.com")
    user.email = overrides.get("email", user.username)
    user.has_usable_password = MagicMock(return_value=False)
    return user


def make_mock_org_member(user=None, organisation=None, **overrides):
    """Create a mock OrganisationMember."""
    member = MagicMock()
    member.id = overrides.get("id", str(uuid.uuid4()))
    member.user = user or make_mock_user()
    member.organisation = organisation or make_mock_organisation()
    member.role = overrides.get("role", MagicMock(name="Developer"))
    member.identity_key = overrides.get("identity_key", "")
    member.wrapped_keyring = overrides.get("wrapped_keyring", "")
    member.wrapped_recovery = overrides.get("wrapped_recovery", "")
    member.deleted_at = overrides.get("deleted_at", None)
    return member


def make_mock_scim_user(organisation=None, user=None, org_member=None, **overrides):
    """Create a mock SCIMUser."""
    org = organisation or make_mock_organisation()
    scim_user = MagicMock()
    scim_user.id = overrides.get("id", str(uuid.uuid4()))
    scim_user.external_id = overrides.get("external_id", "ext-" + str(uuid.uuid4())[:8])
    scim_user.organisation = org
    scim_user.user = user or make_mock_user(email=overrides.get("email", "user@example.com"))
    scim_user.org_member = org_member or make_mock_org_member(user=scim_user.user, organisation=org)
    scim_user.email = overrides.get("email", scim_user.user.email)
    scim_user.display_name = overrides.get("display_name", "Test User")
    scim_user.active = overrides.get("active", True)
    scim_user.scim_data = overrides.get(
        "scim_data",
        make_scim_user_payload(scim_user.email, scim_user.external_id),
    )
    scim_user.created_at = overrides.get("created_at", datetime(2025, 1, 1, tzinfo=dt_tz.utc))
    scim_user.updated_at = overrides.get("updated_at", datetime(2025, 1, 1, tzinfo=dt_tz.utc))
    return scim_user


def make_mock_team(organisation=None, **overrides):
    """Create a mock Team."""
    team = MagicMock()
    team.id = overrides.get("id", str(uuid.uuid4()))
    team.name = overrides.get("name", "TestTeam")
    team.organisation = organisation or make_mock_organisation()
    team.is_scim_managed = overrides.get("is_scim_managed", True)
    team.description = overrides.get("description", None)
    team.deleted_at = overrides.get("deleted_at", None)
    return team


def make_mock_scim_group(organisation=None, team=None, **overrides):
    """Create a mock SCIMGroup."""
    org = organisation or make_mock_organisation()
    scim_group = MagicMock()
    scim_group.id = overrides.get("id", str(uuid.uuid4()))
    scim_group.external_id = overrides.get("external_id", "grp-" + str(uuid.uuid4())[:8])
    scim_group.organisation = org
    scim_group.team = team or make_mock_team(organisation=org, name=overrides.get("display_name", "TestGroup"))
    scim_group.display_name = overrides.get("display_name", "TestGroup")
    scim_group.scim_data = overrides.get(
        "scim_data",
        make_scim_group_payload(scim_group.display_name, scim_group.external_id),
    )
    scim_group.created_at = overrides.get("created_at", datetime(2025, 1, 1, tzinfo=dt_tz.utc))
    scim_group.updated_at = overrides.get("updated_at", datetime(2025, 1, 1, tzinfo=dt_tz.utc))
    return scim_group


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_organisation():
    return make_mock_organisation()


@pytest.fixture
def mock_scim_token(mock_organisation):
    return make_mock_scim_token(organisation=mock_organisation)


@pytest.fixture
def mock_auth(mock_organisation, mock_scim_token):
    """Patch SCIMTokenAuthentication.authenticate so that all views see a
    valid SCIM service user without touching the DB."""
    from ee.authentication.scim.auth import SCIMServiceUser

    service_user = SCIMServiceUser(mock_scim_token)
    auth_info = {
        "scim_token": mock_scim_token,
        "organisation": mock_organisation,
    }

    with patch(
        "ee.authentication.scim.auth.SCIMTokenAuthentication.authenticate",
        return_value=(service_user, auth_info),
    ) as m:
        yield m


@pytest.fixture
def scim_client(mock_auth):
    """DRF APIClient that passes SCIM Bearer auth (mocked)."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=scim_auth_header())
    return client
