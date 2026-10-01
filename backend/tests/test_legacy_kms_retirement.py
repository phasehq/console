"""Retire KMS runtime surfaces without dropping historical storage."""

from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, PropertyMock, patch

import pytest
from django.apps import apps
from django.db import models
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.state import ModelState
from django.test import RequestFactory
from django.urls import Resolver404, resolve
from graphql import get_operation_ast, parse, validate

from api.models import App, Team
from api.services import Providers, ServiceConfig
from api.utils.syncing.cloudflare.pages import sync_cloudflare_secrets
from api.utils.syncing.cloudflare.workers import sync_cloudflare_worker_secrets
from backend.graphene.mutations.app import UpdateAppInfoMutation
from backend.middleware import ServicePrefixMiddleware
from backend.schema import schema


@pytest.mark.parametrize("prefix", ["", "/public", "/service", "/service/public"])
@pytest.mark.parametrize("trailing_slash", ["", "/"])
def test_retired_endpoint_has_no_route(prefix, trailing_slash):
    request = RequestFactory().get(f"{prefix}/kms/phApp:v1:old-key{trailing_slash}")
    ServicePrefixMiddleware(Mock())(request)
    with pytest.raises(Resolver404):
        resolve(request.path_info)


def test_schema_exposes_only_inert_deprecated_kms_compatibility_fields():
    gql = schema.graphql_schema
    assert {"kmsLogs", "appActivityChart"}.isdisjoint(gql.query_type.fields)
    assert "rotateAppKeys" not in gql.mutation_type.fields
    compatibility_fields = {"appToken", "appSeed", "appVersion", "identityKey", "wrappedKeyShare"}
    app_fields = gql.get_type("AppType").fields
    create_args = gql.mutation_type.fields["createApp"].args
    for field in compatibility_fields:
        assert app_fields[field].deprecation_reason
        assert create_args[field].deprecation_reason
        assert not str(create_args[field].type).endswith("!")
    assert {"id", "name", "environments", "sseEnabled"} <= gql.get_type("AppType").fields.keys()
    # Current Cloudflare secret sync is separate from the retired KMS product.
    assert {"cloudflarePagesProjects", "cloudflareWorkers"} <= gql.query_type.fields.keys()
    assert {"createCloudflarePagesSync", "createCloudflareWorkersSync"} <= gql.mutation_type.fields.keys()
    assert "serviceTokens" not in gql.query_type.fields
    assert "createServiceToken" not in gql.mutation_type.fields


def test_retired_graphql_calls_fail_validation_before_accessing_storage():
    with patch("api.models.App.objects.get") as get_app:
        for operation in (
            '{ kmsLogs(appId: "old-app") { count } }',
            '{ appActivityChart(appId: "old-app") { data } }',
            'mutation { rotateAppKeys(id: "old-app", appToken: "old-token", wrappedKeyShare: "old-share") { app { id } } }',
        ):
            result = schema.execute(operation)
            assert result.errors
            assert result.data is None
        get_app.assert_not_called()


def test_cached_ordinary_client_documents_still_validate():
    document = parse((Path(__file__).parent / "fixtures" / "legacy_kms_client.graphql").read_text())
    assert validate(schema.graphql_schema, document) == []
    for operation_name in ("GetApps", "GetAppDetail", "GetOrganisationSyncs", "CreateApplication"):
        assert get_operation_ast(document, operation_name) is not None


