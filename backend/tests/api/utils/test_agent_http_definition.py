"""Definitions of custom HTTP Connections: validation, upgrade and compilation."""

from copy import deepcopy
import re
from types import SimpleNamespace

import pytest

from api.utils.agent_config import get_config_registry, http_definition
from api.utils.agent_config.http_definition import (
    DefinitionError,
    agent_visible_texts,
    bound_hosts,
    compile_injections,
    compile_service,
    service_for_connection,
    upgrade_definition,
    validate_definition,
)
from api.utils.agent_sessions import render_decoy_format


_TOKEN, _PASSWORD, _USERNAME = 0, 1, 2
_HEADER, _QUERY, _BASIC = 0, 1, 2


def _definition():
    return {
        "specVersion": 1,
        "hosts": [
            {"match": "exact", "value": "api.example.com", "port": 443, "path": "/v1/*"}
        ],
        "fields": [
            {
                "name": "token",
                "kind": "secret",
                "source": {"type": "sealed"},
                "env": "EXAMPLE_API_KEY",
                "decoyPrefix": "sk-",
            },
            {"name": "password", "kind": "secret", "source": {"type": "sealed"}},
            {"name": "username", "kind": "identifier", "value": "alice"},
        ],
        "injections": [
            {
                "type": "header",
                "name": "X-Api-Key",
                "prefix": "Bearer ",
                "field": "token",
                "whenAbsent": "attach",
            },
            {"type": "query", "name": "api_key", "field": "token", "whenAbsent": "block"},
            {"type": "basic", "usernameField": "username", "field": "password"},
        ],
        "preset": "headers",
    }


def _edit(path, value):
    """The valid definition with one member replaced, or removed when value is ...."""

    edited = _definition()
    target = edited
    for step in path[:-1]:
        target = target[step]
    if value is ...:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return edited


def _with_injection(injection):
    edited = _definition()
    edited["injections"].append(injection)
    return edited


def _refused(candidate, message):
    with pytest.raises(DefinitionError, match=message):
        validate_definition(candidate)


def test_a_valid_definition_is_returned_canonical():
    checked = validate_definition(_definition())

    assert checked["specVersion"] == 1
    assert checked["hosts"] == _definition()["hosts"]
    assert checked["fields"] == _definition()["fields"]
    assert checked["preset"] == "headers"
    # The default is written out, so a stored definition says what it does.
    assert [item["whenAbsent"] for item in checked["injections"]] == [
        "attach",
        "block",
        "attach",
    ]
    assert validate_definition(checked) == checked


def test_optional_members_stay_absent_when_not_given():
    minimal = _definition()
    minimal["hosts"] = [{"match": "suffix", "value": ".example.com"}]
    minimal["fields"][_TOKEN] = {
        "name": "token",
        "kind": "secret",
        "source": {"type": "sealed"},
        "decoyPrefix": "",
    }
    minimal["injections"][_HEADER]["prefix"] = ""
    del minimal["preset"]

    checked = validate_definition(minimal)

    assert checked["hosts"] == [{"match": "suffix", "value": ".example.com"}]
    assert checked["fields"][_TOKEN] == {
        "name": "token",
        "kind": "secret",
        "source": {"type": "sealed"},
    }
    assert "prefix" not in checked["injections"][_HEADER]
    assert "preset" not in checked


@pytest.mark.parametrize("version", [..., 0, 2, "1", True, 1.5, None])
def test_an_unknown_spec_version_is_refused(version):
    _refused(_edit(("specVersion",), version), "specVersion")


@pytest.mark.parametrize(
    "path",
    [
        ("secret",),
        ("hosts", 0, "scheme"),
        ("fields", _TOKEN, "label"),
        ("fields", _TOKEN, "source", "ref"),
        ("fields", _USERNAME, "decoyPrefix"),
        ("injections", _HEADER, "valueFormat"),
        ("injections", _QUERY, "prefix"),
        ("injections", _BASIC, "name"),
    ],
)
def test_unknown_keys_are_refused(path):
    _refused(_edit(path, "x"), "unknown field")


@pytest.mark.parametrize("candidate", [None, [], "definition", 3])
def test_a_definition_must_be_an_object(candidate):
    _refused(candidate, "expected an object")


@pytest.mark.parametrize("missing", ["hosts", "fields", "injections"])
def test_required_sections_must_be_present(missing):
    _refused(_edit((missing,), ...), "missing required")


