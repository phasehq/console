"""AWS IAM access key rotation, and root credentials of either stored AWS type."""

import itertools
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    NoCredentialsError,
    ParamValidationError,
    PartialCredentialsError,
)
from graphql import GraphQLError

from api.services import Providers
from backend.graphene.queries import syncing as syncing_queries
from ee.integrations.secrets.providers import aws
from ee.integrations.secrets.providers.aws import (
    AWSProvider,
    _decode_provider_id,
    _encode_provider_id,
)
from ee.integrations.secrets.providers.base import CredentialProvider
from ee.integrations.secrets.providers.exceptions import (
    ProviderAuthError,
    ProviderConfigError,
    ProviderNotFound,
    ProviderTransientError,
)
from ee.integrations.secrets.providers.openai import OpenAIProvider
from ee.integrations.secrets.providers.sanitize import sanitize
from ee.integrations.secrets.rotation.graphene import mutations, queries
from ee.integrations.secrets.rotation.providers import (
    ROTATION_PROVIDERS,
    all_providers,
    get_provider,
)

_AWS = "ee.integrations.secrets.providers.aws"

ROOT_KEY_ID = "AKIAROOTROOTROOTROOT"
ROOT_SECRET = "root-secret-access-key"
ACCESS_KEY_CREDS = {
    "access_key_id": ROOT_KEY_ID,
    "secret_access_key": ROOT_SECRET,
    "region": "us-east-1",
}
ROLE_ARN = "arn:aws:iam::123456789012:role/phase-rotation"
ASSUME_ROLE_CREDS = {
    "role_arn": ROLE_ARN,
    "region": "eu-west-1",
    "external_id": "phase-external-id",
}
CONFIG = {"user_name": "deploy-bot"}

NEW_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
NEW_SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
CREATED_AT = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


def _client_error(code, operation="CreateAccessKey", status=400, message="boom"):
    return ClientError(
        {
            "Error": {"Code": code, "Message": message},
            "ResponseMetadata": {"HTTPStatusCode": status, "RequestId": "req-1"},
        },
        operation,
    )


def _create_access_key_response(**overrides):
    access_key = {
        "UserName": "deploy-bot",
        "AccessKeyId": NEW_KEY_ID,
        "Status": "Active",
        "SecretAccessKey": NEW_SECRET,
        "CreateDate": CREATED_AT,
    }
    access_key.update(overrides)
    return {
        "AccessKey": access_key,
        "ResponseMetadata": {"HTTPStatusCode": 200, "RequestId": "req-1"},
    }


@pytest.fixture
def aws_clients():
    """Replace the session builder; each service gets its own client mock."""
    session = MagicMock()
    clients = {"iam": MagicMock(name="iam"), "sts": MagicMock(name="sts")}
    session.client.side_effect = lambda service, **kwargs: clients[service]
    with patch(f"{_AWS}._session", return_value=session) as build_session:
        yield SimpleNamespace(session=session, build_session=build_session, **clients)


# ---------------------------------------------------------------------------
# Registry and schemas
# ---------------------------------------------------------------------------


def test_registry_returns_aws_provider():
    assert ROTATION_PROVIDERS["aws"] is AWSProvider
    assert get_provider("aws") is AWSProvider
    assert AWSProvider in all_providers()


def test_credential_schema_mirrors_stored_aws_credentials():
    assert [f.id for f in AWSProvider.credential_schema] == (
        Providers.AWS["expected_credentials"] + Providers.AWS["optional_credentials"]
    )
    assert {f.id for f in AWSProvider.credential_schema if f.required} == set(
        Providers.AWS["expected_credentials"]
    )
    assert {f.id for f in AWSProvider.credential_schema if f.masked} == {
        "secret_access_key"
    }


def test_config_and_output_schemas():
    (user_field,) = AWSProvider.config_schema
    assert (user_field.id, user_field.required, user_field.resource_type) == (
        "user_name",
        True,
        "iam_user",
    )
    assert [(f.id, f.masked) for f in AWSProvider.output_schema] == [
        ("access_key_id", False),
        ("secret_access_key", True),
    ]
    assert AWSProvider.key_name_prefix == "AWS"
    assert AWSProvider.credential_id_label == "IAM user:access key ID"


