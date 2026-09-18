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

    assert connectable == {"aws", "postgres"}
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
    assert capabilities["injectionActions"] == ["aws_sigv4", "pg_handshake"]
    assert capabilities["credentialProviders"] == [
        "aws",
        "aws_assume_role",
        "postgres",
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
            assert injection["value_format"] == "Bearer {value}", service_type
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
