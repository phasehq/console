"""Provider presets: the shipped set, its listings, and expansion in a request."""

from copy import deepcopy
import json

import pytest
from graphql import GraphQLError

from api.models import AgentConnection, AgentRequest
from api.utils.agent_config import get_config_registry, validate_definition
from api.utils.agent_config.access_policy import allow_is_blocked, classify_http_call
from api.utils.agent_config.http_definition import compile_service, secret_field_names
from api.utils.agent_config.presets import (
    DEFAULT_PRESET_ROOT,
    PRESETS,
    PresetError,
    expand_preset,
    list_presets,
    load_presets,
    preset_summaries,
)
from api.utils.request_actions import contains_credential_text

from .custom_connections import (
    add_member,
    agent_client,
    approve,
    ask,
    filed,
    graphql,
    member_client,
    new_keys,
    open_session,
    refused,
    seal,
    use_test_server_keypair,
    workspace,
)


SHIPPED = {
    "anthropic",
    "datadog",
    "linear",
    "mcp-server",
    "openai",
    "sentry",
    "slack",
    "stripe",
}
# Providers Phase has a packaged service for, which uses the provider's stored
# integration credential. None of them is also a preset.
PACKAGED = {"github", "gitlab", "cloudflare", "vercel", "render", "railway", "supabase"}
HOSTS = [{"match": "exact", "value": "mcp.internal.example", "port": 443}]


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    space = workspace("presets")
    space.client, space.full_token = agent_client(space)
    space.session = open_session(space.client, space.workflow)
    return space


def _action(preset, name=None, **members):
    return {
        "type": "agent_connection.create",
        "version": 1,
        "serviceType": "http",
        "name": name or f"{preset} connection",
        "preset": preset,
        **members,
    }


# The shipped set


def test_the_shipped_set():
    assert set(PRESETS) == SHIPPED
    assert {path.stem for path in DEFAULT_PRESET_ROOT.glob("*.json")} == SHIPPED


def test_a_provider_with_a_packaged_service_has_no_preset():
    assert not PACKAGED & set(PRESETS)
    assert PACKAGED <= set(get_config_registry().services)
    with pytest.raises(PresetError, match="Unknown preset"):
        expand_preset("github")


@pytest.mark.parametrize("preset_id", sorted(SHIPPED))
def test_every_shipped_preset_loads_into_a_valid_definition(preset_id):
    preset = PRESETS[preset_id]
    needs_hosts = not preset["definition"]["hosts"]

    definition = expand_preset(preset_id, HOSTS if needs_hosts else None)

    # The expansion is a definition the custom HTTP validator stores as it is.
    assert validate_definition(definition) == definition
    assert compile_service(definition)["injections"]
    assert set(preset["labels"]) == set(secret_field_names(definition))
    assert needs_hosts <= preset["hostsEditable"]
    assert preset["docsUrl"].startswith("https://")
    # A preset never holds a secret, nor anything shaped like one.
    assert not contains_credential_text(preset)
    assert all("value" not in field for field in definition["fields"])
    on_disk = json.loads((DEFAULT_PRESET_ROOT / f"{preset_id}.json").read_text())
    assert on_disk["id"] == preset_id
    assert on_disk["schemaVersion"] == 1


def test_the_presets_say_where_each_provider_takes_its_secret():
    def injections(preset_id):
        return [
            (injection["name"], injection.get("prefix", ""))
            for injection in PRESETS[preset_id]["definition"]["injections"]
        ]

    def hosts(preset_id):
        return [rule["value"] for rule in PRESETS[preset_id]["definition"]["hosts"]]

    for preset_id in ("openai", "stripe", "slack", "sentry", "mcp-server"):
        assert injections(preset_id) == [("Authorization", "Bearer ")], preset_id
    assert injections("anthropic") == [("x-api-key", "")]
    assert injections("linear") == [("Authorization", "")]
    assert injections("datadog") == [("DD-API-KEY", ""), ("DD-APPLICATION-KEY", "")]
    assert hosts("openai") == ["api.openai.com"]
    assert hosts("stripe") == ["api.stripe.com"]
    assert hosts("slack") == ["slack.com"]
    assert hosts("anthropic") == ["api.anthropic.com"]
    assert hosts("linear") == ["api.linear.app"]
    assert hosts("sentry") == ["sentry.io", ".sentry.io"]
    assert hosts("mcp-server") == []
    # Self-hostable services let their hosts be changed.
    assert {
        preset_id for preset_id, preset in PRESETS.items() if preset["hostsEditable"]
    } == {"datadog", "sentry", "mcp-server"}


def test_graphql_endpoints_are_classified_as_able_to_change_data():
    classes = PRESETS["linear"]["definition"]["operationClasses"]

    assert classes == [
        {"match": {"methods": ["POST"], "path": "/graphql"}, "class": "update"}
    ]


