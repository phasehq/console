"""Loader and schema guards for the packaged Agent service registry.

Every definition under ``api/utils/agent_config/services/v1`` is validated at
import time, so these tests corrupt copies of the real packaged files rather
than hand-written fixtures: a rule that stops rejecting bad input is a rule
that would let a permissive definition ship.
"""

import json
from pathlib import Path
import shutil

import pytest

from api.utils.agent_config import (
    CLIENT_MATCHER_SCHEMA_VERSION,
    DEFAULT_SERVICE_ROOT,
    REGISTRY,
    ConfigRegistry,
    ConfigRegistryError,
)


def _copied_registry(tmp_path: Path) -> Path:
    root = tmp_path / "v1"
    shutil.copytree(DEFAULT_SERVICE_ROOT, root)
    return root


def _rewrite(root: Path, filename: str, mutate) -> None:
    path = root / filename
    document = json.loads(path.read_text(encoding="utf-8"))
    mutate(document)
    path.write_text(json.dumps(document), encoding="utf-8")


def test_packaged_registry_loads_every_shipped_definition():
    packaged = {path.stem for path in DEFAULT_SERVICE_ROOT.glob("*.json")}

    assert packaged, "the packaged registry must not be empty"
    assert set(REGISTRY.services) == packaged
    assert REGISTRY.schema_version == 1
    assert CLIENT_MATCHER_SCHEMA_VERSION == 1
    assert set(ConfigRegistry.load(DEFAULT_SERVICE_ROOT).services) == packaged


def test_only_services_with_a_credential_provider_are_connectable():
    """`credential_providers` is what admits a service to the runtime.

    A definition may ship before its provider exists; declaring none is what
    keeps it out of capabilities, Connection creation, and scoped context.
    """

    connectable = {
        service_type
        for service_type, service in REGISTRY.services.items()
        if service["credential_providers"]
    }

    assert connectable == {
        "aws",
        "postgres",
        "github",
        "gitlab",
        "cloudflare",
        "vercel",
        "render",
        "railway",
        "supabase",
    }
    for service_type, service in REGISTRY.services.items():
        if service_type in connectable:
            assert service["client_matchers"], service_type
            assert service["provider"] in service["credential_providers"]


def test_registry_capabilities_summarise_the_packaged_definitions():
    payload = REGISTRY.as_dict()
    services = REGISTRY.services.values()
    capabilities = payload["capabilities"]

    assert payload["schemaVersion"] == 1
    # Derived keys must be the exact union over what ships, so a new definition
    # cannot widen the runtime without widening the advertised capability.
    assert capabilities["protocols"] == sorted({s["protocol"] for s in services})
    assert capabilities["injectionActions"] == sorted(
        {s["injection"]["action"] for s in services}
    )
    assert capabilities["credentialProviders"] == sorted(
        {p for s in services for p in s["credential_providers"]}
    )
    # The services that ship today, pinned so a silent deletion is visible.
    assert capabilities["protocols"] == ["http", "postgres"]
    assert capabilities["injectionActions"] == [
        "aws_sigv4",
        "pg_handshake",
        "set_header",
    ]
    assert capabilities["credentialProviders"] == [
        "aws",
        "aws_assume_role",
        "cloudflare",
        "github",
        "gitlab",
        "postgres",
        "railway",
        "render",
        "supabase",
        "vercel",
    ]
    # Closed vocabularies, fixed by the loader rather than by the definitions.
    assert payload["capabilities"]["environmentBindingActions"] == ["set", "unset"]
    assert payload["capabilities"]["environmentBindingSources"] == [
        "ca",
        "connection_config",
        "decoy",
        "identifier",
        "proxy",
        "runtime",
    ]
    assert payload["capabilities"]["clientMatcherKinds"] == [
        "executable",
        "uri_scheme",
    ]
    assert "availableCredentialMethods" not in payload["capabilities"]
    assert "policyBuckets" not in payload["capabilities"]