# ---------------------------------------------------------------------------
# Accepted credential types
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("credential_provider", "accepted"),
    [("aws", True), ("aws_assume_role", True), ("openai", False), ("", False)],
)
def test_aws_accepts_both_stored_aws_credential_types(credential_provider, accepted):
    assert AWSProvider.accepts_credentials(credential_provider) is accepted


def test_providers_accept_only_their_own_credentials_by_default():
    assert CredentialProvider.extra_credential_providers == ()
    assert OpenAIProvider.accepts_credentials("openai") is True
    assert OpenAIProvider.accepts_credentials("aws") is False
    assert AWSProvider.extra_credential_providers == (Providers.AWS_ASSUME_ROLE["id"],)


# ---------------------------------------------------------------------------
# validate_config and provider IDs
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "user_name", ["deploy-bot", "svc_ci+prod=1,team.a@example.com", "a" * 128]
)
def test_validate_config_accepts_iam_user_names(user_name):
    AWSProvider.validate_config({"user_name": user_name})


@pytest.mark.parametrize(
    "config",
    [
        {},
        {"user_name": ""},
        {"user_name": None},
        {"user_name": ["deploy-bot"]},
        {"user_name": "team:deploy-bot"},
        {"user_name": "deploy bot"},
        {"user_name": "déploy-bot"},
        {"user_name": "a" * 129},
    ],
)
def test_validate_config_rejects_missing_or_invalid_user_name(config):
    with pytest.raises(ProviderConfigError):
        AWSProvider.validate_config(config)


def test_provider_id_codec_roundtrip():
    encoded = _encode_provider_id("deploy-bot", NEW_KEY_ID)
    assert encoded == f"deploy-bot:{NEW_KEY_ID}"
    assert _decode_provider_id(encoded) == ("deploy-bot", NEW_KEY_ID)


@pytest.mark.parametrize(
    "provider_credential_id", ["", NEW_KEY_ID, f":{NEW_KEY_ID}", "deploy-bot:"]
)
def test_provider_id_decode_rejects_malformed(provider_credential_id):
    with pytest.raises(ProviderConfigError):
        _decode_provider_id(provider_credential_id)


# ---------------------------------------------------------------------------
# Session building
# ---------------------------------------------------------------------------


def test_session_uses_stored_access_keys():
    with patch(f"{_AWS}.boto3.Session") as session_cls, patch(
        f"{_AWS}.get_aws_sts_session"
    ) as sts_session:
        assert aws._session(ACCESS_KEY_CREDS) is session_cls.return_value

    session_cls.assert_called_once_with(
        aws_access_key_id=ROOT_KEY_ID,
        aws_secret_access_key=ROOT_SECRET,
        region_name="us-east-1",
    )
    sts_session.assert_not_called()


def test_session_assumes_the_stored_role():
    with patch(f"{_AWS}.boto3.Session") as session_cls, patch(
        f"{_AWS}.get_aws_sts_session"
    ) as sts_session:
        assert aws._session(ASSUME_ROLE_CREDS) is sts_session.return_value

    sts_session.assert_called_once_with(ROLE_ARN, "eu-west-1", "phase-external-id")
    session_cls.assert_not_called()


def test_session_passes_blank_region_and_external_id_as_none():
    with patch(f"{_AWS}.get_aws_sts_session") as sts_session:
        aws._session({"role_arn": ROLE_ARN, "region": "", "external_id": ""})

    sts_session.assert_called_once_with(ROLE_ARN, None, None)


@pytest.mark.parametrize(
    "error",
    [
        _client_error("AccessDenied", "AssumeRole", 403),
        _client_error("ValidationError", "AssumeRole"),
        _client_error("RegionDisabledException", "AssumeRole", 403),
        NoCredentialsError(),
        ParamValidationError(report="Invalid length for parameter RoleArn"),
    ],
)
def test_session_assume_role_failures_are_auth_errors(error):
    with patch(f"{_AWS}.get_aws_sts_session", side_effect=error):
        with pytest.raises(ProviderAuthError):
            aws._session(ASSUME_ROLE_CREDS)