def test_host_count_is_bounded():
    many = [
        {"match": "exact", "value": f"h{index}.example.com"} for index in range(21)
    ]

    _refused(_edit(("hosts",), []), "1 to 20")
    _refused(_edit(("hosts",), many), "1 to 20")
    assert len(validate_definition(_edit(("hosts",), many[:20]))["hosts"]) == 20


@pytest.mark.parametrize(
    "rule,message",
    [
        ({"match": "suffix", "value": ".com"}, "top-level"),
        ({"match": "suffix", "value": "example.com"}, "begin with"),
        ({"match": "exact", "value": "API.example.com"}, "lower-case"),
        ({"match": "exact", "value": "api.example.com."}, "trailing dot"),
        ({"match": "exact", "value": "https://api.example.com"}, "scheme"),
        ({"match": "glob", "value": "api.example.com"}, "exact"),
        ({"match": "exact", "value": "api.example.com", "port": 0}, "port"),
        ({"match": "exact", "value": "api.example.com", "path": "v1"}, "begin with"),
        ({"match": "exact", "value": "api.example.com", "path": "/a\nb"}, "control"),
        (
            {"match": "exact", "value": "api.example.com", "path": "/" + "a" * 1024},
            "at most",
        ),
    ],
)
def test_host_rules_follow_the_existing_host_validation(rule, message):
    _refused(_edit(("hosts",), [rule]), message)


def test_several_paths_on_one_host_are_several_rules_but_not_duplicates():
    rule = {"match": "exact", "value": "api.example.com", "port": 443}
    paths = [{**rule, "path": "/v1/*"}, {**rule, "path": "/v2/*"}]

    assert validate_definition(_edit(("hosts",), paths))["hosts"] == paths
    _refused(_edit(("hosts",), [paths[0], paths[0]]), "duplicate host rule")


def test_field_count_is_bounded():
    eleven = _definition()["fields"] + [
        {"name": f"extra{index}", "kind": "identifier", "value": "v"}
        for index in range(8)
    ]

    _refused(_edit(("fields",), []), "1 to 10")
    _refused(_edit(("fields",), eleven), "1 to 10")
    assert len(validate_definition(_edit(("fields",), eleven[:10]))["fields"]) == 10


@pytest.mark.parametrize(
    "name", ["Token", "api_key", "1token", "", "a" * 33, "tok-en", "tökén", 7]
)
def test_field_names_survive_any_key_case_conversion(name):
    _refused(_edit(("fields", _TOKEN, "name"), name), "name")


def test_field_names_are_unique():
    _refused(_edit(("fields", _PASSWORD, "name"), "token"), "duplicate field")


def test_field_kind_is_secret_or_identifier():
    _refused(_edit(("fields", _TOKEN, "kind"), "password"), "kind")


def test_a_secret_field_never_carries_a_value():
    _refused(
        _edit(("fields", _TOKEN, "value"), "real-secret"), "never carries a value"
    )


@pytest.mark.parametrize(
    "source", [..., None, "sealed", {}, {"type": "app"}, {"type": "sealed", "id": "x"}]
)
def test_a_secret_field_names_a_known_source(source):
    _refused(_edit(("fields", _TOKEN, "source"), source), "source")


@pytest.mark.parametrize("value", [..., "", 7, "a" * 257, "line\nbreak", "nul\x00"])
def test_an_identifier_needs_a_short_printable_value(value):
    _refused(_edit(("fields", _USERNAME, "value"), value), "value")


@pytest.mark.parametrize(
    "name",
    [
        "example_key",
        "1KEY",
        "A" * 65,
        "PHASE_TOKEN",
        "PATH",
        "HOME",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "GIT_SSH_COMMAND",
        "NODE_OPTIONS",
        "HTTPS_PROXY",
        "NO_PROXY",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "AWS_ACCESS_KEY_ID",
        "AWS_PROFILE",
        "PGPASSWORD",
        "DATABASE_URL",
        # The runtime's key-case conversion would rewrite this one in transit.
        "API_2_KEY",
    ],
)
def test_reserved_or_malformed_environment_names_are_refused(name):
    _refused(_edit(("fields", _TOKEN, "env"), name), "env")
    _refused(_edit(("fields", _USERNAME, "env"), name), "env")


