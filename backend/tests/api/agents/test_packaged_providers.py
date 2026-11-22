"""The packaged token providers: GitHub, GitLab, Cloudflare, Vercel, Render,
Railway and Supabase, each using the provider's stored integration credential.
"""

import re

import pytest
from graphql import GraphQLError

from api.models import (
    AgentConnection,
    AgentEvent,
    AgentRequest,
    AgentSession,
    AuditEvent,
)
from api.utils.agent_config import get_config_registry
from api.utils.agent_credentials import (
    CredentialResolutionError,
    credential_sets_endpoint,
    resolve_connection_config,
)
from api.utils.crypto import encrypt_asymmetric
from backend.graphene.agents.mutations import (
    AllowAgentConnectionHostMutation,
    CreateAgentConnectionMutation,
    FulfillAgentRequestMutation,
    UpdateAgentConnectionMutation,
)
from backend.graphene.mutations.syncing import UpdateProviderCredentials

from .custom_connections import (
    ACTIONS,
    CLIENT,
    POLICY_FEATURES,
    SERVER_KEYPAIR,
    agent_client,
    ask,
    filed,
    generation,
    grant,
    graphql,
    live_packaged_connection,
    member_client,
    open_session,
    provider_credential,
    refused,
    session_get,
    set_policy,
    unrestricted_policy,
    use_test_server_keypair,
    workspace,
)


BEARER = ("Authorization", "Bearer {value}")
GRAPHQL_IS_AN_UPDATE = {"methods": ["POST"]}

# What each provider's definition has to say, held against the sync
# integration of the same provider: its API host, the header its token goes
# in, and the credential fields the token and any identifier are read from.
PROVIDERS = {
    "github": {
        "display": "GitHub",
        "material": {"access_token": "live-github-token"},
        "live": {"token": "live-github-token"},
        "hosts": [{"match": "exact", "value": "api.github.com", "port": 443}],
        "mode": "credential_endpoint",
        "header": BEARER,
        # The GitHub CLI presents its token under the "token" scheme.
        "formats": ["token {value}"],
        "env": [
            "GITHUB_TOKEN",
            "GH_TOKEN",
            "GH_ENTERPRISE_TOKEN",
            "GITHUB_ENTERPRISE_TOKEN",
        ],
        "decoy": r"ghp_[A-Za-z0-9]{36}",
        "executable": "gh",
        "classes": [
            {"match": {"methods": ["POST"], "path": "/graphql"}, "class": "update"},
            {"match": {"methods": ["POST"], "path": "/api/graphql"}, "class": "update"},
            {"match": {"methods": ["POST"], "path": "/*/api/graphql"}, "class": "update"},
        ],
    },
    "gitlab": {
        "display": "GitLab",
        "material": {
            "gitlab_host": "https://gitlab.com",
            "gitlab_token": "live-gitlab-token",
        },
        "live": {"token": "live-gitlab-token"},
        "hosts": [
            {"match": "exact", "value": "gitlab.com", "port": 443, "path": "/api/*"}
        ],
        "mode": "credential_endpoint",
        "header": ("PRIVATE-TOKEN", "{value}"),
        "env": ["GITLAB_TOKEN"],
        "decoy": r"glpat-[A-Za-z0-9]{32}",
        "executable": "glab",
        "classes": [
            {"match": {"methods": ["POST"], "path": "/api/graphql"}, "class": "update"},
            {"match": {"methods": ["POST"], "path": "/*/api/graphql"}, "class": "update"},
        ],
    },
    "cloudflare": {
        "display": "Cloudflare",
        "material": {
            "account_id": "cf-account-0123456789",
            "access_token": "live-cloudflare-token",
        },
        "live": {"accountId": "cf-account-0123456789", "token": "live-cloudflare-token"},
        "identifiers": {"accountId": "cf-account-0123456789"},
        "identifier_env": {"CLOUDFLARE_ACCOUNT_ID": "cf-account-0123456789"},
        "hosts": [
            {
                "match": "exact",
                "value": "api.cloudflare.com",
                "port": 443,
                "path": "/client/v4/*",
            }
        ],
        "mode": "fixed",
        "header": BEARER,
        "env": ["CLOUDFLARE_API_TOKEN"],
        "decoy": r"[A-Za-z0-9]{40}",
        "executable": "wrangler",
    },
    "vercel": {
        "display": "Vercel",
        "material": {"api_token": "live-vercel-token"},
        "live": {"token": "live-vercel-token"},
        "hosts": [{"match": "exact", "value": "api.vercel.com", "port": 443}],
        "mode": "fixed",
        "header": BEARER,
        "env": ["VERCEL_TOKEN"],
        "decoy": r"[A-Za-z0-9]{24}",
        "executable": "vercel",
    },
    "render": {
        "display": "Render",
        "material": {"api_key": "live-render-key"},
        "live": {"token": "live-render-key"},
        "hosts": [
            {"match": "exact", "value": "api.render.com", "port": 443, "path": "/v1/*"}
        ],
        "mode": "fixed",
        "header": BEARER,
        "env": ["RENDER_API_KEY"],
        "decoy": r"rnd_[A-Za-z0-9]{28}",
        "executable": "render",
    },
    "railway": {
        "display": "Railway",
        "material": {"api_token": "live-railway-token"},
        "live": {"token": "live-railway-token"},
        "hosts": [
            {
                "match": "exact",
                "value": "backboard.railway.app",
                "port": 443,
                "path": "/graphql/*",
            },
            {
                "match": "exact",
                "value": "backboard.railway.com",
                "port": 443,
                "path": "/graphql/*",
            },
        ],
        "mode": "fixed",
        "header": BEARER,
        "env": ["RAILWAY_API_TOKEN"],
        "decoy": r"[0-9a-f]{36}",
        "executable": "railway",
        "classes": [
            {"match": {"methods": ["POST"], "path": "/graphql/*"}, "class": "update"}
        ],
    },
    "supabase": {
        "display": "Supabase",
        "material": {"access_token": "live-supabase-token"},
        "live": {"token": "live-supabase-token"},
        "hosts": [
            {"match": "exact", "value": "api.supabase.com", "port": 443, "path": "/v1/*"}
        ],
        "mode": "fixed",
        "header": BEARER,
        "env": ["SUPABASE_ACCESS_TOKEN"],
        "decoy": r"sbp_[0-9a-f]{40}",
        "executable": "supabase",
    },
}
ALL = sorted(PROVIDERS)