def test_loader_supplies_the_fields_definitions_no_longer_author():
    """Fixed-value fields are resolved, not authored.

    They stay on the resolved service because the runtime and the CLI read
    them; dropping them from the definitions only removes the ceremony.
    """

    aws = REGISTRY.get_service("aws")

    assert (aws["proxy_only"], aws["on_refresh"]) == (False, "none")
    assert all(
        binding["system_managed"] is True and isinstance(binding["sensitive"], bool)
        for binding in aws["environment_bindings"]
    )
    for service in REGISTRY.services.values():
        assert {"kind", "credential_host_field"}.isdisjoint(service)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda document: document.update({"proxy_only": "yes"}),
            "proxy_only: expected a boolean",
        ),
        (
            lambda document: document.update({"on_refresh": "always"}),
            "on_refresh: expected 'none' or 'synthetic_ok'",
        ),
        (
            lambda document: document.update({"credential_host_field": "region"}),
            "unknown field",
        ),
        (
            lambda document: document["environment_bindings"][0].update(
                {"system_managed": True}
            ),
            "unknown field",
        ),
    ],
)
def test_load_still_validates_fields_that_defaults_made_optional(
    tmp_path, mutation, message
):
    root = _copied_registry(tmp_path)
    _rewrite(root, "aws.json", mutation)

    with pytest.raises(ConfigRegistryError, match=message):
        ConfigRegistry.load(root)


def test_load_rejects_sensitive_on_a_cleanup_binding(tmp_path):
    """`unset` removes a variable, so it has no value to classify."""

    root = _copied_registry(tmp_path)

    def mark_cleanup_sensitive(document):
        cleanup = next(
            binding
            for binding in document["environment_bindings"]
            if binding["action"] == "unset"
        )
        cleanup["sensitive"] = True

    _rewrite(root, "aws.json", mark_cleanup_sensitive)

    with pytest.raises(ConfigRegistryError, match="no value to classify"):
        ConfigRegistry.load(root)


def test_service_registry_owns_provider_environment_bindings_and_cleanup():
    aws = REGISTRY.get_service("aws")
    by_name = {binding["name"]: binding for binding in aws["environment_bindings"]}

    assert by_name["AWS_ACCESS_KEY_ID"] == {
        "name": "AWS_ACCESS_KEY_ID",
        "action": "set",
        "source": "identifier",
        "source_field": "access_key_id",
        "sensitive": False,
        "system_managed": True,
    }
    assert by_name["AWS_SECRET_ACCESS_KEY"]["source"] == "decoy"
    assert by_name["AWS_SECRET_ACCESS_KEY"]["sensitive"] is True
    assert by_name["AWS_SESSION_TOKEN"] == {
        "name": "AWS_SESSION_TOKEN",
        "action": "set",
        "source": "decoy",
        "source_field": "session_token",
        "sensitive": True,
        "system_managed": True,
    }
    assert by_name["AWS_REGION"]["source"] == "connection_config"
    assert by_name["AWS_DEFAULT_REGION"]["source_field"] == "region"
    assert by_name["AWS_PROFILE"] == {
        "name": "AWS_PROFILE",
        "action": "unset",
        "source": "runtime",
        "source_field": "secret_access_key",
        "sensitive": False,
        "system_managed": True,
    }
    assert {
        binding["name"]
        for binding in aws["environment_bindings"]
        if binding["action"] == "unset"
    } == {
        "AWS_SECURITY_TOKEN",
        "AWS_PROFILE",
        "AWS_DEFAULT_PROFILE",
        "AWS_ROLE_ARN",
        "AWS_ROLE_SESSION_NAME",
        "AWS_WEB_IDENTITY_TOKEN_FILE",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
        "AWS_CONTAINER_AUTHORIZATION_TOKEN",
        "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
    }
    # Files remain untouched and their explicit selectors stay available; only
    # competing credential-chain selectors are removed from the child process.
    assert "AWS_CONFIG_FILE" not in by_name
    assert "AWS_SHARED_CREDENTIALS_FILE" not in by_name


def test_service_registry_owns_exact_client_discovery_hints():
    aws = REGISTRY.get_service("aws")
    postgres = REGISTRY.get_service("postgres")

    assert aws["client_matchers"] == [{"kind": "executable", "values": ["aws"]}]
    assert postgres["client_matchers"] == [
        {
            "kind": "executable",
            "values": [
                "clusterdb",
                "createdb",
                "createuser",
                "dropdb",
                "dropuser",
                "pg_basebackup",
                "pg_dump",
                "pg_dumpall",
                "pg_isready",
                "pg_restore",
                "pgbench",
                "psql",
                "reindexdb",
                "vacuumdb",
            ],
        },
        {"kind": "uri_scheme", "values": ["postgres", "postgresql"]},
    ]