@pytest.mark.parametrize(
    "error",
    [
        _client_error("Throttling", "AssumeRole"),
        EndpointConnectionError(endpoint_url="https://sts.eu-west-1.amazonaws.com/"),
    ],
)
def test_session_assume_role_outages_are_transient(error):
    with patch(f"{_AWS}.get_aws_sts_session", side_effect=error):
        with pytest.raises(ProviderTransientError):
            aws._session(ASSUME_ROLE_CREDS)


def test_session_requires_a_role_or_access_key_pair():
    with pytest.raises(ProviderAuthError):
        aws._session({"access_key_id": ROOT_KEY_ID, "region": "us-east-1"})


# ---------------------------------------------------------------------------
# mint
# ---------------------------------------------------------------------------


def test_mint_creates_an_access_key_for_the_configured_user(aws_clients):
    aws_clients.iam.create_access_key.return_value = _create_access_key_response()

    result = AWSProvider.mint(ACCESS_KEY_CREDS, CONFIG, caller_id="rs-1")

    aws_clients.build_session.assert_called_once_with(ACCESS_KEY_CREDS)
    aws_clients.session.client.assert_called_once_with("iam", config=aws._BOTO_CONFIG)
    aws_clients.iam.create_access_key.assert_called_once_with(UserName="deploy-bot")
    assert result.provider_credential_id == f"deploy-bot:{NEW_KEY_ID}"
    assert result.values == {
        "access_key_id": NEW_KEY_ID,
        "secret_access_key": NEW_SECRET,
    }
    assert list(result.values) == [f.id for f in AWSProvider.output_schema]
    assert result.metadata == {
        "user_name": "deploy-bot",
        "status": "Active",
        "create_date": "2026-10-22T12:00:00+00:00",
    }


def test_mint_metadata_holds_no_secret_values(aws_clients):
    aws_clients.iam.create_access_key.return_value = _create_access_key_response()

    result = AWSProvider.mint(ACCESS_KEY_CREDS, CONFIG, caller_id="rs-1")

    for value in (NEW_SECRET, NEW_KEY_ID, ROOT_SECRET, ROOT_KEY_ID):
        assert value not in repr(result.metadata)
    # Neutral key names, so the engine's sanitizer keeps every field.
    assert sanitize(result.metadata) == result.metadata


def test_mint_uses_the_canonical_user_name_from_aws(aws_clients):
    aws_clients.iam.create_access_key.return_value = _create_access_key_response(
        UserName="Deploy-Bot"
    )

    result = AWSProvider.mint(
        ACCESS_KEY_CREDS, {"user_name": "deploy-bot"}, caller_id="rs-1"
    )

    assert result.provider_credential_id == f"Deploy-Bot:{NEW_KEY_ID}"
    assert result.metadata["user_name"] == "Deploy-Bot"


def test_mint_works_with_assume_role_credentials():
    session = MagicMock()
    iam = session.client.return_value
    iam.create_access_key.return_value = _create_access_key_response()

    with patch(f"{_AWS}.get_aws_sts_session", return_value=session) as sts_session:
        result = AWSProvider.mint(ASSUME_ROLE_CREDS, CONFIG, caller_id="rs-1")

    sts_session.assert_called_once_with(ROLE_ARN, "eu-west-1", "phase-external-id")
    session.client.assert_called_once_with("iam", config=aws._BOTO_CONFIG)
    iam.create_access_key.assert_called_once_with(UserName="deploy-bot")
    assert result.provider_credential_id == f"deploy-bot:{NEW_KEY_ID}"


@pytest.mark.parametrize(
    "response",
    [
        None,
        {},
        {"AccessKey": None},
        {"AccessKey": {"AccessKeyId": NEW_KEY_ID, "Status": "Active"}},
        {"AccessKey": {"SecretAccessKey": NEW_SECRET}},
    ],
)
def test_mint_rejects_unexpected_response_shape(aws_clients, response):
    aws_clients.iam.create_access_key.return_value = response

    with pytest.raises(ProviderConfigError) as exc:
        AWSProvider.mint(ACCESS_KEY_CREDS, CONFIG, caller_id="rs-1")

    assert NEW_SECRET not in f"{exc.value} {exc.value.user_message} {exc.value.raw}"