@pytest.fixture(autouse=True)
def server_keypair(monkeypatch):
    use_test_server_keypair(monkeypatch)


@pytest.fixture
def space(db):
    """A workspace whose member may also read integration credentials, which
    binding one to a packaged Connection takes."""

    space = workspace("providers")
    role = space.member.role
    role.permissions["permissions"]["IntegrationCredentials"] = ACTIONS
    role.save()
    return space


def _only(payload):
    [connection] = payload["connections"]
    return connection


def _injection(provider):
    name, value_format = PROVIDERS[provider]["header"]
    injection = {
        "action": "set_header",
        "name": name,
        "valueFormat": value_format,
        "valueFrom": {"source": "credential", "field": "token"},
        "whenAbsent": "attach",
    }
    if "formats" in PROVIDERS[provider]:
        injection["valueFormats"] = PROVIDERS[provider]["formats"]
    return injection


def _create(space, provider, credential, **arguments):
    return CreateAgentConnectionMutation.mutate(
        None,
        space.info,
        organisation_id=space.organisation.id,
        name=f"{provider} connection",
        service_type=provider,
        authentication_id=credential.id,
        **arguments,
    ).connection


# The definitions


@pytest.mark.parametrize("provider", ALL)
def test_the_definition_loads_and_uses_the_providers_own_credential(provider):
    expected = PROVIDERS[provider]
    service = get_config_registry().get_service(provider)
    name, value_format = expected["header"]

    assert service["schemaVersion"] == 1
    assert service["display_name"] == expected["display"]
    assert (service["provider"], service["credential_providers"]) == (
        provider,
        [provider],
    )
    assert (service["protocol"], service["proxy_only"]) == ("http", False)
    # The provider's public API hosts.
    assert service["hosts"] == expected["hosts"]
    assert service["host_rules_mode"] == expected["mode"]
    assert service["injection"] == {
        "action": "set_header",
        "name": name,
        "value_format": value_format,
        "value_from": {"source": "credential", "field": "token"},
        "when_absent": "attach",
        **({"value_formats": expected["formats"]} if "formats" in expected else {}),
    }
    assert service["fields"]["token"] == {"class": "secret", "delivery": "decoy"}
    assert set(service["decoy_format"]) == {"token"}
    assert [
        binding["name"]
        for binding in service["environment_bindings"]
        if binding["source"] == "decoy"
    ] == expected["env"]
    assert all(
        binding["sensitive"] and binding["action"] == "set"
        for binding in service["environment_bindings"]
        if binding["source"] == "decoy"
    )
    assert service["client_matchers"] == [
        {"kind": "executable", "values": [expected["executable"]]}
    ]
    assert service.get("operation_classes", []) == expected.get("classes", [])
    assert expected["display"] in service["context_template"]
    assert all(name in service["context_template"] for name in expected["env"])