def test_environment_names_are_unique_across_fields():
    _refused(
        _edit(("fields", _USERNAME, "env"), "EXAMPLE_API_KEY"),
        "duplicate environment",
    )
    checked = validate_definition(_edit(("fields", _USERNAME, "env"), "EXAMPLE_USER"))
    assert checked["fields"][_USERNAME]["env"] == "EXAMPLE_USER"


@pytest.mark.parametrize("prefix", ["sk live", "a" * 17, "sk.", "{x}", 5])
def test_decoy_prefixes_are_short_and_plain(prefix):
    _refused(_edit(("fields", _TOKEN, "decoyPrefix"), prefix), "decoyPrefix")


def test_injection_count_is_bounded():
    eleven = _definition()["injections"] + [
        {"type": "query", "name": f"k{index}", "field": "token"} for index in range(8)
    ]

    _refused(_edit(("injections",), []), "1 to 10")
    _refused(_edit(("injections",), eleven), "1 to 10")
    assert (
        len(validate_definition(_edit(("injections",), eleven[:10]))["injections"])
        == 10
    )


def test_injection_type_is_known():
    _refused(_edit(("injections", _HEADER, "type"), "cookie"), "type")


@pytest.mark.parametrize(
    "name",
    [
        "Host",
        "content-length",
        "Transfer-Encoding",
        "CONNECTION",
        "Proxy-Authorization",
        "proxy-connection",
        "Upgrade",
        "TE",
        "Trailer",
        "X Api Key",
        "X-Api-Key:",
        "X-Api\r\nKey",
        "",
        "A" * 129,
    ],
)
def test_header_names_are_tokens_and_never_hop_by_hop(name):
    _refused(_edit(("injections", _HEADER, "name"), name), "name")


@pytest.mark.parametrize(
    "prefix", ["Bearer\r\n", "a" * 65, "Bearer {value}", "tab\there", 3]
)
def test_header_prefixes_cannot_break_the_header_or_its_format(prefix):
    _refused(_edit(("injections", _HEADER, "prefix"), prefix), "prefix")


@pytest.mark.parametrize("name", ["a&b", "a=b", "a\x00b", "", "k" * 129])
def test_query_parameter_names_are_safe(name):
    _refused(_edit(("injections", _QUERY, "name"), name), "name")


def test_injections_point_at_fields_of_the_right_kind():
    _refused(_edit(("injections", _HEADER, "field"), "username"), "a secret field")
    _refused(_edit(("injections", _HEADER, "field"), "missing"), "a secret field")
    _refused(_edit(("injections", _BASIC, "field"), "username"), "a secret field")
    _refused(
        _edit(("injections", _BASIC, "usernameField"), "token"),
        "an identifier field",
    )


@pytest.mark.parametrize(
    "injection",
    [
        # Header names compare without regard to case.
        {"type": "header", "name": "x-api-key", "field": "password"},
        # Basic authentication writes the Authorization header.
        {"type": "header", "name": "Authorization", "field": "token"},
        {"type": "basic", "usernameField": "username", "field": "token"},
        {"type": "query", "name": "api_key", "field": "password"},
    ],
)
def test_two_injections_cannot_write_the_same_place(injection):
    _refused(_with_injection(injection), "already written")


def test_every_secret_field_is_used_by_an_injection():
    unused = _definition()
    del unused["injections"][_BASIC]

    _refused(unused, "not used by any injection: password")


@pytest.mark.parametrize("mode", ["skip", "", None, True])
def test_when_absent_is_attach_or_block(mode):
    _refused(_edit(("injections", _BASIC, "whenAbsent"), mode), "whenAbsent")


def test_preset_is_one_of_the_known_hints():
    _refused(_edit(("preset",), "oauth"), "preset")
    for preset in ("bearer", "basic", "headers", "query"):
        assert validate_definition(_edit(("preset",), preset))["preset"] == preset


@pytest.mark.parametrize("value", [0, 1, "true", None, []])
def test_allow_plain_http_is_a_boolean(value):
    _refused(_edit(("allowPlainHttp",), value), "allowPlainHttp")


def test_plain_http_is_off_unless_the_definition_turns_it_on():
    default = validate_definition(_definition())
    explicit = validate_definition(_edit(("allowPlainHttp",), False))
    allowed = validate_definition(_edit(("allowPlainHttp",), True))

    # The default has one stored spelling, so two definitions that mean the
    # same compare equal.
    assert "allowPlainHttp" not in default
    assert explicit == default
    assert allowed["allowPlainHttp"] is True
    assert compile_service(default)["allow_plain_http"] is False
    assert compile_service(allowed)["allow_plain_http"] is True