def test_mint_key_limit_is_transient_with_guidance(aws_clients):
    aws_clients.iam.create_access_key.side_effect = _client_error(
        "LimitExceeded",
        status=409,
        message="Cannot exceed quota for AccessKeysPerUser: 2",
    )

    with pytest.raises(ProviderTransientError) as exc:
        AWSProvider.mint(ACCESS_KEY_CREDS, CONFIG, caller_id="rs-1")

    assert exc.value.user_message == (
        "IAM user 'deploy-bot' already has 2 access keys (the AWS limit). Revoke "
        "the expiring credential in Phase or delete an unused key in AWS."
    )
    assert exc.value.raw == {
        "error_code": "LimitExceeded",
        "operation": "CreateAccessKey",
    }


def test_mint_unknown_user_is_a_config_error(aws_clients):
    aws_clients.iam.create_access_key.side_effect = _client_error(
        "NoSuchEntity",
        status=404,
        message="The user with name deploy-bot cannot be found.",
    )

    with pytest.raises(ProviderConfigError) as exc:
        AWSProvider.mint(ACCESS_KEY_CREDS, CONFIG, caller_id="rs-1")

    assert exc.value.user_message == "IAM user 'deploy-bot' not found."
    assert exc.value.raw["error_code"] == "NoSuchEntity"


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (_client_error("AccessDenied", status=403), ProviderAuthError),
        (_client_error("AccessDeniedException", status=403), ProviderAuthError),
        (_client_error("InvalidClientTokenId", status=403), ProviderAuthError),
        (_client_error("SignatureDoesNotMatch", status=403), ProviderAuthError),
        (_client_error("ExpiredToken", status=403), ProviderAuthError),
        (_client_error("UnrecognizedClientException"), ProviderAuthError),
        (_client_error("Throttling"), ProviderTransientError),
        (_client_error("ThrottlingException"), ProviderTransientError),
        (_client_error("RequestLimitExceeded"), ProviderTransientError),
        (_client_error("ServiceFailure", status=500), ProviderTransientError),
        (_client_error("ServiceUnavailable", status=503), ProviderTransientError),
        (_client_error("SomethingNew", status=502), ProviderTransientError),
        (_client_error("ValidationError"), ProviderConfigError),
        (NoCredentialsError(), ProviderAuthError),
        (
            PartialCredentialsError(provider="explicit", cred_var="secret_key"),
            ProviderAuthError,
        ),
        (
            EndpointConnectionError(endpoint_url="https://iam.amazonaws.com/"),
            ProviderTransientError,
        ),
        (
            ParamValidationError(report="Invalid length for UserName"),
            ProviderConfigError,
        ),
    ],
)
def test_mint_translates_aws_errors(aws_clients, error, expected):
    aws_clients.iam.create_access_key.side_effect = error

    with pytest.raises(expected) as exc:
        AWSProvider.mint(ACCESS_KEY_CREDS, CONFIG, caller_id="rs-1")

    assert type(exc.value) is expected


def test_error_messages_keep_aws_detail_but_redact_key_ids(aws_clients):
    aws_clients.iam.create_access_key.side_effect = _client_error(
        "AccessDenied",
        status=403,
        message=(
            f"User: arn:aws:iam::123456789012:user/phase ({NEW_KEY_ID}) is not "
            "authorized to perform: iam:CreateAccessKey"
        ),
    )

    with pytest.raises(ProviderAuthError) as exc:
        AWSProvider.mint(ACCESS_KEY_CREDS, CONFIG, caller_id="rs-1")

    assert "not authorized to perform: iam:CreateAccessKey" in exc.value.user_message
    assert exc.value.user_message.startswith("AWS denied the request (AccessDenied): ")
    for value in (NEW_KEY_ID, ROOT_SECRET, ROOT_KEY_ID):
        assert value not in exc.value.user_message


# ---------------------------------------------------------------------------
# revoke
# ---------------------------------------------------------------------------