def test_aws_and_postgres_definitions_gained_nothing():
    registry = get_config_registry()

    for service_type in ("aws", "postgres"):
        service = registry.get_service(service_type)
        assert "when_absent" not in service["injection"]
        assert "value_formats" not in service["injection"]
        assert "operation_classes" not in service
    assert registry.get_service("aws")["host_rules_mode"] == "optional_override"
    assert registry.get_service("postgres")["host_rules_mode"] == "required_endpoint"


# The session payload


@pytest.mark.parametrize("provider", ALL)
def test_a_provider_connection_reaches_the_session(space, provider):
    expected = PROVIDERS[provider]
    connection = live_packaged_connection(space, provider, expected["material"])
    granted = grant(space, connection)
    client = member_client(space)

    opened = open_session(client, space.workflow)

    sent = _only(opened)
    decoy = sent["decoyMaterial"]["token"]
    assert re.fullmatch(expected["decoy"], decoy), decoy
    assert decoy not in expected["material"].values()
    identifier_env = expected.get("identifier_env", {})
    assert {
        key: sent[key]
        for key in (
            "grantId",
            "connectionId",
            "connectionName",
            "credentialId",
            "credentialName",
            "credentialProvider",
            "serviceType",
            "protocol",
            "hosts",
            "injection",
            "onRefresh",
            "identifiers",
            "decoyMaterial",
            "agentEnv",
            "configEnv",
            "secretMaterial",
            "policy",
        )
    } == {
        "grantId": str(granted.id),
        "connectionId": str(connection.id),
        "connectionName": connection.name,
        "credentialId": str(connection.authentication_id),
        "credentialName": connection.authentication.name,
        "credentialProvider": provider,
        "serviceType": provider,
        "protocol": "http",
        "hosts": expected["hosts"],
        "injection": _injection(provider),
        "onRefresh": "none",
        "identifiers": expected.get("identifiers", {}),
        "decoyMaterial": {"token": decoy},
        # Every variable the provider's own tools read holds the decoy.
        "agentEnv": {**{name: decoy for name in expected["env"]}, **identifier_env},
        "configEnv": {},
        "secretMaterial": expected["live"],
        "policy": unrestricted_policy(),
    }
    assert [binding["name"] for binding in sent["environmentBindings"]] == [
        *identifier_env,
        *expected["env"],
    ]
    assert sent.get("operationClasses") == expected.get("classes")
    assert ("operationClasses" in sent) == ("classes" in expected)
    # Not a custom Connection: one injection, no sealed value, and never a
    # credential on a plain-HTTP request.
    for absent in ("injections", "allowPlainHttp", "sealedMaterial", "grantExpiresAt"):
        assert absent not in sent
    assert opened["configEnv"] == {}

    discovered = _only(session_get(client, opened, "discover"))
    assert "secretMaterial" not in discovered
    assert "live-" not in str(discovered)
    for key in (
        "hosts",
        "injection",
        "decoyMaterial",
        "agentEnv",
        "identifiers",
        "policy",
        "environmentBindings",
    ):
        assert discovered[key] == sent[key], key
    assert discovered.get("operationClasses") == expected.get("classes")
    # A refresh keeps the decoy the Agent already holds.
    refreshed = _only(session_get(client, opened))
    assert refreshed["decoyMaterial"] == {"token": decoy}
    assert refreshed["secretMaterial"] == expected["live"]


@pytest.mark.parametrize("provider", ALL)
def test_a_provider_is_in_the_catalog_and_the_context(space, provider):
    expected = PROVIDERS[provider]
    client = member_client(space)
    opened = open_session(client, space.workflow)

    listed = {
        service["serviceType"]: service
        for service in session_get(client, opened, "capabilities")["services"]
    }
    # Listed before the Workflow has it, so an Agent knows it can ask.
    assert listed[provider] == {
        "serviceType": provider,
        "displayName": expected["display"],
        "credentialProviders": [provider],
        "clientMatchers": [{"kind": "executable", "values": [expected["executable"]]}],
        "connectionIds": [],
    }
    unbound = session_get(client, opened, "context", serviceType=provider)["markdown"]
    assert unbound.startswith(f"### {expected['display']}")
    assert "no granted Connection" in unbound

    connection = live_packaged_connection(space, provider, expected["material"])
    grant(space, connection)
    session_get(client, opened)

    listed = {
        service["serviceType"]: service
        for service in session_get(client, opened, "capabilities")["services"]
    }
    assert listed[provider]["connectionIds"] == [str(connection.id)]
    context = session_get(client, opened, "context", serviceType=provider)["markdown"]
    assert f"### {connection.name}" in context
    assert all(name in context for name in expected["env"])
    assert "live-" not in context
    if provider == "cloudflare":
        assert "cf-account-0123456789" in context