def test_the_text_an_agent_can_read_is_listed_for_leak_checks():
    assert agent_visible_texts(validate_definition(_definition())) == [
        ("the decoy prefix of token", "sk-"),
        ("the value of username", "alice"),
        ("the prefix of the X-Api-Key header", "Bearer "),
    ]


def test_a_reader_upgrades_an_old_definition_without_changing_it(monkeypatch):
    def to_version_two(old):
        return {**old, "specVersion": 2}

    stored = validate_definition(_definition())
    snapshot = deepcopy(stored)
    monkeypatch.setattr(http_definition, "LATEST_SPEC_VERSION", 2)
    monkeypatch.setattr(http_definition, "_UPGRADES", {1: to_version_two})

    upgraded = upgrade_definition(stored)

    assert upgraded["specVersion"] == 2
    assert stored == snapshot
    # A write stores the latest version, whichever version it was given.
    assert validate_definition(stored)["specVersion"] == 2
    assert validate_definition(upgraded)["specVersion"] == 2
    with pytest.raises(DefinitionError, match="specVersion"):
        upgrade_definition({**stored, "specVersion": 3})


def test_injections_compile_to_the_wire_list():
    assert compile_injections(validate_definition(_definition())) == [
        {
            "action": "set_header",
            "name": "X-Api-Key",
            "value_format": "Bearer {value}",
            "value_from": {"source": "credential", "field": "token"},
            "when_absent": "attach",
        },
        {
            "action": "set_param",
            "name": "api_key",
            "value_format": "{value}",
            "value_from": {"source": "credential", "field": "token"},
            "when_absent": "block",
        },
        {
            "action": "basic_auth",
            "name": "Authorization",
            "value_from": {
                "source": "credential",
                "fields": {"username": "username", "password": "password"},
            },
            "when_absent": "attach",
        },
    ]


def test_a_definition_compiles_to_the_shape_of_a_packaged_service():
    service = compile_service(validate_definition(_definition()))

    for packaged in get_config_registry().services.values():
        assert set(packaged) <= set(service)
    assert service["service_type"] == "http"
    assert service["protocol"] == "http"
    assert service["host_rules_mode"] == "required_endpoint"
    assert service["on_refresh"] == "none"
    assert service["injection"] == service["injections"][0]
    assert service["fields"] == {
        "token": {"class": "secret", "delivery": "decoy"},
        "password": {"class": "secret", "delivery": "decoy"},
        "username": {"class": "identifier", "delivery": "real"},
    }
    assert service["identifier_values"] == {"username": "alice"}
    assert service["environment_bindings"] == [
        {
            "name": "EXAMPLE_API_KEY",
            "action": "set",
            "source": "decoy",
            "source_field": "token",
            "sensitive": True,
            "system_managed": True,
        }
    ]
    assert service["required_features"] == ["injection_list", "when_absent"]
    assert "{{ username }}" in service["context_template"]
    assert "api.example.com:443/v1/*" in service["context_template"]


def test_decoys_keep_their_prefix_and_carry_enough_randomness():
    service = compile_service(validate_definition(_definition()))

    assert set(service["decoy_format"]) == {"token", "password"}
    token = render_decoy_format(service["decoy_format"]["token"])
    password = render_decoy_format(service["decoy_format"]["password"])
    assert re.fullmatch(r"sk-[A-Za-z0-9]{32}", token)
    assert re.fullmatch(r"[A-Za-z0-9]{32}", password)
    assert token != render_decoy_format(service["decoy_format"]["token"])


def test_bound_hosts_drop_paths_and_are_deduplicated_and_sorted():
    hosts = [
        {"match": "suffix", "value": ".example.org"},
        {"match": "exact", "value": "b.example.com", "port": 8443, "path": "/v1/*"},
        {"match": "exact", "value": "b.example.com", "port": 8443, "path": "/v2/*"},
        {"match": "exact", "value": "b.example.com", "port": 443},
        {"match": "exact", "value": "a.example.com"},
    ]

    assert bound_hosts(validate_definition(_edit(("hosts",), hosts))) == [
        {"match": "suffix", "value": ".example.org"},
        {"match": "exact", "value": "a.example.com"},
        {"match": "exact", "value": "b.example.com", "port": 443},
        {"match": "exact", "value": "b.example.com", "port": 8443},
    ]


