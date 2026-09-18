from types import SimpleNamespace

import pytest

from api.utils.agent_config import get_config_registry
from api.views.agents.base import AgentRuntimeError
from api.views.agents.runtime import (
    negotiate_client,
    reject_duplicate_connections,
)


def _binding(
    service_type,
    *,
    connection_id,
    credential_id,
    host,
    port,
    match="exact",
    config=None,
):
    connection = SimpleNamespace(
        id=connection_id,
        config=config or {},
    )
    grant = SimpleNamespace(
        connection_id=connection_id,
        credential_id=credential_id,
        connection=connection,
    )
    return {
        "grant": grant,
        "service": get_config_registry().get_service(service_type),
        "hosts": [
            {
                "match": match,
                "value": host,
                "port": port,
            }
        ],
    }


def test_accepts_multiple_postgres_bindings():
    bindings = [
        _binding(
            "postgres",
            connection_id="pg-primary",
            credential_id="pg-primary-credential",
            host="primary-db.internal.example",
            port=5432,
        ),
        _binding(
            "postgres",
            connection_id="pg-analytics",
            credential_id="pg-analytics-credential",
            host="analytics-db.internal.example",
            port=5432,
        ),
    ]

    reject_duplicate_connections(bindings)


def test_accepts_overlapping_hosts_for_explicit_connection_selection():
    bindings = [
        _binding(
            "aws",
            connection_id="aws-default",
            credential_id="aws-default-credential",
            host="s3.us-east-1.amazonaws.com",
            port=443,
        ),
        _binding(
            "aws",
            connection_id="aws-suffix",
            credential_id="aws-suffix-credential",
            host="amazonaws.com",
            port=443,
            match="suffix",
        ),
    ]

    reject_duplicate_connections(bindings)


def test_accepts_per_connection_environment():
    bindings = [
        _binding(
            "aws",
            connection_id="aws-storage",
            credential_id="aws-storage-credential",
            host="s3.us-east-1.amazonaws.com",
            port=443,
        ),
        _binding(
            "aws",
            connection_id="aws-compute",
            credential_id="aws-compute-credential",
            host="ec2.us-east-1.amazonaws.com",
            port=443,
        ),
    ]

    reject_duplicate_connections(bindings)


def test_accepts_one_source_bound_to_two_connections():
    bindings = [
        _binding(
            "aws",
            connection_id="aws-storage",
            credential_id="shared-aws-credential",
            host="s3.us-east-1.amazonaws.com",
            port=443,
        ),
        _binding(
            "aws",
            connection_id="aws-compute",
            credential_id="shared-aws-credential",
            host="ec2.us-east-1.amazonaws.com",
            port=443,
        ),
    ]

    reject_duplicate_connections(bindings)


def test_duplicate_connection_ids_are_rejected():
    binding = _binding("aws", connection_id="same", credential_id="credential", host="s3.us-east-1.amazonaws.com", port=443)
    with pytest.raises(AgentRuntimeError, match="Duplicate Connection"):
        reject_duplicate_connections([binding, binding])


@pytest.mark.parametrize("empty_value", ["", "   "])
def test_required_credential_values_cannot_be_empty(empty_value, monkeypatch):
    from api.utils.agent_credentials import ResolvedCredential
    from api.views.agents.runtime import _connection_payload
    authentication = SimpleNamespace(
        id="credential",
        name="AWS credential",
        provider="aws",
        revision="revision",
        deleted_at=None,
    )
    agent = SimpleNamespace(ACTIVE="active", status="active", deleted_at=None)
    workflow = SimpleNamespace(agent=agent, deleted_at=None)
    connection = SimpleNamespace(
        id="connection",
        name="AWS connection",
        config={},
        authentication=authentication,
        authentication_id=authentication.id,
        state="active",
        deleted_at=None,
    )
    grant = SimpleNamespace(
        id="grant",
        connection=connection,
        connection_id=connection.id,
        workflow=workflow,
        deleted_at=None,
    )
    item = {
        "grant": grant,
        "service": get_config_registry().get_service("aws"),
        "hosts": [{"match": "suffix", "value": ".amazonaws.com"}],
    }
    monkeypatch.setattr("api.views.agents.runtime.resolve_agent_credential",
        lambda *args, **kwargs: ResolvedCredential(material={"access_key_id": "AKIA" + "B" * 16,
            "secret_access_key": empty_value}))
    with pytest.raises(AgentRuntimeError, match="missing required"):
        _connection_payload(item, SimpleNamespace())


def _client(**overrides):
    client = {
        "name": "phase-cli",
        "supportedSchemaVersions": [1],
        "protocols": ["http", "postgres"],
        "injectionActions": ["aws_sigv4", "pg_handshake", "set_header"],
    }
    client.update(overrides)
    return client


def _aws_grant():
    return _binding(
        "aws",
        connection_id="aws-1",
        credential_id="aws-credential",
        host="s3.us-east-1.amazonaws.com",
        port=443,
        match="suffix",
    )


def test_a_client_that_predates_source_negotiation_still_opens():
    """Every shipped binding source is in the schema-1 baseline."""

    negotiate_client(_client(), [_aws_grant(), _binding(
        "postgres",
        connection_id="pg-1",
        credential_id="pg-credential",
        host="db.internal.example",
        port=5432,
    )])


def test_a_source_added_after_schema_1_is_refused_at_open():
    grant = _aws_grant()
    grant["service"]["environment_bindings"].append(
        {
            "name": "PHASE_PROXY_URL",
            "action": "set",
            "source": "proxy",
            "sensitive": False,
            "system_managed": True,
        }
    )

    with pytest.raises(AgentRuntimeError) as failure:
        negotiate_client(_client(), [grant])

    assert failure.value.code == "client_capability_mismatch"
    assert failure.value.details["missingEnvironmentBindingSources"] == ["proxy"]
    # The other axes stay clean, so the error names only what is actually missing.
    assert failure.value.details["missingProtocols"] == []
    assert failure.value.details["missingInjectionActions"] == []


def test_a_client_that_advertises_the_new_source_opens():
    grant = _aws_grant()
    grant["service"]["environment_bindings"].append(
        {
            "name": "PHASE_PROXY_URL",
            "action": "set",
            "source": "proxy",
            "sensitive": False,
            "system_managed": True,
        }
    )

    negotiate_client(
        _client(
            environmentBindingSources=[
                "connection_config",
                "decoy",
                "identifier",
                "proxy",
                "runtime",
            ]
        ),
        [grant],
    )


def test_an_explicit_source_list_is_taken_at_face_value():
    """Advertising narrowly is honoured, not silently widened to the baseline."""

    with pytest.raises(AgentRuntimeError) as failure:
        negotiate_client(
            _client(environmentBindingSources=["identifier"]), [_aws_grant()]
        )

    assert failure.value.details["missingEnvironmentBindingSources"] == [
        "connection_config",
        "decoy",
        "runtime",
    ]