def test_connectable_services_declare_coherent_routing_and_delivery():
    aws = REGISTRY.get_service("aws")
    postgres = REGISTRY.get_service("postgres")

    assert (aws["provider"], aws["proxy_only"]) == ("aws", False)
    assert (postgres["provider"], postgres["proxy_only"]) == ("postgres", False)
    assert aws["host_rules_mode"] == "optional_override"
    assert postgres["host_rules_mode"] == "required_endpoint"
    assert postgres["fields"]["password"]["delivery"] == "decoy"
    assert set(postgres["decoy_format"]) == {"password"}
    assert postgres["credential_providers"] == ["postgres"]
    postgres_environment = {
        binding["name"]: binding for binding in postgres["environment_bindings"]
    }
    assert postgres_environment["PGDATABASE"] == {
        "name": "PGDATABASE",
        "action": "set",
        "source": "connection_config",
        "source_field": "database",
        "sensitive": False,
        "system_managed": True,
    }


def test_every_packaged_injection_has_an_explicit_typed_value_source():
    for service_type, service in REGISTRY.services.items():
        injection = service["injection"]
        value_from = injection["value_from"]
        assert value_from["source"] == "credential", service_type
        if "field" in value_from:
            assert value_from["field"] in service["fields"], service_type
            # GitLab takes the bare token in its own header.
            assert injection["value_format"] == (
                "{value}" if service_type == "gitlab" else "Bearer {value}"
            ), service_type
        else:
            assert set(value_from["fields"].values()).issubset(
                service["fields"]
            ), service_type


def test_host_rules_remain_structured_and_dynamic_postgres_hosts_are_required():
    assert REGISTRY.get_service("aws")["hosts"] == [
        {"match": "suffix", "value": ".amazonaws.com"}
    ]
    assert REGISTRY.resolve_host_rules("aws", {}) == [
        {"match": "suffix", "value": ".amazonaws.com"}
    ]

    config = REGISTRY.validate_service_config(
        "postgres",
        {
            "hosts": [
                {
                    "match": "exact",
                    "value": "db.internal.example",
                    "port": 5432,
                }
            ],
            "database": "agent_runtime",
        },
    )
    assert config["hosts"][0]["port"] == 5432

    with pytest.raises(
        ConfigRegistryError, match="missing required config field 'hosts'"
    ):
        REGISTRY.validate_service_config("postgres", {"database": "agent_runtime"})
    with pytest.raises(ConfigRegistryError, match="expected an object"):
        REGISTRY.validate_service_config("postgres", {"hosts": ["db.example.com"]})


@pytest.mark.parametrize(
    ("rule", "message"),
    [
        ({"match": "suffix", "value": ".com"}, "below a top-level domain"),
        ({"match": "suffix", "value": ".10.0.0.1"}, "cannot be suffix host rules"),
        ({"match": "suffix", "value": ".0x7f"}, "numeric label"),
        ({"match": "exact", "value": "010.0.0.1"}, "numeric label"),
        ({"match": "exact", "value": "0x7f.1"}, "numeric label"),
        ({"match": "exact", "value": "2130706433"}, "numeric label"),
        ({"match": "exact", "value": "127.1"}, "numeric label"),
        ({"match": "exact", "value": "fe80::1%eth0"}, "zone identifiers"),
    ],
)
def test_host_rules_reject_ambiguous_or_overly_broad_hosts(rule, message):
    with pytest.raises(ConfigRegistryError, match=message):
        REGISTRY.validate_service_config("aws", {"hosts": [rule]})


@pytest.mark.parametrize(
    "rule",
    [
        {"match": "exact", "value": "10.0.0.1"},
        {"match": "exact", "value": "::1"},
        {"match": "exact", "value": "db"},
        {"match": "exact", "value": "1password.com"},
        {"match": "suffix", "value": ".internal.example"},
    ],
)
def test_host_rules_accept_canonical_hosts(rule):
    config = REGISTRY.validate_service_config("aws", {"hosts": [rule]})

    assert config["hosts"] == [rule]