def test_packaged_connections_still_resolve_through_the_registry():
    for service_type in ("aws", "postgres"):
        connection = SimpleNamespace(service_type=service_type, config={})
        assert service_for_connection(connection) == get_config_registry().get_service(
            service_type
        )
    with pytest.raises(DefinitionError):
        service_for_connection(SimpleNamespace(service_type="http", config={}))


_LOADING_NAMES = [
    "BASH_ENV", "ENV", "ZDOTDIR", "PROMPT_COMMAND", "IFS", "EDITOR", "VISUAL",
    "PAGER", "BROWSER", "KUBECONFIG", "DOCKER_HOST", "DOCKER_CONFIG",
    "SSH_AUTH_SOCK", "SSH_ASKPASS", "XDG_CONFIG_HOME", "CLASSPATH",
    "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "MAVEN_OPTS",
    "GRADLE_OPTS", "RUBYOPT", "RUBYLIB", "PERL5OPT", "PERL5LIB", "NODE_PATH",
    "NODE_TLS_REJECT_UNAUTHORIZED", "GOFLAGS", "GOPROXY", "GOPATH", "GOPRIVATE",
    "GOINSECURE", "GONOSUMDB", "PYTHONSTARTUP", "PYTHONHOME", "NPM_CONFIG_REGISTRY",
    "PIP_INDEX", "UV_INDEX",
]


# _JAVA_OPTIONS is reserved too, though a name must begin with a letter anyway.
@pytest.mark.parametrize("name", _LOADING_NAMES)
def test_variables_that_make_a_process_load_code_are_reserved_for_both_kinds(name):
    _refused(_edit(("fields", _TOKEN, "env"), name), f"{name}.*reserved")
    _refused(_edit(("fields", _USERNAME, "env"), name), f"{name}.*reserved")


@pytest.mark.parametrize(
    "name",
    [
        "EXAMPLE_API_URL", "EXAMPLE_URI", "EXAMPLE_BASE", "EXAMPLE_ENDPOINT",
        "EXAMPLE_HOST", "EXAMPLE_PROXY", "EXAMPLE_REGISTRY", "EXAMPLE_OPTIONS",
        "EXAMPLE_OPTS", "EXAMPLE_PATH", "EXAMPLE_HOME", "EXAMPLE_CONFIG",
        "EXAMPLE_FLAGS",
    ],
)
def test_an_identifier_cannot_be_exported_under_a_redirecting_name(name):
    _refused(
        _edit(("fields", _USERNAME, "env"), name),
        f"identifier cannot be exported under {name}.*redirects or configures tools",
    )
    # A secret exports a random placeholder, which redirects nothing.
    checked = validate_definition(_edit(("fields", _TOKEN, "env"), name))
    assert checked["fields"][_TOKEN]["env"] == name


def test_an_identifier_may_still_be_exported_under_a_plain_name():
    checked = validate_definition(_edit(("fields", _USERNAME, "env"), "EXAMPLE_USER"))
    assert checked["fields"][_USERNAME]["env"] == "EXAMPLE_USER"


@pytest.mark.parametrize("value", ["", " ", "\t  ", "    "])
def test_a_blank_identifier_value_is_refused(value):
    _refused(_edit(("fields", _USERNAME, "value"), value), "not blank")


@pytest.mark.parametrize("name", ["k\nx", "k\r", "k\x7f", "k\x1b[0m", "k\x85"])
def test_a_query_parameter_name_takes_no_control_characters(name):
    _refused(
        _with_injection({"type": "query", "name": name, "field": "password"}),
        "query parameter name.*control characters",
    )


@pytest.mark.parametrize(
    "path",
    [
        ("fields", _TOKEN, "kind"),
        ("fields", _TOKEN, "source", "type"),
        ("injections", _HEADER, "type"),
        ("injections", _HEADER, "whenAbsent"),
        ("preset",),
    ],
)
@pytest.mark.parametrize("value", [[], ["bearer"], {}, {"a": 1}])
def test_a_list_or_object_where_a_name_belongs_is_refused_not_a_server_error(
    path, value
):
    with pytest.raises(DefinitionError):
        validate_definition(_edit(path, value))