@pytest.mark.parametrize("provider", ALL)
def test_a_credential_with_missing_fields_is_refused(space, provider):
    material = PROVIDERS[provider]["material"]
    token_field = next(
        field for field in material if "token" in field or field == "api_key"
    )
    for label, broken in (
        ("absent", {key: value for key, value in material.items() if key != token_field}),
        ("blank", {**material, token_field: "   "}),
        ("header-break", {**material, token_field: "live\r\nX-Injected: 1"}),
    ):
        connection = live_packaged_connection(
            space, provider, material, name=f"{provider} {label}"
        )
        credential = connection.authentication
        credential.credentials = {
            field: encrypt_asymmetric(value, SERVER_KEYPAIR[0].hex())
            for field, value in broken.items()
        }
        credential.save()
        granted = grant(space, connection)

        refusal = open_session(member_client(space), space.workflow, expect=400)

        error = refusal["error"]
        assert error["code"] == "credential_resolution_failed", (label, error)
        assert error["details"]["credentialId"] == str(credential.id)
        assert "is missing or invalid" in error["details"]["reason"]
        assert "live" not in str(error)
        assert AgentEvent.objects.filter(
            connection=connection, event_type="credential_resolution_error"
        ).exists()
        granted.delete()


def test_a_cloudflare_credential_needs_its_account_id(space):
    connection = live_packaged_connection(
        space, "cloudflare", {"access_token": "live-cloudflare-token"}
    )
    grant(space, connection)

    refusal = open_session(member_client(space), space.workflow, expect=400)

    assert refusal["error"]["code"] == "credential_resolution_failed"
    assert "'account_id' is missing or invalid" in refusal["error"]["details"]["reason"]


def test_a_pasted_token_loses_its_surrounding_whitespace(space):
    connection = live_packaged_connection(
        space, "vercel", {"api_token": "  live-vercel-token\n"}
    )
    grant(space, connection)

    opened = open_session(member_client(space), space.workflow)

    assert _only(opened)["secretMaterial"] == {"token": "live-vercel-token"}


# Other forms a request may present the token in


def test_only_the_github_connection_carries_other_value_formats(space):
    """In config and discover alike, and on no other packaged service."""

    from .custom_connections import AWS_MATERIAL

    connections = {
        provider: live_packaged_connection(space, provider, expected["material"])
        for provider, expected in PROVIDERS.items()
    }
    connections["aws"] = live_packaged_connection(space, "aws", AWS_MATERIAL)
    connections["postgres"] = live_packaged_connection(
        space,
        "postgres",
        {"username": "agent", "password": "live-postgres-password", "host": "db.example.com"},
    )
    for connection in connections.values():
        grant(space, connection)
    client = member_client(space)

    opened = open_session(client, space.workflow)

    for payload in (
        opened,
        session_get(client, opened),
        session_get(client, opened, "discover"),
    ):
        injections = {
            item["serviceType"]: item["injection"] for item in payload["connections"]
        }
        assert set(injections) == set(connections)
        assert injections["github"]["valueFormat"] == "Bearer {value}"
        assert injections["github"]["valueFormats"] == ["token {value}"]
        assert [
            service_type
            for service_type, injection in injections.items()
            if "valueFormats" in injection
        ] == ["github"]
        assert "valueFormats" not in payload


# Attaching when a request carries no credential


def test_a_client_that_cannot_attach_is_not_sent_these_connections(space):
    connection = live_packaged_connection(
        space, "github", PROVIDERS["github"]["material"]
    )
    client = member_client(space)
    # Opened before the Connection was granted, by a client that would block
    # a request carrying no credential instead of attaching to it.
    old = open_session(client, space.workflow, features=[])
    grant(space, connection)

    assert session_get(client, old)["connections"] == []
    assert session_get(client, old, "discover")["connections"] == []
    refusal = open_session(member_client(space), space.workflow, features=[], expect=400)
    assert refusal["error"]["code"] == "client_capability_mismatch"
    # GitHub's secret guard comes from its manifest as well.
    assert refusal["error"]["details"]["missingFeatures"] == [
        "provider_rules",
        "when_absent",
    ]
    without_action = open_session(
        member_client(space),
        space.workflow,
        actions=["aws_sigv4", "pg_handshake"],
        expect=400,
    )
    assert without_action["error"]["details"]["missingInjectionActions"] == [
        "set_header"
    ]
    assert _only(open_session(member_client(space), space.workflow))[
        "injection"
    ] == _injection("github")


# Hosts that come from the credential