def test_load_rejects_decoys_too_long_to_index(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "postgres.json",
        lambda document: document["decoy_format"].update(
            {"password": "phx_pg_{rand:alnum:257}"}
        ),
    )

    with pytest.raises(ConfigRegistryError, match="at most 256 characters"):
        ConfigRegistry.load(root)


def test_load_rejects_missing_or_untyped_injection_sources(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "aws.json",
        lambda document: document["injection"].pop("value_from"),
    )

    with pytest.raises(ConfigRegistryError, match="missing required field.*value_from"):
        ConfigRegistry.load(root)


def test_load_rejects_injection_source_fields_not_declared_by_service(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "aws.json",
        lambda document: document["injection"]["value_from"]["fields"].update(
            {"access_key_id": "undeclared_identifier"}
        ),
    )

    with pytest.raises(ConfigRegistryError, match="unknown service credential field"):
        ConfigRegistry.load(root)


def test_load_rejects_unknown_provider_references(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "aws.json",
        lambda document: document.update({"provider": "invented_provider"}),
    )

    with pytest.raises(ConfigRegistryError, match="unknown api.services.Providers id"):
        ConfigRegistry.load(root)


@pytest.mark.parametrize(
    ("matcher", "message"),
    [
        (
            {"kind": "regex", "values": ["aws.*"]},
            "expected one of executable, uri_scheme",
        ),
        (
            {"kind": "executable", "values": ["/usr/bin/aws"]},
            "canonical lower-case exact value",
        ),
        (
            {"kind": "executable", "values": ["AWS"]},
            "canonical lower-case exact value",
        ),
        (
            {"kind": "executable", "values": ["aws.exe"]},
            "omit platform extensions",
        ),
        (
            {"kind": "uri_scheme", "values": ["1postgres"]},
            "canonical lower-case exact value",
        ),
        (
            {"kind": "uri_scheme", "values": ["postgres_db"]},
            "canonical lower-case exact value",
        ),
    ],
)
def test_load_rejects_unsafe_or_nonportable_client_matchers(
    tmp_path, matcher, message
):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "aws.json",
        lambda document: document.update({"client_matchers": [matcher]}),
    )

    with pytest.raises(ConfigRegistryError, match=message):
        ConfigRegistry.load(root)


def test_load_requires_discovery_hints_for_available_agent_services(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "aws.json",
        lambda document: document.update({"client_matchers": []}),
    )

    with pytest.raises(ConfigRegistryError, match="must declare at least one"):
        ConfigRegistry.load(root)


def test_load_rejects_ambiguous_host_rules_between_services(tmp_path):
    root = _copied_registry(tmp_path)
    mirror = json.loads((root / "aws.json").read_text(encoding="utf-8"))
    mirror.update(
        {
            "service_type": "aws_mirror",
            "credential_providers": [],
            "client_matchers": [],
        }
    )
    (root / "aws_mirror.json").write_text(json.dumps(mirror), encoding="utf-8")

    with pytest.raises(ConfigRegistryError, match="Ambiguous host rule"):
        ConfigRegistry.load(root)


def test_load_rejects_a_definition_whose_filename_disagrees_with_its_type(tmp_path):
    root = _copied_registry(tmp_path)
    shutil.copy(root / "aws.json", root / "amazon.json")

    with pytest.raises(ConfigRegistryError, match="filename must match service_type"):
        ConfigRegistry.load(root)


@pytest.mark.parametrize(
    ("filename", "mutation"),
    [
        ("aws.json", lambda document: document.update({"host_rules_mode": "invented"})),
        (
            "postgres.json",
            lambda document: document.update(
                {
                    "hosts": [
                        {
                            "match": "exact",
                            "value": "static-postgres.example",
                            "port": 5432,
                        }
                    ]
                }
            ),
        ),
        (
            "postgres.json",
            lambda document: document["config_schema"][0].pop("required"),
        ),
        ("aws.json", lambda document: document.update({"hosts": []})),
        (
            "aws.json",
            lambda document: document["config_schema"][0].update({"required": True}),
        ),
        # A service whose Connections take their hosts from the credential
        # still lists its public hosts, and always holds a Connection's own.
        ("github.json", lambda document: document.update({"hosts": []})),
        (
            "gitlab.json",
            lambda document: document["config_schema"][0].pop("required"),
        ),
        (
            "vercel.json",
            lambda document: document.update({"host_rules_mode": "credential_endpoint"}),
        ),
        # A service with fixed hosts has some, and lets no Connection change them.
        ("vercel.json", lambda document: document.update({"hosts": []})),
        (
            "vercel.json",
            lambda document: document.update(
                {"config_schema": [{"id": "hosts", "input_type": "host_rules"}]}
            ),
        ),
        (
            "aws.json",
            lambda document: document.update({"host_rules_mode": "fixed"}),
        ),
    ],
)
def test_load_rejects_incoherent_host_rules_modes(tmp_path, filename, mutation):
    root = _copied_registry(tmp_path)
    _rewrite(root, filename, mutation)

    with pytest.raises(ConfigRegistryError):
        ConfigRegistry.load(root)