def _slack_class(method, path):
    classes = PRESETS["slack"]["definition"]["operationClasses"]
    return classify_http_call(classes, method, path)


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/api/chat.delete", "delete"),
        ("/api/files.delete", "delete"),
        ("/api/reactions.remove", "delete"),
        ("/api/conversations.kick", "delete"),
        ("/api/conversations.archive", "delete"),
        ("/api/conversations.list", "read"),
        ("/api/users.info", "read"),
        ("/api/conversations.history", "read"),
        ("/api/conversations.replies", "read"),
        ("/api/users.getPresence", "read"),
        ("/api/auth.test", "read"),
        ("/api/chat.postMessage", "update"),
        ("/api/conversations.unarchive", "update"),
    ],
)
def test_slack_calls_are_classified_by_method_name(path, expected):
    assert _slack_class("POST", path) == expected


def test_the_mcp_server_preset_classifies_its_one_endpoint_as_able_to_change_data():
    classes = PRESETS["mcp-server"]["definition"]["operationClasses"]

    assert classes == [{"match": {"methods": ["POST"]}, "class": "update"}]
    assert classify_http_call(classes, "POST", "/mcp") == "update"
    assert classify_http_call(classes, "GET", "/mcp") == "read"


def test_a_blocked_delete_class_covers_a_slack_delete():
    blocked = {
        "version": 1,
        "default": "allow",
        "rules": [{"class": "delete", "effect": "block"}],
    }
    classes = PRESETS["slack"]["definition"]["operationClasses"]
    allow = {"match": {"methods": ["POST"], "path": "/api/chat.delete"}}

    assert allow_is_blocked(blocked, allow, operation_classes=classes)
    assert not allow_is_blocked(
        blocked,
        {"match": {"methods": ["POST"], "path": "/api/chat.postMessage"}},
        operation_classes=classes,
    )


@pytest.mark.parametrize("category", [[], ["ai"], {}, {"ai": 1}])
def test_a_preset_category_that_is_not_text_is_refused(tmp_path, category):
    _write(tmp_path, category=category)

    with pytest.raises(PresetError, match="category"):
        load_presets(tmp_path)


# The loader


def _write(tmp_path, preset_id="example", **changes):
    document = json.loads((DEFAULT_PRESET_ROOT / "sentry.json").read_text())
    document["id"] = preset_id
    document.update(deepcopy(changes))
    (tmp_path / f"{preset_id}.json").write_text(json.dumps(document))
    return document


def test_a_preset_directory_loads(tmp_path):
    _write(tmp_path)

    assert list(load_presets(tmp_path)) == ["example"]


@pytest.mark.parametrize(
    "changes",
    [
        {"schemaVersion": 2},
        {"id": "other"},
        {"category": "misc"},
        {"docsUrl": "http://docs.example.com"},
        {"hostsEditable": "yes"},
        {"labels": {}},
        {"labels": {"token": "Token", "other": "Other"}},
        {"name": ""},
        {"description": "x" * 281},
        {"extra": True},
    ],
)
def test_a_broken_preset_fails_at_load(tmp_path, changes):
    document = _write(tmp_path, **changes)
    if changes.get("id"):
        (tmp_path / "example.json").write_text(json.dumps(document))

    with pytest.raises(PresetError):
        load_presets(tmp_path)


def test_a_preset_whose_definition_does_not_validate_fails_at_load(tmp_path):
    document = json.loads((DEFAULT_PRESET_ROOT / "sentry.json").read_text())
    for definition in (
        {**document["definition"], "injections": []},
        {**document["definition"], "hosts": []},
        {
            **document["definition"],
            "fields": [{"name": "token", "kind": "secret", "source": {"type": "sealed"}, "value": "x"}],
        },
    ):
        _write(tmp_path, definition=definition, hostsEditable=False)
        with pytest.raises(PresetError):
            load_presets(tmp_path)
    with pytest.raises(PresetError):
        load_presets(tmp_path / "missing")


# Listings


_PRESETS_QUERY = """
query Presets($organisationId: ID!, $presetId: ID) {
  agentConnectionPresets(organisationId: $organisationId, presetId: $presetId) {
    id name description docsUrl category hosts hostsEditable labels definition
  }
}
"""


def test_the_console_lists_the_presets_in_full(space):
    result = graphql(space, _PRESETS_QUERY, organisationId=str(space.organisation.id))

    assert result.errors is None, result.errors
    listed = result.data["agentConnectionPresets"]
    assert {preset["id"] for preset in listed} == SHIPPED
    assert [preset["name"] for preset in listed] == sorted(
        (preset["name"] for preset in listed), key=str.lower
    )
    datadog = next(preset for preset in listed if preset["id"] == "datadog")
    assert datadog["labels"] == {"apikey": "API key", "appkey": "Application key"}
    assert datadog["definition"] == PRESETS["datadog"]["definition"]
    assert datadog["hosts"] == datadog["definition"]["hosts"]
    assert datadog["hostsEditable"] is True
    assert datadog["category"] == "observability"

    one = graphql(
        space, _PRESETS_QUERY, organisationId=str(space.organisation.id), presetId="sentry"
    )
    assert [preset["id"] for preset in one.data["agentConnectionPresets"]] == ["sentry"]


def test_listing_presets_takes_permission_to_read_connections(space):
    outsider = add_member(space.organisation, "no-connections", permissions={"Agents": ["read"]})

    result = graphql(space, _PRESETS_QUERY, outsider, organisationId=str(space.organisation.id))

    assert result.errors is not None