def test_a_github_enterprise_credential_names_the_connections_hosts(space):
    enterprise = provider_credential(
        space,
        "github",
        {
            "access_token": "live-github-token",
            "host_url": "https://github.example.com",
            "api_url": "https://github.example.com/api/v3",
        },
    )
    assert credential_sets_endpoint("github")

    connection = _create(space, "github", enterprise)

    # REST is below /api/v3 and GraphQL at /api/graphql on an Enterprise
    # Server, and the web interface on the same host gets no token.
    assert connection.config == {
        "hosts": [
            {"match": "exact", "value": "github.example.com", "port": 443, "path": "/api/*"}
        ]
    }
    assert str(connection.host_rules_authored_by_id) == str(space.member.id)
    grant(space, connection)
    sent = _only(open_session(member_client(space), space.workflow))
    assert sent["hosts"] == connection.config["hosts"]
    assert sent["connectionConfig"] == connection.config
    assert sent["secretMaterial"] == {"token": "live-github-token"}


@pytest.mark.parametrize(
    "provider,material,hosts",
    [
        # github.com, whether the credential spells its API out or not.
        ("github", {}, PROVIDERS["github"]["hosts"]),
        ("github", {"api_url": "https://api.github.com"}, PROVIDERS["github"]["hosts"]),
        ("github", {"api_url": "https://api.github.com/", "host_url": "https://github.com"}, PROVIDERS["github"]["hosts"]),
        (
            "github",
            {"api_url": "https://api.acme.ghe.com"},
            [{"match": "exact", "value": "api.acme.ghe.com", "port": 443}],
        ),
        (
            "github",
            {"api_url": "https://GitHub.Example.com:8443/api/v3/"},
            [{"match": "exact", "value": "github.example.com", "port": 8443, "path": "/api/*"}],
        ),
        ("gitlab", {"gitlab_host": "https://gitlab.com"}, PROVIDERS["gitlab"]["hosts"]),
        ("gitlab", {"gitlab_host": "gitlab.com/"}, PROVIDERS["gitlab"]["hosts"]),
        (
            "gitlab",
            {"gitlab_host": "https://gitlab.example.com:8443"},
            [{"match": "exact", "value": "gitlab.example.com", "port": 8443, "path": "/api/*"}],
        ),
        (
            "gitlab",
            {"gitlab_host": " https://code.example.com/gitlab/ "},
            [{"match": "exact", "value": "code.example.com", "port": 443, "path": "/gitlab/api/*"}],
        ),
    ],
)
def test_hosts_are_derived_from_the_credential(space, provider, material, hosts):
    token_field = "access_token" if provider == "github" else "gitlab_token"
    credential = provider_credential(
        space, provider, {token_field: "live-token", **material}
    )

    assert resolve_connection_config(credential) == {"hosts": hosts}
    connection = _create(space, provider, credential)

    assert connection.config == {"hosts": hosts}
    assert connection.state == AgentConnection.ACTIVE


@pytest.mark.parametrize(
    "provider,material,message",
    [
        ("github", {"api_url": "http://github.example.com/api/v3"}, "must be an https URL"),
        ("gitlab", {"gitlab_host": "http://gitlab.example.com"}, "must be an https URL"),
        ("gitlab", {"gitlab_host": "ftp://gitlab.example.com"}, "must be an https URL"),
        ("gitlab", {"gitlab_host": "https://user:pass@gitlab.example.com"}, "must be a host"),
        ("gitlab", {"gitlab_host": "https://gitlab.example.com/?next=x"}, "must be a host"),
        ("gitlab", {"gitlab_host": "https://gitlab.example.com/a*b"}, "must be a host"),
        ("gitlab", {"gitlab_host": "https://gitlab.example.com:port"}, "not a valid URL"),
        ("gitlab", {"gitlab_host": "   "}, "'gitlab_host' is missing or invalid"),
        ("gitlab", {}, "'gitlab_host' is missing or invalid"),
        ("github", {"api_url": "https://bad host.example.com"}, "invalid host label"),
    ],
)
def test_an_endpoint_an_agent_could_not_use_is_refused(space, provider, material, message):
    token_field = "access_token" if provider == "github" else "gitlab_token"
    credential = provider_credential(
        space, provider, {token_field: "live-token", **material}
    )

    with pytest.raises(GraphQLError, match=message) as refusal:
        _create(space, provider, credential)

    assert "live-token" not in str(refusal.value)
    assert not AgentConnection.objects.filter(authentication=credential).exists()


def test_a_member_cannot_enter_hosts_the_credential_decides(space):
    own_hosts = {"hosts": [{"match": "exact", "value": "evil.example.com", "port": 443}]}
    for provider in ("github", "gitlab"):
        credential = provider_credential(space, provider, PROVIDERS[provider]["material"])
        display = PROVIDERS[provider]["display"]

        with pytest.raises(
            GraphQLError,
            match=f"{display} Connection config is derived from its Integration Credential",
        ):
            _create(space, provider, credential, config=own_hosts)
        connection = _create(space, provider, credential)
        with pytest.raises(GraphQLError, match="derived from its Integration Credential"):
            UpdateAgentConnectionMutation.mutate(
                None, space.info, connection_id=connection.id, config=own_hosts
            )
        connection.refresh_from_db()
        assert connection.config == {"hosts": PROVIDERS[provider]["hosts"]}