def test_compatibility_fields_never_read_stored_values_even_through_nested_apps():
    app = App(id="existing-app", name="App", app_version=17, app_token="retained-token",
              app_seed="retained-seed", identity_key="retained-identity", wrapped_key_share="retained-share")
    team = Team(id="team", name="Team")
    gql = schema.graphql_schema
    with ExitStack() as stack:
        stack.enter_context(patch.object(gql.query_type.fields["apps"], "resolve", return_value=[app]))
        stack.enter_context(patch.object(gql.query_type.fields["teams"], "resolve", return_value=[team]))
        stack.enter_context(patch.object(gql.get_type("TeamType").fields["apps"], "resolve", return_value=[app]))
        for field in ("identity_key", "app_token", "app_seed", "wrapped_key_share", "app_version"):
            stack.enter_context(patch.object(App, field, new_callable=PropertyMock,
                                            side_effect=AssertionError("Legacy storage must not be read")))
        result = schema.execute('''{
          apps { id name identityKey appToken appSeed wrappedKeyShare appVersion }
          teams(organisationId: "org") {
            apps { id name identityKey appToken appSeed wrappedKeyShare appVersion }
          }
        }''')
    assert result.errors is None
    expected = {"id": "existing-app", "name": "App", "identityKey": "", "appToken": "",
                "appSeed": "", "wrappedKeyShare": "", "appVersion": 1}
    assert result.data == {"apps": [expected], "teams": [{"apps": [expected]}]}
    assert (app.app_token, app.app_seed, app.identity_key, app.wrapped_key_share, app.app_version) == (
        "retained-token", "retained-seed", "retained-identity", "retained-share", 17
    )


@pytest.mark.parametrize("legacy_inputs", [{}, {
    "identity_key": "ignored-identity", "app_token": "ignored-token",
    "app_seed": "ignored-seed", "wrapped_key_share": "ignored-share", "app_version": 17,
}])
def test_graphql_app_creation_does_not_store_kms_material(legacy_inputs):
    org = Mock()
    org.users.filter.return_value = []
    member = Mock()
    app = App(id="new-app", name="New app")
    info = SimpleNamespace(context=SimpleNamespace(user=SimpleNamespace(userId="user")))
    module = "backend.graphene.mutations.app"
    with patch(f"{module}.Organisation.objects.get", return_value=org), patch(
        f"{module}.user_is_org_member", return_value=True
    ), patch(f"{module}.user_has_permission", return_value=True), patch(
        f"{module}.App.objects.create", return_value=app
    ) as create, patch(f"{module}.OrganisationMember.objects.get", return_value=member), patch(
        f"{module}.Role.objects.filter", return_value=[]
    ), patch(f"{module}.get_actor_info_from_graphql", return_value=("user", "user", {})), patch(
        f"{module}.get_resolver_request_meta", return_value=(None, None)
    ), patch(f"{module}.log_audit_event"):
        if legacy_inputs:
            document = (Path(__file__).parent / "fixtures" / "legacy_kms_client.graphql").read_text()
            result = schema.execute(document, operation_name="CreateApplication", context_value=info.context,
                                    variable_values={
                                        "id": "new-app", "organisationId": "org", "name": "New app",
                                        "identityKey": legacy_inputs["identity_key"],
                                        "appToken": legacy_inputs["app_token"],
                                        "appSeed": legacy_inputs["app_seed"],
                                        "wrappedKeyShare": legacy_inputs["wrapped_key_share"],
                                        "appVersion": legacy_inputs["app_version"],
                                    })
        else:
            result = schema.execute('''mutation {
                createApp(id: "new-app", organisationId: "org", name: "New app") { app { id name } }
            }''', context_value=info.context)
    create.assert_called_once_with(id="new-app", organisation=org, name="New app")
    member.apps.add.assert_called_once_with(app)
    assert result.errors is None
    expected = {"id": "new-app", "name": "New app"}
    if legacy_inputs:
        expected["identityKey"] = ""
    assert result.data == {"createApp": {"app": expected}}
    assert app.app_version == 1
    assert all(getattr(app, field) == "" for field in (
        "identity_key", "app_token", "app_seed", "wrapped_key_share"
    ))


@pytest.mark.parametrize("host", ["self", "cloud"])
def test_app_save_does_not_publish_or_change_retained_credentials(settings, host):
    settings.APP_HOST = host
    app = App(
        id="existing-app", app_token="old-token", app_seed="old-seed",
        wrapped_key_share="old-share", identity_key="old-identity", app_version=1,
    )
    assert App.save is models.Model.save
    with patch.object(models.Model, "save") as save:
        app.name = "Renamed"
        app.save()
    save.assert_called_once()
    assert (app.app_token, app.app_seed, app.wrapped_key_share, app.identity_key, app.app_version) == (
        "old-token", "old-seed", "old-share", "old-identity", 1
    )


