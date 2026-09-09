"""Retirement is a runtime boundary, not a deletion of existing token data."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import graphene
import pytest
from django.apps import apps
from django.db.migrations.autodetector import MigrationAutodetector
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.state import ProjectState
from django.urls import resolve
from rest_framework.test import APIRequestFactory

from api.auth import PhaseTokenAuthentication, ServiceAccountUser
from api.models import Environment, EnvironmentKey, SecretEvent, ServiceAccountToken, ServiceToken, UserToken
from api.utils.rest import get_service_account_token, token_is_expired_or_deleted
from backend.graphene.types import LegacyServiceTokenActorType
from backend.schema import schema


@pytest.mark.parametrize("authorization", [
    "Bearer Service retained-token",
    "bearer Service retained-token",
    "BEARER Service retained-token extra",
    "Bearer service retained-token",
    "Bearer SERVICE retained-token",
    "Bearer  Service retained-token",
    "Bearer\tService\tretained-token",
    "Service retained-token",
    "pss_service:v1:retained-token:public:share:wrap",
    "Bearer pss_service:v1:retained-token:public:share:wrap",
])
@pytest.mark.parametrize("path", [
    "/secrets/tokens/",
    "/secrets/",
    "/v1/secrets/",
    "/public/v1/secrets/",
    "/v1/apps/",
    "/v1/members/",
    "/v1/roles/",
    "/v1/service-accounts/",
])
@pytest.mark.parametrize("method", ["get", "post", "put", "delete"])
def test_retired_credentials_rejected_before_data_access(authorization, path, method):
    request = getattr(APIRequestFactory(), method)(
        path + "?app_id=foreign-app&env=production&secret_id=foreign-secret",
        HTTP_AUTHORIZATION=authorization,
        HTTP_ENVIRONMENT="foreign-environment",
        HTTP_SECRET_ID="foreign-secret",
    )
    with patch.object(ServiceToken, "objects") as legacy, patch(
        "api.auth.token_is_expired_or_deleted"
    ) as expiry, patch("api.auth._resolve_caller_org") as caller:
        match = resolve(path)
        response = match.func(request, **match.kwargs)

    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"
    assert str(response.data["error"]) == "Invalid token"
    assert not legacy.mock_calls
    expiry.assert_not_called()
    caller.assert_not_called()


def test_retired_token_lookup_cannot_load_legacy_or_current_rows():
    with patch.object(ServiceToken, "objects") as legacy, patch.object(
        ServiceAccountToken, "objects"
    ) as current:
        assert get_service_account_token("Bearer Service retained-token") is None
        assert token_is_expired_or_deleted("Bearer Service retained-token") is True
    assert not legacy.mock_calls
    assert not current.mock_calls


@pytest.mark.parametrize("principal", ["User", "ServiceAccount"])
@pytest.mark.parametrize("creator_present", [True, False])
def test_supported_tokens_still_authenticate_with_real_parser(principal, creator_present):
    user = Mock(userId="user-1", is_authenticated=True)
    org = Mock(id="org-1")
    member = Mock(id="member-1", user=user, organisation=org, deleted_at=None)
    account = Mock(id="sa-1", name="automation", organisation=org, deleted_at=None)
    token = Mock(
        id="token-1", user=member, service_account=account,
        created_by=member if creator_present else None,
        deleted_at=None, expires_at=None,
    )
    env = Mock(id="env-1", app=Mock(id="app-1", organisation=org))
    request = APIRequestFactory().get(
        "/v1/secrets/", HTTP_AUTHORIZATION=f"Bearer {principal} current-token",
        HTTP_ENVIRONMENT=env.id,
    )
    with patch.object(UserToken.objects, "get", return_value=token), patch.object(
        ServiceAccountToken.objects, "get", return_value=token
    ), patch.object(ServiceAccountToken.objects, "filter") as token_rows, patch.object(
        Environment.objects, "select_related"
    ) as environments, patch(
        "api.auth.user_can_access_environment", return_value=True
    ), patch("api.auth.service_account_can_access_environment", return_value=True):
        environments.return_value.filter.return_value.get.return_value = env
        authenticated_user, auth = PhaseTokenAuthentication().authenticate(request)

    assert auth["environment"] is env
    assert auth["auth_type"] == principal
    assert "service_token" not in auth
    if principal == "User":
        assert authenticated_user is user
        assert auth["user_token"] is token
        token_rows.assert_not_called()
    else:
        assert auth["service_account_token"] is token
        assert auth["service_account"] is account
        token_rows.return_value.update.assert_called_once()
        if not creator_present:
            assert isinstance(authenticated_user, ServiceAccountUser)


def test_legacy_api_absent_and_historical_actor_has_only_metadata():
    query_fields = schema.graphql_schema.query_type.fields
    mutation_fields = schema.graphql_schema.mutation_type.fields
    assert "serviceTokens" not in query_fields
    assert "createServiceToken" not in mutation_fields
    assert "deleteServiceToken" not in mutation_fields
    assert "ServiceTokenType" not in schema.graphql_schema.type_map
    actor_fields = schema.graphql_schema.type_map["LegacyServiceTokenActorType"].fields
    assert set(actor_fields) == {"id", "name"}
    assert "userTokens" in query_fields
    assert "createUserToken" in mutation_fields
    assert "createServiceAccountToken" in mutation_fields


def test_historical_actor_metadata_still_resolves():
    class HistoricalQuery(graphene.ObjectType):
        actor = graphene.Field(LegacyServiceTokenActorType)

    token = ServiceToken(id="retained-id", name="old workload", token="not-readable")
    historical_schema = graphene.Schema(query=HistoricalQuery)
    result = historical_schema.execute(
        "{ actor { id name } }", root_value=SimpleNamespace(actor=token)
    )
    assert not result.errors
    assert result.data == {"actor": {"id": "retained-id", "name": "old workload"}}
    rejected = historical_schema.execute(
        "{ actor { token wrappedKeyShare keys { id } } }"
    )
    assert rejected.errors and rejected.data is None


def test_retirement_requires_no_schema_or_data_migration():
    # Load historical model state without connecting to a database. Retiring
    # runtime features must not schedule DropModel/RemoveField/RunPython work.
    loader = MigrationLoader(None)
    changes = MigrationAutodetector(
        loader.project_state(), ProjectState.from_apps(apps)
    ).changes(graph=loader.graph)
    assert changes == {}
    assert ServiceToken._meta.db_table == "api_servicetoken"
    assert ServiceToken._meta.get_field("keys").remote_field.model is EnvironmentKey
    assert SecretEvent._meta.get_field("service_token").remote_field.model is ServiceToken