@pytest.mark.parametrize("provider", ["cloudflare", "vercel", "render", "railway", "supabase"])
def test_a_token_goes_only_to_its_services_own_hosts(space, provider):
    """No member can point one of these tokens at another host."""

    own_hosts = {"hosts": [{"match": "exact", "value": "evil.example.com", "port": 443}]}
    credential = provider_credential(space, provider, PROVIDERS[provider]["material"])

    with pytest.raises(GraphQLError, match="unknown config field"):
        _create(space, provider, credential, config=own_hosts)
    connection = _create(space, provider, credential)
    with pytest.raises(GraphQLError, match="unknown config field"):
        UpdateAgentConnectionMutation.mutate(
            None, space.info, connection_id=connection.id, config=own_hosts
        )

    connection.refresh_from_db()
    assert connection.config == {}
    assert get_config_registry().resolve_host_rules(provider, connection.config) == (
        PROVIDERS[provider]["hosts"]
    )


def test_changing_the_credential_of_a_connection_moves_it(space):
    public = provider_credential(space, "gitlab", PROVIDERS["gitlab"]["material"])
    own = provider_credential(
        space,
        "gitlab",
        {"gitlab_host": "https://gitlab.example.com", "gitlab_token": "live-own-token"},
        name="Self-hosted GitLab",
    )
    connection = _create(space, "gitlab", public)
    version = connection.host_rules_version

    moved = UpdateAgentConnectionMutation.mutate(
        None, space.info, connection_id=connection.id, authentication_id=own.id
    ).connection

    assert moved.config == {
        "hosts": [
            {"match": "exact", "value": "gitlab.example.com", "port": 443, "path": "/api/*"}
        ]
    }
    assert moved.host_rules_version != version
    renamed = UpdateAgentConnectionMutation.mutate(
        None, space.info, connection_id=connection.id, name="GitLab"
    ).connection
    assert (renamed.name, renamed.config) == ("GitLab", moved.config)


def _edit_credential(space, credential, material):
    return UpdateProviderCredentials.mutate(
        None,
        space.info,
        credential_id=credential.id,
        expected_revision=credential.revision,
        name=credential.name,
        credentials={
            field: encrypt_asymmetric(value, SERVER_KEYPAIR[0].hex())
            for field, value in material.items()
        },
    ).credential


def test_editing_a_bound_credentials_endpoint_moves_its_connection(space):
    credential = provider_credential(space, "gitlab", PROVIDERS["gitlab"]["material"])
    connection = _create(space, "gitlab", credential)
    grant(space, connection)
    client = member_client(space)
    opened = open_session(client, space.workflow)
    before = generation(opened)
    version = connection.host_rules_version

    # A new token leaves the Connection where it is and refreshes its sessions.
    credential = _edit_credential(
        space,
        credential,
        {"gitlab_host": "https://gitlab.com", "gitlab_token": "live-rotated-token"},
    )
    connection.refresh_from_db()
    assert connection.host_rules_version == version
    assert generation(opened) == before + 1
    assert _only(session_get(client, opened))["secretMaterial"] == {
        "token": "live-rotated-token"
    }

    # An endpoint an Agent could not use is refused while a Connection uses it.
    with pytest.raises(GraphQLError, match="used by an Agent Connection.*https URL"):
        _edit_credential(
            space,
            credential,
            {"gitlab_host": "http://gitlab.example.com", "gitlab_token": "live-moved-token"},
        )

    # A new endpoint moves the Connection with it and ends its sessions.
    _edit_credential(
        space,
        credential,
        {"gitlab_host": "https://gitlab.example.com", "gitlab_token": "live-moved-token"},
    )
    connection.refresh_from_db()
    assert connection.config == {
        "hosts": [
            {"match": "exact", "value": "gitlab.example.com", "port": 443, "path": "/api/*"}
        ]
    }
    assert connection.host_rules_version != version
    assert AgentSession.objects.get(pk=opened["sessionUid"]).revoked_at is not None
    audit = AuditEvent.objects.filter(
        resource_type=AuditEvent.AGENT_CONNECTION,
        resource_id=str(connection.id),
        event_type=AuditEvent.UPDATE,
    ).latest("timestamp")
    assert audit.old_values["config"] == {"hosts": PROVIDERS["gitlab"]["hosts"]}
    assert audit.new_values["config"] == connection.config
    fresh = _only(open_session(member_client(space), space.workflow))
    assert fresh["hosts"] == connection.config["hosts"]
    assert fresh["secretMaterial"] == {"token": "live-moved-token"}