def test_load_rejects_weak_decoy_formats(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "postgres.json",
        lambda document: document["decoy_format"].update(
            {"password": "{rand:hex:16}"}
        ),
    )

    with pytest.raises(ConfigRegistryError, match="at least 128 bits"):
        ConfigRegistry.load(root)


def test_load_rejects_session_capability_as_connection_secret_delivery(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "postgres.json",
        lambda document: document["fields"]["password"].update(
            {"delivery": "session_capability"}
        ),
    )

    with pytest.raises(ConfigRegistryError, match="delivery: invalid for secret field"):
        ConfigRegistry.load(root)


def test_load_rejects_agent_visible_secret_service_configuration(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "aws.json",
        lambda document: document["config_schema"].append(
            {
                "id": "client_secret",
                "input_type": "string",
                "required": True,
                "secret": True,
            }
        ),
    )

    with pytest.raises(
        ConfigRegistryError,
        match="service connection configuration is Agent-visible",
    ):
        ConfigRegistry.load(root)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda document: document["environment_bindings"].append(
                dict(document["environment_bindings"][0])
            ),
            "duplicate environment binding",
        ),
        (
            lambda document: document["environment_bindings"][0].update(
                {"source": "decoy", "source_field": "username"}
            ),
            "decoy bindings require a secret credential field",
        ),
        (
            lambda document: document["environment_bindings"][-1].update(
                {"source_field": "username"}
            ),
            "cleanup must be activated by a decoy credential field",
        ),
    ],
)
def test_load_rejects_ambiguous_or_unsafe_environment_bindings(
    tmp_path, mutation, message
):
    root = _copied_registry(tmp_path)
    _rewrite(root, "postgres.json", mutation)

    with pytest.raises(ConfigRegistryError, match=message):
        ConfigRegistry.load(root)


def test_load_rejects_secret_fields_in_advisory_context(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "postgres.json",
        lambda document: document.update(
            {"context_template": "Never print {{ password }}"}
        ),
    )

    with pytest.raises(ConfigRegistryError, match="rejected password"):
        ConfigRegistry.load(root)


def test_registry_accessors_return_defensive_copies():
    service = REGISTRY.get_service("aws")
    service["hosts"][0]["value"] = "attacker.example"

    assert REGISTRY.get_service("aws")["hosts"][0]["value"] == ".amazonaws.com"


# Attaching a credential to a request that carries none


def test_only_the_token_providers_attach_when_a_request_carries_no_credential():
    attaching = {
        service_type
        for service_type, service in REGISTRY.services.items()
        if service["injection"].get("when_absent") == "attach"
    }

    assert attaching == {
        "github",
        "gitlab",
        "cloudflare",
        "vercel",
        "render",
        "railway",
        "supabase",
    }
    # AWS and PostgreSQL keep blocking, by saying nothing.
    for service_type in ("aws", "postgres"):
        assert "when_absent" not in REGISTRY.get_service(service_type)["injection"]


@pytest.mark.parametrize("mode", ["attach", "block"])
def test_a_packaged_injection_may_say_what_happens_when_absent(tmp_path, mode):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "github.json",
        lambda document: document["injection"].update({"when_absent": mode}),
    )

    loaded = ConfigRegistry.load(root)

    assert loaded.get_service("github")["injection"]["when_absent"] == mode
    # Carried to a client as it is written, and to no other service.
    assert loaded.as_dict()["services"]["github"]["injection"]["when_absent"] == mode
    assert "when_absent" not in loaded.get_service("aws")["injection"]