def test_app_metadata_update_preserves_old_credentials():
    app = Mock(name="old-app")
    app.name = "Old name"
    app.description = "Old description"
    app.app_token, app.app_seed, app.wrapped_key_share = "token", "seed", "share"
    info = SimpleNamespace(context=SimpleNamespace(user=SimpleNamespace(userId="user")))
    module = "backend.graphene.mutations.app"
    with patch(f"{module}.App.objects.get", return_value=app), patch(
        f"{module}.user_can_access_app", return_value=True
    ), patch(f"{module}.user_has_permission", return_value=True), patch(
        f"{module}.get_actor_info_from_graphql", return_value=("user", "user", {})
    ), patch(f"{module}.get_resolver_request_meta", return_value=(None, None)), patch(
        f"{module}.log_audit_event"
    ):
        result = UpdateAppInfoMutation.mutate(None, info, "existing-app", name="Renamed")
    assert result.app.name == "Renamed"
    assert (app.app_token, app.app_seed, app.wrapped_key_share) == ("token", "seed", "share")


@pytest.mark.parametrize("label,name", [("api", "App"), ("logs", "KMSDBLog")])
def test_retained_persistence_matches_existing_migration_state(label, name):
    historical = MigrationLoader(None).project_state().models[(label, name.lower())]
    current = ModelState.from_model(apps.get_model(label, name))
    assert historical.options == current.options
    assert historical.fields.keys() == current.fields.keys()
    for field_name in historical.fields:
        # Rendering a migration state can bind Field.name; the dictionary key
        # above already checks names. Compare the actual field definition.
        assert historical.fields[field_name].deconstruct()[1:] == current.fields[field_name].deconstruct()[1:]


def test_supported_cloudflare_pages_sync_still_uses_saved_provider_credentials():
    assert Providers.CLOUDFLARE["id"] == "cloudflare"
    assert ServiceConfig.CLOUDFLARE_PAGES["provider"] == Providers.CLOUDFLARE
    module = "api.utils.syncing.cloudflare.pages"
    with patch(f"{module}.requests.get", return_value=Mock(status_code=200, json=lambda: {"result": {}})), patch(
        f"{module}.requests.patch", return_value=Mock(status_code=200)
    ) as update:
        ok, _ = sync_cloudflare_secrets([("SECRET", "value", "")], "account", "token", "project", "production")
    assert ok
    assert update.call_args.args[0] == "https://api.cloudflare.com/client/v4/accounts/account/pages/projects/project"
    assert update.call_args.kwargs["headers"]["Authorization"] == "Bearer token"
    assert update.call_args.kwargs["json"]["deployment_configs"]["production"]["env_vars"]["SECRET"]["value"] == "value"


def test_supported_cloudflare_workers_sync_still_uses_saved_provider_credentials():
    assert ServiceConfig.CLOUDFLARE_WORKERS["provider"] == Providers.CLOUDFLARE
    module = "api.utils.syncing.cloudflare.workers"
    with patch(f"{module}.requests.get", return_value=Mock(status_code=200, json=lambda: {"result": []})), patch(
        f"{module}.requests.put", return_value=Mock(status_code=200)
    ) as update:
        ok, _ = sync_cloudflare_worker_secrets([("SECRET", "value", "")], "account", "token", "worker")
    assert ok
    assert update.call_args.args[0] == "https://api.cloudflare.com/client/v4/accounts/account/workers/scripts/worker/secrets"
    assert update.call_args.kwargs["headers"]["Authorization"] == "Bearer token"
    assert update.call_args.kwargs["json"] == {"name": "SECRET", "text": "value", "type": "secret_text"}