def test_a_credential_no_agent_uses_may_name_any_endpoint_a_sync_accepts(space):
    credential = provider_credential(space, "gitlab", PROVIDERS["gitlab"]["material"])

    edited = _edit_credential(
        space,
        credential,
        {"gitlab_host": "http://gitlab.internal.example", "gitlab_token": "live-token"},
    )

    with pytest.raises(CredentialResolutionError, match="must be an https URL"):
        resolve_connection_config(edited)


def test_a_token_never_goes_to_hosts_its_credential_does_not_name(space):
    connection = live_packaged_connection(
        space, "github", PROVIDERS["github"]["material"]
    )
    grant(space, connection)
    drifted = {"hosts": [{"match": "exact", "value": "evil.example.com", "port": 443}]}
    AgentConnection.objects.filter(id=connection.id).update(config=drifted)

    refusal = open_session(member_client(space), space.workflow, expect=400)

    assert refusal["error"]["code"] == "credential_resolution_failed"
    assert "routing does not match" in refusal["error"]["details"]["reason"]
    assert "live-github-token" not in str(refusal)


@pytest.mark.parametrize("provider", ["github", "vercel"])
def test_a_blocked_host_cannot_be_added_to_a_token_providers_hosts(space, provider):
    connection = live_packaged_connection(
        space, provider, PROVIDERS[provider]["material"]
    )
    config = dict(connection.config)
    grant(space, connection)
    client = member_client(space)
    opened = open_session(client, space.workflow)
    event = AgentEvent.objects.create(
        event_id="blocked-host",
        organisation=space.organisation,
        agent=space.agent,
        workflow=space.workflow,
        session_id=opened["sessionUid"],
        proxy_created_at=connection.created_at,
        event_type="request",
        protocol="http",
        host="uploads.github.com",
        port=443,
        provider="proxy",
        status_code=403,
        proxy_decision=AgentEvent.BLOCK,
        outcome="denied",
        reason="lockdown_unbound_host",
    )

    with pytest.raises(GraphQLError, match="cannot be added to"):
        AllowAgentConnectionHostMutation.mutate(
            None,
            space.info,
            event_ingest_seq=event.ingest_seq,
            connection_id=connection.id,
            expected_version=connection.host_rules_version,
        )

    connection.refresh_from_db()
    assert connection.config == config


# Asking for one, with the setup request every packaged service uses


@pytest.mark.parametrize("provider", ["github", "vercel"])
def test_an_agent_asks_for_a_provider_with_an_ordinary_setup_request(space, provider):
    expected = PROVIDERS[provider]
    client, _ = agent_client(space)
    opened = open_session(client, space.workflow)

    agent_request = filed(
        ask(
            client,
            kind="setup",
            serviceType=provider,
            credentialProvider=provider,
            credentialName=f"{expected['display']} deploy",
            markdown=f"Connect this Workflow to {expected['display']}.",
        )
    )

    assert (agent_request.kind, agent_request.action) == (AgentRequest.SETUP, {})
    assert agent_request.connection.state == AgentConnection.PENDING_CREDENTIALS
    credential = provider_credential(space, provider, expected["material"])
    result = FulfillAgentRequestMutation.mutate(
        None,
        space.info,
        request_id=agent_request.id,
        expected_revision=agent_request.revision,
        credential_id=credential.id,
        expected_credential_revision=credential.revision,
    )

    connection = result.connection
    assert connection.state == AgentConnection.ACTIVE
    assert connection.service_type == provider
    assert str(connection.authentication_id) == str(credential.id)
    assert get_config_registry().resolve_host_rules(
        provider, connection.config
    ) == expected["hosts"]
    assert result.runtime_action == "restart_required"
    sent = _only(session_get(client, opened))
    assert sent["grantId"] == str(result.grant.id)
    assert sent["hosts"] == expected["hosts"]
    assert sent["secretMaterial"] == expected["live"]


def test_a_setup_request_is_refused_a_credential_agents_cannot_use(space):
    client, _ = agent_client(space)
    open_session(client, space.workflow)
    agent_request = filed(
        ask(
            client,
            kind="setup",
            serviceType="gitlab",
            credentialProvider="gitlab",
            credentialName="GitLab",
            markdown="Connect this Workflow to GitLab.",
        )
    )
    plain = provider_credential(
        space,
        "gitlab",
        {"gitlab_host": "http://gitlab.internal.example", "gitlab_token": "live-token"},
    )

    with pytest.raises(GraphQLError, match="must be an https URL"):
        FulfillAgentRequestMutation.mutate(
            None,
            space.info,
            request_id=agent_request.id,
            expected_revision=agent_request.revision,
            credential_id=plain.id,
            expected_credential_revision=plain.revision,
        )

    agent_request.refresh_from_db()
    assert agent_request.status == AgentRequest.PENDING
    assert agent_request.connection.state == AgentConnection.PENDING_CREDENTIALS