def test_revoke_deletes_the_encoded_access_key(aws_clients):
    aws_clients.iam.delete_access_key.return_value = {
        "ResponseMetadata": {"HTTPStatusCode": 200, "RequestId": "req-9"}
    }

    summary = AWSProvider.revoke(ACCESS_KEY_CREDS, f"deploy-bot:{NEW_KEY_ID}")

    aws_clients.session.client.assert_called_once_with("iam", config=aws._BOTO_CONFIG)
    aws_clients.iam.delete_access_key.assert_called_once_with(
        UserName="deploy-bot", AccessKeyId=NEW_KEY_ID
    )
    assert summary == {
        "user_name": "deploy-bot",
        "call": {"operation": "DeleteAccessKey", "status": 200, "request_id": "req-9"},
    }


@pytest.mark.parametrize(
    "message",
    [
        f"The Access Key with id {NEW_KEY_ID} cannot be found.",
        "The user with name deploy-bot cannot be found.",
    ],
)
def test_revoke_missing_key_or_user_raises_not_found(aws_clients, message):
    aws_clients.iam.delete_access_key.side_effect = _client_error(
        "NoSuchEntity", "DeleteAccessKey", 404, message
    )

    with pytest.raises(ProviderNotFound) as exc:
        AWSProvider.revoke(ACCESS_KEY_CREDS, f"deploy-bot:{NEW_KEY_ID}")

    assert exc.value.user_message.startswith("Not found in AWS: ")
    assert NEW_KEY_ID not in exc.value.user_message


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (_client_error("AccessDenied", "DeleteAccessKey", 403), ProviderAuthError),
        (_client_error("Throttling", "DeleteAccessKey"), ProviderTransientError),
        # The two-key guidance only applies to mint.
        (_client_error("LimitExceeded", "DeleteAccessKey", 409), ProviderConfigError),
    ],
)
def test_revoke_translates_aws_errors(aws_clients, error, expected):
    aws_clients.iam.delete_access_key.side_effect = error

    with pytest.raises(expected) as exc:
        AWSProvider.revoke(ACCESS_KEY_CREDS, f"deploy-bot:{NEW_KEY_ID}")

    assert type(exc.value) is expected


def test_revoke_rejects_malformed_provider_id_before_calling_aws(aws_clients):
    with pytest.raises(ProviderConfigError):
        AWSProvider.revoke(ACCESS_KEY_CREDS, NEW_KEY_ID)

    aws_clients.build_session.assert_not_called()


# ---------------------------------------------------------------------------
# validate_root_credentials
# ---------------------------------------------------------------------------


def test_validate_root_credentials_calls_get_caller_identity(aws_clients):
    assert AWSProvider.validate_root_credentials(ACCESS_KEY_CREDS) is True

    aws_clients.session.client.assert_called_once_with("sts", config=aws._BOTO_CONFIG)
    aws_clients.sts.get_caller_identity.assert_called_once_with()


def test_validate_root_credentials_accepts_an_assumable_role():
    session = MagicMock()
    with patch(f"{_AWS}.get_aws_sts_session", return_value=session) as sts_session:
        assert AWSProvider.validate_root_credentials(ASSUME_ROLE_CREDS) is True

    sts_session.assert_called_once_with(ROLE_ARN, "eu-west-1", "phase-external-id")
    session.client.assert_called_once_with("sts", config=aws._BOTO_CONFIG)
    session.client.return_value.get_caller_identity.assert_called_once_with()


@pytest.mark.parametrize(
    "error",
    [
        _client_error("InvalidClientTokenId", "GetCallerIdentity", 403),
        EndpointConnectionError(endpoint_url="https://sts.amazonaws.com/"),
        RuntimeError("unexpected"),
    ],
)
def test_validate_root_credentials_returns_false_on_failure(aws_clients, error):
    aws_clients.sts.get_caller_identity.side_effect = error

    assert AWSProvider.validate_root_credentials(ACCESS_KEY_CREDS) is False


def test_validate_root_credentials_returns_false_when_the_role_cannot_be_assumed():
    with patch(
        f"{_AWS}.get_aws_sts_session",
        side_effect=_client_error("AccessDenied", "AssumeRole", 403),
    ):
        assert AWSProvider.validate_root_credentials(ASSUME_ROLE_CREDS) is False


def test_validate_root_credentials_returns_false_without_credentials():
    assert AWSProvider.validate_root_credentials({"region": "us-east-1"}) is False