def test_an_injection_that_does_not_say_keeps_blocking(tmp_path):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "github.json",
        lambda document: document["injection"].pop("when_absent"),
    )

    assert "when_absent" not in ConfigRegistry.load(root).get_service("github")[
        "injection"
    ]


@pytest.mark.parametrize(
    ("filename", "value", "message"),
    [
        ("github.json", "always", "expected 'attach' or 'block'"),
        ("github.json", True, "expected 'attach' or 'block'"),
        ("github.json", None, "expected 'attach' or 'block'"),
        # A finalizer signs or performs a handshake; it has nothing to attach.
        ("aws.json", "attach", "unknown field.*when_absent"),
        ("postgres.json", "attach", "unknown field.*when_absent"),
    ],
)
def test_load_rejects_a_when_absent_it_cannot_honour(tmp_path, filename, value, message):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        filename,
        lambda document: document["injection"].update({"when_absent": value}),
    )

    with pytest.raises(ConfigRegistryError, match=message):
        ConfigRegistry.load(root)


# How a packaged service's calls are classified


def test_graphql_endpoints_are_classed_as_updates_by_their_own_service():
    classes = {
        service_type: service["operation_classes"]
        for service_type, service in REGISTRY.services.items()
        if "operation_classes" in service
    }

    # Reads and writes share one endpoint on these three.
    assert set(classes) == {"github", "gitlab", "railway"}
    assert classes["github"] == [
        {"match": {"methods": ["POST"], "path": "/graphql"}, "class": "update"},
        {"match": {"methods": ["POST"], "path": "/api/graphql"}, "class": "update"},
    ]
    assert classes["gitlab"] == [
        {"match": {"methods": ["POST"], "path": "/api/graphql"}, "class": "update"},
        {"match": {"methods": ["POST"], "path": "/*/api/graphql"}, "class": "update"},
    ]
    assert classes["railway"] == [
        {"match": {"methods": ["POST"], "path": "/graphql/*"}, "class": "update"}
    ]


def test_packaged_operation_classes_are_stored_as_they_are_written(tmp_path):
    root = _copied_registry(tmp_path)
    classes = [
        {"match": {"methods": ["POST"], "path": "/v1/search"}, "class": "read"},
        {"match": {"path": "/v1/admin/*"}, "class": "admin"},
    ]
    _rewrite(
        root, "vercel.json", lambda document: document.update({"operation_classes": classes})
    )

    loaded = ConfigRegistry.load(root)

    assert loaded.get_service("vercel")["operation_classes"] == classes
    assert "operation_classes" not in loaded.get_service("render")


@pytest.mark.parametrize(
    ("filename", "classes", "message"),
    [
        # Validated exactly as a custom definition's are.
        ("vercel.json", {"class": "read"}, "expected a list"),
        ("vercel.json", [{"class": "read"}], "a match and a class"),
        (
            "vercel.json",
            [{"match": {"path": "/x"}, "class": "credential_minting"}],
            "secret guard",
        ),
        ("vercel.json", [{"match": {"path": "/x"}, "class": "write"}], "expected one of read"),
        ("vercel.json", [{"match": {"path": "x"}, "class": "read"}], "must begin with '/'"),
        (
            "vercel.json",
            [{"match": {"methods": ["post"]}, "class": "read"}],
            "upper-case",
        ),
        (
            "vercel.json",
            [{"match": {"path": "/x"}, "class": "read", "effect": "allow"}],
            "unknown field",
        ),
        ("vercel.json", [{"match": {"path": "/x"}, "class": "read"}] * 51, "at most 50"),
        # Only an HTTP call has a method and a path to classify.
        (
            "postgres.json",
            [{"match": {"path": "/x"}, "class": "read"}],
            "only valid for HTTP services",
        ),
    ],
)
def test_load_rejects_malformed_packaged_operation_classes(
    tmp_path, filename, classes, message
):
    root = _copied_registry(tmp_path)
    _rewrite(
        root, filename, lambda document: document.update({"operation_classes": classes})
    )

    with pytest.raises(ConfigRegistryError, match=message):
        ConfigRegistry.load(root)


# Hosts a Connection takes from its credential