def test_a_provider_credential_fits_only_its_own_service(space):
    vercel = provider_credential(space, "vercel", PROVIDERS["vercel"]["material"])

    with pytest.raises(GraphQLError, match="incompatible with this service"):
        _create(space, "render", vercel)
    client, _ = agent_client(space)
    open_session(client, space.workflow)
    refused(
        ask(
            client,
            kind="setup",
            serviceType="github",
            credentialProvider="gitlab",
            credentialName="GitHub",
            markdown="Connect this Workflow to GitHub.",
        ),
        "credential_provider_not_supported",
    )


# Access rules and call classes


def test_a_provider_connection_takes_access_rules_like_any_http_connection(space):
    connection = live_packaged_connection(
        space, "github", PROVIDERS["github"]["material"], name="GitHub"
    )
    space.connection = connection
    grant(space, connection)
    client, _ = agent_client(space)
    opened = open_session(client, space.workflow, features=POLICY_FEATURES)
    policy = {
        "version": 1,
        "default": "allow",
        "rules": [
            {"class": "update", "effect": "block"},
            {"class": "delete", "effect": "ask"},
        ],
    }

    stored = set_policy(space, policy)

    assert stored.policy == policy
    assert _only(session_get(client, opened))["policy"] == unrestricted_policy(
        rules=policy["rules"]
    )
    # A rule by AWS action belongs to AWS Connections only.
    with pytest.raises(GraphQLError, match="only an AWS Connection"):
        set_policy(
            space,
            {"version": 1, "rules": [{"operation": "ec2:RunInstances", "effect": "ask"}]},
        )

    def allow(match):
        return ask(
            client,
            action={
                "type": "agent_grant.allow",
                "version": 1,
                "connectionId": str(connection.id),
                "allow": {"match": match},
            },
        )

    # GitHub's own override classes a GraphQL call as an update, which this
    # Connection blocks, so an allow for it could not help.
    refused(
        allow({"methods": ["POST"], "path": "/graphql"}), "access_policy_blocks_allow"
    )
    # Any other POST is a create by its method, and a delete is only asked about.
    assert allow({"methods": ["POST"], "path": "/repos/acme/x/issues"}).status_code == 201
    assert allow({"methods": ["DELETE"], "path": "/repos/acme/x"}).status_code == 201


# What the Console and a client read about the services


def test_the_registry_endpoint_lists_each_service_with_its_public_hosts(space):
    agent, _ = agent_client(space)

    for client in (agent, member_client(space)):
        response = client.get("/v1/agents/registry/")

        assert response.status_code == 200, response.content
        services = response.json()["services"]
        assert set(services) == {"aws", "postgres", *PROVIDERS}
        for provider, expected in PROVIDERS.items():
            service = services[provider]
            # What a client needs to tell an Agent which service to ask for
            # when a call to one of these hosts has no Connection.
            assert {
                key: service[key]
                for key in ("serviceType", "displayName", "credentialProviders", "hosts")
            } == {
                "serviceType": provider,
                "displayName": expected["display"],
                "credentialProviders": [provider],
                "hosts": expected["hosts"],
            }
            assert service["protocol"] == "http"
            assert service["hostRulesMode"] == expected["mode"]
            assert service["injection"]["whenAbsent"] == "attach"
            assert service["injection"].get("valueFormats") == expected.get("formats")
            assert service.get("operationClasses", []) == expected.get("classes", [])
        assert services["aws"]["hosts"] == [{"match": "suffix", "value": ".amazonaws.com"}]
        # PostgreSQL has no public host: each Connection names its own.
        assert services["postgres"]["hosts"] == []
        assert "live-" not in response.content.decode()


def test_the_console_lists_the_services_as_templates(space):
    result = graphql(
        space,
        "query($o: ID!) { agentServiceTemplates(organisationId: $o) {"
        " serviceType displayName protocol provider hosts hostRulesMode injection"
        " decoyFormat credentialProviders operationClasses environmentBindings } }",
        o=str(space.organisation.id),
    )

    assert result.errors is None, result.errors
    templates = {item["serviceType"]: item for item in result.data["agentServiceTemplates"]}
    assert set(templates) == {"aws", "postgres", *PROVIDERS}
    for provider, expected in PROVIDERS.items():
        template = templates[provider]
        assert template["displayName"] == expected["display"]
        assert template["credentialProviders"] == [provider]
        assert template["hosts"] == expected["hosts"]
        assert template["hostRulesMode"] == expected["mode"]
        assert template["operationClasses"] == expected.get("classes", [])
        assert template["injection"]["when_absent"] == "attach"
    assert templates["aws"]["operationClasses"] == []
    assert templates["postgres"]["operationClasses"] == []