# ---------------------------------------------------------------------------
# list_resources
# ---------------------------------------------------------------------------


def test_list_resources_returns_iam_users_across_pages(aws_clients):
    paginator = aws_clients.iam.get_paginator.return_value
    paginator.paginate.return_value = iter(
        [
            {
                "Users": [
                    {"UserName": "deploy-bot", "Path": "/ci/"},
                    {"UserName": "alice", "Path": "/"},
                ],
                "IsTruncated": True,
                "Marker": "page-2",
            },
            {
                "Users": [{"UserName": "bob"}, {"Path": "/no-name/"}],
                "IsTruncated": False,
            },
        ]
    )

    resources = AWSProvider.list_resources(ACCESS_KEY_CREDS, "iam_user")

    aws_clients.iam.get_paginator.assert_called_once_with("list_users")
    paginator.paginate.assert_called_once_with(PaginationConfig={"PageSize": 1000})
    assert [(r.id, r.name, r.description) for r in resources] == [
        ("deploy-bot", "deploy-bot", "/ci/"),
        ("alice", "alice", "/"),
        ("bob", "bob", ""),
    ]


def test_list_resources_stops_at_the_page_ceiling(aws_clients):
    fetched = []

    def endless_pages():
        for page in itertools.count():
            fetched.append(page)
            yield {"Users": [{"UserName": f"user-{page}", "Path": "/"}]}

    aws_clients.iam.get_paginator.return_value.paginate.return_value = endless_pages()

    resources = AWSProvider.list_resources(ACCESS_KEY_CREDS, "iam_user")

    assert len(resources) == aws._MAX_USER_PAGES
    assert len(fetched) == aws._MAX_USER_PAGES


def test_list_resources_translates_errors_raised_while_paging(aws_clients):
    def pages():
        yield {"Users": [{"UserName": "deploy-bot", "Path": "/"}]}
        raise _client_error(
            "AccessDenied",
            "ListUsers",
            403,
            "User: arn:aws:iam::123456789012:user/phase is not authorized to "
            "perform: iam:ListUsers",
        )

    aws_clients.iam.get_paginator.return_value.paginate.return_value = pages()

    with pytest.raises(ProviderAuthError) as exc:
        AWSProvider.list_resources(ACCESS_KEY_CREDS, "iam_user")

    assert "iam:ListUsers" in exc.value.user_message


def test_list_resources_rejects_unknown_type(aws_clients):
    with pytest.raises(ProviderConfigError):
        AWSProvider.list_resources(ACCESS_KEY_CREDS, "iam_role")

    aws_clients.build_session.assert_not_called()


# ---------------------------------------------------------------------------
# Rotation queries accept assume-role credentials for AWS
# ---------------------------------------------------------------------------


def _make_info(user_id="actor-1"):
    return SimpleNamespace(
        context=SimpleNamespace(user=SimpleNamespace(userId=user_id))
    )


def _patch_queries(monkeypatch, credential_provider):
    credential = SimpleNamespace(
        id="cred-1",
        organisation=SimpleNamespace(id="org-1"),
        provider=credential_provider,
    )
    creds_model = MagicMock()
    lookup = creds_model.objects.filter.return_value.select_related.return_value
    lookup.first.return_value = credential
    monkeypatch.setattr(syncing_queries, "ProviderCredentials", creds_model)

    allow = MagicMock(return_value=True)
    monkeypatch.setattr(syncing_queries, "user_has_permission", allow)
    monkeypatch.setattr(queries, "user_has_permission", allow)

    get_credentials = MagicMock(return_value=dict(ASSUME_ROLE_CREDS))
    monkeypatch.setattr(queries, "get_credentials", get_credentials)
    return get_credentials


def _list_iam_users():
    return queries.resolve_rotation_provider_resources(
        None,
        _make_info(),
        provider_id="aws",
        authentication_id="cred-1",
        resource_type="iam_user",
        config={"user_name": "deploy-bot"},
    )


