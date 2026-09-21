from unittest.mock import MagicMock, call, patch

import pytest

from api.utils.syncing.aws.auth import (
    get_aws_sts_session,
    validate_aws_assume_role_credentials,
)
from ee.integrations.secrets.dynamic.aws.utils import get_sts_client

INTEGRATION_ROLE = "arn:aws:iam::111111111111:role/PhaseIntegration"
TARGET_ROLE = "arn:aws:iam::222222222222:role/CustomerRole"
HOP_CREDENTIALS = {
    "AccessKeyId": "ASIAHOP",
    "SecretAccessKey": "hop-secret",
    "SessionToken": "hop-token",
}


@pytest.fixture
def sts(monkeypatch):
    """Patch boto3.client: the first client is the machine role, the second is the integration role."""
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)
    machine, integration = MagicMock(), MagicMock()
    machine.assume_role.return_value = {"Credentials": HOP_CREDENTIALS}
    integration.assume_role.return_value = {
        "Credentials": {**HOP_CREDENTIALS, "AccessKeyId": "ASIATARGET"},
        "AssumedRoleUser": {"Arn": "arn:aws:sts::222222222222:assumed-role/CustomerRole/x"},
    }
    with patch("api.utils.syncing.aws.auth.get_secret", return_value=None), patch(
        "ee.integrations.secrets.dynamic.aws.utils.get_secret", return_value=None
    ), patch(
        "api.utils.syncing.aws.auth.boto3.client", side_effect=[machine, integration]
    ) as client:
        yield client, machine, integration


def assert_hopped(client, machine, region):
    assert client.call_args_list == [
        call("sts", region_name=region),
        call(
            "sts",
            aws_access_key_id="ASIAHOP",
            aws_secret_access_key="hop-secret",
            aws_session_token="hop-token",
            region_name=region,
        ),
    ]
    machine.assume_role.assert_called_once_with(
        RoleArn=INTEGRATION_ROLE, RoleSessionName="phase-integration"
    )


@patch("api.utils.syncing.aws.auth.boto3.Session")
def test_sync_session_assumes_target_from_the_integration_role(_session, sts):
    client, machine, integration = sts
    get_aws_sts_session(TARGET_ROLE, "eu-central-1", external_id="ext")
    assert_hopped(client, machine, "eu-central-1")
    integration.assume_role.assert_called_once_with(
        RoleArn=TARGET_ROLE, RoleSessionName="phase-sync-session", ExternalId="ext"
    )


def test_validation_assumes_target_from_the_integration_role(sts):
    client, machine, integration = sts
    with patch(
        "api.utils.syncing.aws.auth.validate_aws_assume_role_auth",
        return_value={"valid": True},
    ):
        result = validate_aws_assume_role_credentials(TARGET_ROLE)
    assert result["valid"] is True
    assert_hopped(client, machine, "us-east-1")
    integration.assume_role.assert_called_once()


def test_dynamic_secrets_sts_client_is_the_integration_role(sts):
    client, machine, integration = sts
    assert get_sts_client() is integration
    assert_hopped(client, machine, "us-east-1")


def test_integration_access_keys_still_take_precedence(monkeypatch):
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)
    with patch("api.utils.syncing.aws.auth.get_secret", return_value="key"), patch(
        "api.utils.syncing.aws.auth.boto3.Session"
    ), patch("api.utils.syncing.aws.auth.boto3.client") as client:
        get_aws_sts_session(TARGET_ROLE, "eu-central-1")
    client.assert_called_once_with(
        "sts",
        aws_access_key_id="key",
        aws_secret_access_key="key",
        region_name="eu-central-1",
    )