def test_a_credential_endpoint_service_lists_public_hosts_and_holds_each_connections_own():
    for service_type, public in (
        ("github", [{"match": "exact", "value": "api.github.com", "port": 443}]),
        (
            "gitlab",
            [{"match": "exact", "value": "gitlab.com", "port": 443, "path": "/api/*"}],
        ),
    ):
        service = REGISTRY.get_service(service_type)
        assert service["host_rules_mode"] == "credential_endpoint"
        assert service["hosts"] == public
        own = [{"match": "exact", "value": "code.example.com", "port": 443, "path": "/api/*"}]
        assert REGISTRY.resolve_host_rules(service_type, {"hosts": own}) == own
        # A Connection always carries its own hosts, derived from its credential.
        with pytest.raises(ConfigRegistryError, match="missing required config field"):
            REGISTRY.validate_service_config(service_type, {})


def test_hosts_taken_from_a_credential_need_no_second_approval():
    from api.utils.agent_config import host_rules_require_independent_approval

    own = {"hosts": [{"match": "exact", "value": "code.example.com", "port": 443}]}

    # A member's override of a service's hosts does; the credential's own
    # endpoint is not an override.
    assert host_rules_require_independent_approval(REGISTRY.get_service("aws"), own)
    assert not host_rules_require_independent_approval(REGISTRY.get_service("github"), own)
    assert not host_rules_require_independent_approval(REGISTRY.get_service("gitlab"), own)


def test_a_token_provider_never_takes_hosts_from_a_member():
    """A header token is sent to whatever host a Connection names, so only the
    service or the token's own credential may name one."""

    own = {"hosts": [{"match": "exact", "value": "code.example.com", "port": 443}]}
    modes = {
        service_type: service["host_rules_mode"]
        for service_type, service in REGISTRY.services.items()
        if service["injection"]["action"] == "set_header"
    }

    assert modes == {
        "github": "credential_endpoint",
        "gitlab": "credential_endpoint",
        "cloudflare": "fixed",
        "vercel": "fixed",
        "render": "fixed",
        "railway": "fixed",
        "supabase": "fixed",
    }
    for service_type, mode in modes.items():
        if mode != "fixed":
            continue
        assert REGISTRY.get_service(service_type)["config_schema"] == []
        assert REGISTRY.validate_service_config(service_type, {}) == {}
        with pytest.raises(ConfigRegistryError, match="unknown config field"):
            REGISTRY.validate_service_config(service_type, own)
        assert REGISTRY.resolve_host_rules(service_type, {}) == (
            REGISTRY.get_service(service_type)["hosts"]
        )


def test_every_packaged_decoy_format_renders_with_its_prefix():
    from api.utils.agent_sessions import render_decoy_format

    prefixes = {
        "github": "ghp_",
        "gitlab": "glpat-",
        "render": "rnd_",
        "supabase": "sbp_",
        "cloudflare": "",
        "vercel": "",
        "railway": "",
    }
    for service_type, prefix in prefixes.items():
        decoy_format = REGISTRY.get_service(service_type)["decoy_format"]["token"]
        first, second = render_decoy_format(decoy_format), render_decoy_format(decoy_format)
        assert first.startswith(prefix) and first != second, service_type
        assert decoy_format.startswith(prefix + "{rand:"), service_type


# More than one form a request may present a credential in


def test_only_github_accepts_a_second_form_of_its_header():
    formats = {
        service_type: service["injection"]["value_formats"]
        for service_type, service in REGISTRY.services.items()
        if "value_formats" in service["injection"]
    }

    # The GitHub CLI sends its token under the "token" scheme.
    assert formats == {"github": ["token {value}"]}
    assert REGISTRY.get_service("github")["injection"]["value_format"] == (
        "Bearer {value}"
    )
    # Carried to a client as it is written.
    assert REGISTRY.as_dict()["services"]["github"]["injection"]["value_formats"] == [
        "token {value}"
    ]


def _set_injection(document, **members):
    """Replace a definition's injection, keeping where its value comes from."""

    document["injection"] = {
        "value_from": {"source": "credential", "field": "token"},
        **members,
    }


