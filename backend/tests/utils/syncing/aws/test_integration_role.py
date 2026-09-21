"""
AWS_INTEGRATION_ROLE_ARN (opt-in): the instance/machine role assumes that role first, and target
roles are assumed from it. Unset, every path behaves exactly as it did before.
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, call, patch

import pytest
from botocore.exceptions import ClientError

from api.utils.syncing.aws.auth import (
    get_aws_sts_session,
    validate_aws_assume_role_auth,
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
TARGET_RESPONSE = {
    "Credentials": {**HOP_CREDENTIALS, "AccessKeyId": "ASIATARGET"},
    "AssumedRoleUser": {"Arn": "arn:aws:sts::222222222222:assumed-role/CustomerRole/x"},
}
ACCESS_DENIED = ClientError({"Error": {"Code": "AccessDenied", "Message": "AccessDenied"}}, "AssumeRole")

# Each place that assumes a target role: (call it, region it should use, does it assume right away?)
SITES = {
    "sync": (lambda: get_aws_sts_session(TARGET_ROLE, "eu-central-1", "ext"), "eu-central-1", True),
    "validation": (lambda: validate_aws_assume_role_credentials(TARGET_ROLE, None, "ext"), "us-east-1", True),
    "dynamic secrets": (lambda: get_sts_client(), "us-east-1", False),
}  # fmt: skip


@contextmanager
def aws(*clients, integration_keys=None):
    """Patch boto3.client to hand out `clients` in order, and the AWS_INTEGRATION_* key lookup."""
    with patch("api.utils.syncing.aws.auth.get_secret", return_value=integration_keys), \
         patch("ee.integrations.secrets.dynamic.aws.utils.get_secret", return_value=integration_keys), \
         patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth", return_value={"valid": True}), \
         patch("api.utils.syncing.aws.auth.boto3.Session"), \
         patch("api.utils.syncing.aws.auth.boto3.client", side_effect=list(clients)) as client:  # fmt: skip
        yield client


def sts_client(assume_role):
    client = MagicMock()
    if isinstance(assume_role, Exception):
        client.assume_role.side_effect = assume_role
    else:
        client.assume_role.return_value = assume_role
    return client


# --- Opted in ------------------------------------------------------------------------------------


@pytest.mark.parametrize("site", SITES.values(), ids=SITES.keys())
def test_target_role_is_assumed_from_the_integration_role(monkeypatch, site):
    run, region, assumes_now = site
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)
    machine = sts_client({"Credentials": HOP_CREDENTIALS})
    integration = sts_client(TARGET_RESPONSE)

    with aws(machine, integration) as client:
        run()

    assert client.call_args_list == [
        call("sts", region_name=region),  # machine role, from the default credential chain
        call(
            "sts",
            aws_access_key_id="ASIAHOP",
            aws_secret_access_key="hop-secret",
            aws_session_token="hop-token",
            region_name=region,
        ),
    ]
    # First hop: our own role, so no external ID. It belongs to the target role only.
    machine.assume_role.assert_called_once_with(
        RoleArn=INTEGRATION_ROLE, RoleSessionName="phase-integration"
    )
    if assumes_now:
        integration.assume_role.assert_called_once()
        assert integration.assume_role.call_args.kwargs["RoleArn"] == TARGET_ROLE
        assert integration.assume_role.call_args.kwargs["ExternalId"] == "ext"


def test_region_none_is_passed_through_to_both_hops(monkeypatch):
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)
    with aws(sts_client({"Credentials": HOP_CREDENTIALS}), sts_client(TARGET_RESPONSE)) as client:
        get_aws_sts_session(TARGET_ROLE)
    assert [c.kwargs["region_name"] for c in client.call_args_list] == [None, None]


def test_first_hop_denied_is_reported_and_stops_there(monkeypatch):
    """e.g. the integration role's trust policy does not allow the machine role yet."""
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)

    with aws(sts_client(ACCESS_DENIED)) as client:
        result = validate_aws_assume_role_credentials(TARGET_ROLE)
    assert result["valid"] is False and "Access denied" in result["message"]
    assert client.call_count == 1  # the target role is never attempted

    with aws(sts_client(ACCESS_DENIED)), pytest.raises(ClientError):
        get_aws_sts_session(TARGET_ROLE, "eu-central-1")

    with aws(sts_client(ACCESS_DENIED)), pytest.raises(ClientError):
        get_sts_client()


def test_second_hop_denied_is_reported(monkeypatch):
    """e.g. the target role trusts the machine role but not the integration role."""
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)
    with aws(sts_client({"Credentials": HOP_CREDENTIALS}), sts_client(ACCESS_DENIED)):
        result = validate_aws_assume_role_credentials(TARGET_ROLE)
    assert result["valid"] is False and "Access denied" in result["message"]


def test_base_credentials_check_is_unaffected(monkeypatch):
    """It only confirms machine credentials exist, so it must not hop."""
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)
    machine = MagicMock()
    with patch("api.utils.syncing.aws.auth.get_secret", return_value=None), \
         patch("api.utils.syncing.aws.auth.boto3.client", return_value=machine) as client:  # fmt: skip
        result = validate_aws_assume_role_auth()
    assert (result["valid"], result["method"]) == (True, "machine_roles")
    client.assert_called_once_with("sts", region_name="us-east-1")
    machine.get_caller_identity.assert_called_once()
    machine.assume_role.assert_not_called()


# --- Not opted in: unchanged -----------------------------------------------------------------------


@pytest.mark.parametrize("value", [None, ""], ids=["unset", "empty"])
@pytest.mark.parametrize("site", SITES.values(), ids=SITES.keys())
def test_instance_profile_path_is_unchanged_without_the_variable(monkeypatch, site, value):
    run, region, assumes_now = site
    monkeypatch.delenv("AWS_INTEGRATION_ROLE_ARN", raising=False)
    if value is not None:
        monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", value)
    machine = sts_client(TARGET_RESPONSE)

    with aws(machine) as client:
        run()

    client.assert_called_once_with("sts", region_name=region)  # one client, no static keys
    if assumes_now:
        machine.assume_role.assert_called_once()  # one hop, straight to the target
        assert machine.assume_role.call_args.kwargs["RoleArn"] == TARGET_ROLE


@pytest.mark.parametrize("site", SITES.values(), ids=SITES.keys())
def test_integration_access_keys_still_take_precedence(monkeypatch, site):
    run, region, _ = site
    monkeypatch.setenv("AWS_INTEGRATION_ROLE_ARN", INTEGRATION_ROLE)
    keyed = sts_client(TARGET_RESPONSE)

    with aws(keyed, integration_keys="key") as client:
        run()

    assert client.call_count == 1
    assert client.call_args.kwargs["aws_access_key_id"] == "key"
    assert "aws_session_token" not in client.call_args.kwargs
    for assumed in keyed.assume_role.call_args_list:
        assert assumed.kwargs["RoleArn"] != INTEGRATION_ROLE