def test_the_registry_endpoint_lists_the_presets_for_a_client(space):
    for client in (space.client, member_client(space)):
        response = client.get("/v1/agents/registry/")

        assert response.status_code == 200, response.content
        body = response.json()
        assert set(body) == {"schemaVersion", "capabilities", "services", "presets"}
        assert {preset["id"] for preset in body["presets"]} == SHIPPED
        for preset in body["presets"]:
            assert set(preset) == {"id", "name", "description", "hosts", "category"}
        stripe = next(preset for preset in body["presets"] if preset["id"] == "stripe")
        assert stripe["hosts"] == [
            {"match": "exact", "value": "api.stripe.com", "port": 443, "path": "/v1/*"}
        ]
    assert preset_summaries() == [
        {
            "id": preset["id"],
            "name": preset["name"],
            "description": preset["description"],
            "hosts": preset["definition"]["hosts"],
            "category": preset["category"],
        }
        for preset in list_presets()
    ]


# Expansion in a request


def test_a_preset_is_expanded_into_a_definition_when_the_request_is_filed(space):
    response = ask(space.client, kind="setup", action=_action("sentry", "Sentry"))

    assert response.status_code == 201, response.content
    body = response.json()
    expanded = expand_preset("sentry")
    # The reviewer is shown an ordinary definition; no preset is stored.
    assert body["action"] == {
        "type": "agent_connection.create",
        "version": 1,
        "serviceType": "http",
        "name": "Sentry",
        "definition": expanded,
    }
    assert body["title"] == "Add Connection: Sentry"
    stored = AgentRequest.objects.get(id=body["id"])
    assert "preset" not in stored.action
    review = graphql(
        space,
        "query($o: ID!, $r: ID!) { agentRequests(organisationId: $o, requestId: $r) { actionReview } }",
        o=str(space.organisation.id),
        r=str(stored.id),
    ).data["agentRequests"][0]["actionReview"]
    assert review["requested"]["definition"] == expanded
    assert review["current"] is None


def test_an_expanded_preset_is_approved_like_any_definition(space):
    agent_request = filed(ask(space.client, action=_action("datadog", "Datadog")))
    definition = agent_request.action["definition"]
    keys = new_keys()

    result = approve(
        space,
        agent_request,
        inputs={
            "encryptionPublicKey": keys.public_key,
            "sealedValue": seal(
                definition, keys.public_key, fields={"apikey": "datadog-api-key", "appkey": "datadog-app-key"}
            ),
            "serverWrappedKey": keys.server_wrapped_key,
        },
    )

    connection = result.request.connection
    assert connection.state == AgentConnection.ACTIVE
    assert connection.config == definition
    assert [field["env"] for field in connection.config["fields"]] == ["DD_API_KEY", "DD_APP_KEY"]


def test_hosts_are_taken_only_for_a_preset_that_lets_them_change(space):
    own_host = [{"match": "exact", "value": "sentry.internal.example", "port": 443, "path": "/api/*"}]

    changed = filed(ask(space.client, action=_action("sentry", hosts=own_host)))
    entered = filed(ask(space.client, action=_action("mcp-server", hosts=HOSTS)))

    assert changed.action["definition"]["hosts"] == own_host
    assert entered.action["definition"]["hosts"] == HOSTS
    refused(
        ask(space.client, action=_action("stripe", hosts=own_host)),
        "invalid_connection_preset",
    )
    # A preset without hosts of its own needs them.
    refused(ask(space.client, action=_action("mcp-server")), "invalid_connection_preset")
    refused(
        ask(space.client, action=_action("sentry", hosts=[{"match": "exact", "value": "Bad Host"}])),
        "invalid_connection_definition",
    )
    refused(ask(space.client, action=_action("sentry", hosts=[])), "invalid_connection_definition")


def test_a_request_carries_a_definition_or_a_preset(space):
    definition = expand_preset("sentry")

    refused(ask(space.client, action=_action("no-such-preset")), "invalid_connection_preset")
    # A provider with a packaged service is asked for with a setup request.
    refused(ask(space.client, action=_action("github")), "invalid_connection_preset")
    refused(ask(space.client, action=_action(["sentry"])), "invalid_connection_preset")
    refused(
        ask(space.client, action=_action("sentry", definition=definition)),
        "invalid_request_action",
    )
    without_either = _action("sentry")
    del without_either["preset"]
    refused(ask(space.client, action=without_either), "invalid_request_action")
    refused(
        ask(space.client, action={**without_either, "definition": definition, "hosts": HOSTS}),
        "invalid_request_action",
    )
    assert not AgentRequest.objects.filter(workflow=space.workflow).exists()


def test_an_approver_cannot_swap_in_a_preset_with_both_spellings(space):
    agent_request = filed(ask(space.client, action=_action("sentry")))

    with pytest.raises(GraphQLError, match="either a definition or a preset"):
        approve(
            space,
            agent_request,
            action={**agent_request.action, "preset": "stripe"},
            inputs={},
        )
