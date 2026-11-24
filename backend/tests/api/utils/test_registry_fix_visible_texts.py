"""A secret is refused wherever a definition shows it to the Agent."""

import pytest

from api.utils.agent_config import validate_definition
from api.utils.agent_config.http_definition import agent_visible_texts
from api.utils.agent_connection_values import (
    SealedValueError,
    _refuse_agent_visible_secrets,
)


TOKEN = "tok_1234567890abcdefSECRET"
# A host name holds no upper case and no underscore.
HOST_TOKEN = "tok-1234567890abcdefsecret"


def _definition(**members):
    return {
        "specVersion": 1,
        "hosts": [{"match": "exact", "value": "api.example.com", "port": 443}],
        "fields": [{"name": "token", "kind": "secret", "source": {"type": "sealed"}}],
        "injections": [
            {
                "type": "header",
                "name": "Authorization",
                "prefix": "Bearer ",
                "field": "token",
            }
        ],
        **members,
    }


def test_every_text_of_a_definition_an_agent_reads_is_listed():
    definition = validate_definition(
        _definition(
            hosts=[
                {"match": "exact", "value": "api.example.com", "path": "/v1/*"},
                {"match": "suffix", "value": ".example.org"},
            ],
            injections=[
                {"type": "header", "name": "X-Api-Key", "field": "token"},
                {"type": "query", "name": "api_key", "field": "token"},
            ],
        )
    )

    assert agent_visible_texts(definition) == [
        ("a header name", "X-Api-Key"),
        ("a query parameter name", "api_key"),
        ("host 1", "api.example.com"),
        ("the path of host 1", "/v1/*"),
        ("host 2", ".example.org"),
    ]


@pytest.mark.parametrize(
    "secret,members,place",
    [
        (
            TOKEN,
            {
                "hosts": [
                    {
                        "match": "exact",
                        "value": "api.example.com",
                        "path": f"/bot{TOKEN}/*",
                    }
                ]
            },
            "the path of host 1",
        ),
        (
            HOST_TOKEN,
            {"hosts": [{"match": "exact", "value": f"{HOST_TOKEN}.example.com"}]},
            "host 1",
        ),
        (
            TOKEN,
            {"injections": [{"type": "header", "name": TOKEN, "field": "token"}]},
            "a header name",
        ),
        (
            TOKEN,
            {"injections": [{"type": "query", "name": TOKEN, "field": "token"}]},
            "a query parameter name",
        ),
    ],
)
def test_a_secret_is_refused_wherever_the_definition_shows_it(secret, members, place):
    definition = validate_definition(_definition(**members))

    with pytest.raises(SealedValueError) as refusal:
        _refuse_agent_visible_secrets({"token": secret}, definition)

    assert str(refusal.value) == (
        f"The secret for token also appears in {place}, which the Agent can read"
    )
    _refuse_agent_visible_secrets({"token": "another-secret-value"}, definition)