@pytest.mark.parametrize(
    "injection",
    [
        {"action": "set_header", "name": "Authorization", "value_format": "Bearer {value}"},
        {"action": "replace_header", "name": "X-Api-Key", "value_format": "{value}"},
        {"action": "set_param", "name": "access_token", "value_format": "{value}"},
    ],
)
@pytest.mark.parametrize(
    "formats",
    [
        ["token {value}"],
        ["token {value}", "Token {value}", "bearer {value}", "Basic {value}"],
        ["{value}:x-oauth-basic"],
        ["x" * 121 + "{value}"],
    ],
)
def test_a_header_or_parameter_injection_takes_up_to_four_other_formats(
    tmp_path, injection, formats
):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "vercel.json",
        lambda document: _set_injection(document, **injection, value_formats=formats),
    )

    loaded = ConfigRegistry.load(root).get_service("vercel")["injection"]

    assert loaded["value_formats"] == formats
    assert loaded["value_format"] == injection["value_format"]


@pytest.mark.parametrize(
    ("formats", "message"),
    [
        ("token {value}", "expected a list"),
        ({"token": "{value}"}, "expected a list"),
        (None, "expected a list"),
        ([], "expected 1 to 4 formats"),
        (
            ["a {value}", "b {value}", "c {value}", "d {value}", "e {value}"],
            "expected 1 to 4 formats",
        ),
        # Never the format the injection already has, nor the same one twice.
        (["Bearer {value}"], "repeats value_format or another entry"),
        (["token {value}", "token {value}"], "repeats value_format or another entry"),
        (["token {value}", "Bearer {value}"], "repeats value_format or another entry"),
        # Each is held to what value_format is held to.
        (["token"], "exactly one '{value}' placeholder"),
        ([""], "exactly one '{value}' placeholder"),
        (["{value} {value}"], "exactly one '{value}' placeholder"),
        (["token {token}"], "exactly one '{value}' placeholder"),
        (["token {}"], "exactly one '{value}' placeholder"),
        (["token {value!r}"], "format specs and conversions"),
        (["token {value:>40}"], "format specs and conversions"),
        (["token {value"], "invalid value format"),
        (["token {value}\r\nX-Injected: 1"], "without control characters"),
        (["token\x00 {value}"], "without control characters"),
        (["x" * 122 + "{value}"], "at most 128 characters"),
        ([["token {value}"]], "expected a string"),
        ([7], "expected a string"),
        (["token {value}", None], "expected a string"),
    ],
)
def test_load_rejects_malformed_value_formats(tmp_path, formats, message):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "github.json",
        lambda document: document["injection"].update({"value_formats": formats}),
    )

    with pytest.raises(ConfigRegistryError, match=message):
        ConfigRegistry.load(root)


@pytest.mark.parametrize(
    "value_format",
    ["Bearer {value}\n", "Bearer\t{value}", "x" * 122 + "{value}"],
)
def test_value_format_itself_is_held_to_the_same_limits(tmp_path, value_format):
    root = _copied_registry(tmp_path)
    _rewrite(
        root,
        "vercel.json",
        lambda document: document["injection"].update({"value_format": value_format}),
    )

    with pytest.raises(
        ConfigRegistryError, match="at most 128 characters without control characters"
    ):
        ConfigRegistry.load(root)


@pytest.mark.parametrize(
    ("filename", "mutation"),
    [
        # A finalizer signs or performs a handshake: it has no format at all.
        (
            "aws.json",
            lambda document: document["injection"].update(
                {"value_formats": ["token {value}"]}
            ),
        ),
        (
            "postgres.json",
            lambda document: document["injection"].update(
                {"value_formats": ["token {value}"]}
            ),
        ),
        # The other request edits rewrite one place in one form.
        (
            "vercel.json",
            lambda document: _set_injection(
                document,
                action="set_path",
                value_format="/{value}",
                value_formats=["/v2/{value}"],
            ),
        ),
        (
            "vercel.json",
            lambda document: _set_injection(
                document,
                action="replace_path_regex",
                pattern="/bot[^/]+/",
                value_format="/bot{value}/",
                value_formats=["/Bot{value}/"],
            ),
        ),
        (
            "vercel.json",
            lambda document: document.update(
                {
                    "injection": {
                        "action": "remove_header",
                        "name": "Authorization",
                        "value_from": {"source": "none"},
                        "value_formats": ["token {value}"],
                    }
                }
            ),
        ),
    ],
)
def test_load_rejects_value_formats_on_any_other_action(tmp_path, filename, mutation):
    root = _copied_registry(tmp_path)
    _rewrite(root, filename, mutation)

    with pytest.raises(ConfigRegistryError, match="unknown field.*value_formats"):
        ConfigRegistry.load(root)