def test_resources_resolver_lists_iam_users_with_assume_role_credentials(
    monkeypatch,
):
    get_credentials = _patch_queries(monkeypatch, "aws_assume_role")
    session = MagicMock()
    paginator = session.client.return_value.get_paginator.return_value
    paginator.paginate.return_value = iter(
        [{"Users": [{"UserName": "deploy-bot", "Path": "/ci/"}]}]
    )

    with patch(f"{_AWS}.get_aws_sts_session", return_value=session) as sts_session:
        resources = _list_iam_users()

    get_credentials.assert_called_once_with("cred-1")
    sts_session.assert_called_once_with(ROLE_ARN, "eu-west-1", "phase-external-id")
    assert [(r.id, r.name, r.description) for r in resources] == [
        ("deploy-bot", "deploy-bot", "/ci/")
    ]


@pytest.mark.parametrize("credential_provider", ["openai", "gcp"])
def test_resources_resolver_rejects_non_aws_credentials(
    monkeypatch, credential_provider
):
    get_credentials = _patch_queries(monkeypatch, credential_provider)

    with pytest.raises(
        GraphQLError, match="^These credentials can't be used with AWS$"
    ):
        _list_iam_users()

    get_credentials.assert_not_called()


def test_import_template_resolver_accepts_assume_role_credentials(monkeypatch):
    _patch_queries(monkeypatch, "aws_assume_role")

    # The credential check passes; AWS just has nothing to import.
    with pytest.raises(GraphQLError, match="returned no importable config"):
        queries.resolve_rotation_provider_import_template(
            None,
            _make_info(),
            provider_id="aws",
            authentication_id="cred-1",
            template_ref="deploy-bot",
        )


# ---------------------------------------------------------------------------
# Create and update mutations accept assume-role credentials for AWS
# ---------------------------------------------------------------------------

INTERVAL_ERROR = "^Rotation interval must be at least 60 seconds$"
PROVIDER_ERROR = "^Selected credentials are for a different provider$"


def _patch_mutations(monkeypatch, credential_provider):
    allow = MagicMock(return_value=True)
    for guard in (
        "user_is_org_member",
        "user_has_permission",
        "user_can_access_environment",
        "can_use_rotating_secrets",
    ):
        monkeypatch.setattr(mutations, guard, allow)
    monkeypatch.setattr(mutations, "assert_sse_enabled", MagicMock())
    monkeypatch.setattr(mutations, "_actor_kwargs", MagicMock(return_value={}))
    monkeypatch.setattr(mutations, "Organisation", MagicMock())
    monkeypatch.setattr(mutations, "Environment", MagicMock())

    rs_model = MagicMock()
    rs_model.objects.get.return_value = MagicMock(
        provider="aws", authentication_id="cred-old"
    )
    monkeypatch.setattr(mutations, "RotatingSecret", rs_model)

    creds_model = MagicMock()
    creds_model.objects.get.return_value = SimpleNamespace(
        id="cred-new", provider=credential_provider
    )
    monkeypatch.setattr(mutations, "ProviderCredentials", creds_model)


# Both use an interval below the minimum, so accepted credentials stop at that check.
def _create_rotating_secret():
    return mutations.CreateRotatingSecretMutation.mutate(
        None,
        _make_info(),
        organisation_id="org-1",
        environment_id="env-1",
        name="Deploy key",
        provider="aws",
        authentication_id="cred-new",
        config=dict(CONFIG),
        key_map=[],
        rotation_interval_seconds=30,
    )


def _update_rotating_secret():
    return mutations.UpdateRotatingSecretMutation.mutate(
        None,
        _make_info(),
        rotating_secret_id="rs-1",
        authentication_id="cred-new",
        rotation_interval_seconds=30,
    )


@pytest.mark.parametrize(
    "mutate",
    [_create_rotating_secret, _update_rotating_secret],
    ids=["create", "update"],
)
@pytest.mark.parametrize(
    ("credential_provider", "error"),
    [
        ("aws", INTERVAL_ERROR),
        ("aws_assume_role", INTERVAL_ERROR),
        ("openai", PROVIDER_ERROR),
    ],
)
def test_mutations_accept_either_aws_credential_type(
    monkeypatch, mutate, credential_provider, error
):
    _patch_mutations(monkeypatch, credential_provider)

    with pytest.raises(GraphQLError, match=error):
        mutate()
