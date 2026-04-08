import hashlib
import json

import pytest
from django.test import RequestFactory
from rest_framework.test import APIClient

from api.models import (
    CustomUser,
    Organisation,
    OrganisationMember,
    Role,
    SCIMEvent,
    SCIMGroup,
    SCIMToken,
    SCIMUser,
    Team,
    TeamMembership,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SCIM_CONTENT_TYPE = "application/scim+json"

TOKEN_RAW = "ph_scim:v1:testpfx:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
TOKEN_HASH = hashlib.sha256(TOKEN_RAW.encode()).hexdigest()
TOKEN_PREFIX = "testpfx"


def scim_auth_header(token=TOKEN_RAW):
    return f"Bearer {token}"


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
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def organisation(db):
    """Create an Enterprise org with scim_enabled=True."""
    return Organisation.objects.create(
        name="TestOrg-SCIM",
        identity_key="test-org-identity-key",
        plan="EN",
        scim_enabled=True,
    )


@pytest.fixture
def developer_role(organisation):
    """Create the default Developer role needed for SCIM provisioning."""
    return Role.objects.create(
        name="Developer",
        organisation=organisation,
        description="Default role for SCIM users",
        is_default=True,
        permissions={},
    )


@pytest.fixture
def owner_role(organisation):
    """Create the Owner role."""
    return Role.objects.create(
        name="Owner",
        organisation=organisation,
        description="Owner role",
        is_default=True,
        permissions={},
    )


@pytest.fixture
def admin_user(db):
    """A non-SCIM admin user (the org owner)."""
    user = CustomUser.objects.create(
        username="admin@testorg.com",
        email="admin@testorg.com",
    )
    user.set_unusable_password()
    user.save()
    return user


@pytest.fixture
def admin_member(organisation, admin_user, owner_role):
    """OrganisationMember for the admin user."""
    return OrganisationMember.objects.create(
        user=admin_user,
        organisation=organisation,
        role=owner_role,
        identity_key="admin-identity-key",
        wrapped_keyring="admin-wrapped-keyring",
        wrapped_recovery="admin-wrapped-recovery",
    )


@pytest.fixture
def scim_token(organisation, admin_member):
    """Create a valid, active SCIM token."""
    return SCIMToken.objects.create(
        organisation=organisation,
        name="Test IdP",
        token_hash=TOKEN_HASH,
        token_prefix=TOKEN_PREFIX,
        created_by=admin_member,
        is_active=True,
    )


@pytest.fixture
def scim_client(scim_token):
    """DRF APIClient pre-configured with a valid SCIM Bearer token."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=scim_auth_header())
    return client


@pytest.fixture
def scim_user_alice(organisation, developer_role):
    """A pre-provisioned SCIM user (Alice)."""
    user = CustomUser.objects.create(
        username="alice@example.com",
        email="alice@example.com",
    )
    user.set_unusable_password()
    user.save()

    org_member = OrganisationMember.objects.create(
        user=user,
        organisation=organisation,
        role=developer_role,
        identity_key="",
        wrapped_keyring="",
        wrapped_recovery="",
    )

    return SCIMUser.objects.create(
        external_id="alice-ext-id",
        organisation=organisation,
        user=user,
        org_member=org_member,
        email="alice@example.com",
        display_name="Alice Test",
        active=True,
        scim_data=make_scim_user_payload("alice@example.com", "alice-ext-id"),
    )


@pytest.fixture
def scim_user_bob(organisation, developer_role):
    """A second pre-provisioned SCIM user (Bob)."""
    user = CustomUser.objects.create(
        username="bob@example.com",
        email="bob@example.com",
    )
    user.set_unusable_password()
    user.save()

    org_member = OrganisationMember.objects.create(
        user=user,
        organisation=organisation,
        role=developer_role,
        identity_key="",
        wrapped_keyring="",
        wrapped_recovery="",
    )

    return SCIMUser.objects.create(
        external_id="bob-ext-id",
        organisation=organisation,
        user=user,
        org_member=org_member,
        email="bob@example.com",
        display_name="Bob Test",
        active=True,
        scim_data=make_scim_user_payload("bob@example.com", "bob-ext-id"),
    )


@pytest.fixture
def scim_group_engineering(organisation, scim_user_alice, scim_user_bob):
    """A SCIM-managed group (Team) with Alice and Bob as members."""
    team = Team.objects.create(
        name="Engineering",
        organisation=organisation,
        is_scim_managed=True,
    )
    TeamMembership.objects.create(team=team, org_member=scim_user_alice.org_member)
    TeamMembership.objects.create(team=team, org_member=scim_user_bob.org_member)

    return SCIMGroup.objects.create(
        external_id="eng-ext-id",
        organisation=organisation,
        team=team,
        display_name="Engineering",
        scim_data=make_scim_group_payload("Engineering", "eng-ext-id"),
    )


@pytest.fixture
def request_factory():
    return RequestFactory()
