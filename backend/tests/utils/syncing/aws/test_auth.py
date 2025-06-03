import unittest
from unittest.mock import patch, MagicMock
from botocore.exceptions import ClientError
from api.utils.syncing.aws.auth import (
    get_client,
    get_aws_sts_session,
    get_aws_assume_role_credentials,
    validate_aws_assume_role_auth,
    validate_aws_assume_role_credentials,
)


class TestAuth(unittest.TestCase):

    @patch("api.utils.syncing.aws.auth.boto3.Session")
    def test_get_client(self, mock_boto_session):
        # Arrange
        mock_aws_access_key_id = "AKIA2OGYBAH63UA3VNFG"
        mock_aws_secret_access_key = "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"
        mock_region = "eu-central-1"

        mock_session_instance = MagicMock()
        mock_client_instance = MagicMock()
        mock_boto_session.return_value = mock_session_instance
        mock_session_instance.client.return_value = mock_client_instance

        # Act
        client = get_client(
            mock_aws_access_key_id, mock_aws_secret_access_key, mock_region
        )

        # Assert
        mock_boto_session.assert_called_once_with(
            aws_access_key_id=mock_aws_access_key_id,
            aws_secret_access_key=mock_aws_secret_access_key,
            region_name=mock_region,
        )
        mock_session_instance.client.assert_called_once_with("secretsmanager")
        self.assertEqual(client, mock_client_instance)

    @patch("api.utils.syncing.aws.auth.boto3.Session")
    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    def test_get_aws_sts_session_with_integration_credentials(
        self, mock_get_secret, mock_boto_client, mock_boto_session
    ):
        # Arrange
        mock_role_arn = "arn:aws:iam::123456789012:role/TestRole"
        mock_region = "eu-central-1"
        mock_external_id = (
            "ccd754c9cb5e95f8e58c361e5269bcd77367b6eb57ae69c0ede2226b03cf2980"
        )
        mock_aws_access_key_id = "AKIA2OGYBAH63UA3VNFG"
        mock_aws_secret_access_key = "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"

        mock_get_secret.side_effect = lambda key: {
            "AWS_INTEGRATION_ACCESS_KEY_ID": mock_aws_access_key_id,
            "AWS_INTEGRATION_SECRET_ACCESS_KEY": mock_aws_secret_access_key,
        }.get(key)

        mock_sts_client_instance = MagicMock()
        mock_boto_client.return_value = mock_sts_client_instance
        mock_assume_role_response = {
            "Credentials": {
                "AccessKeyId": "AKIA2OGYBAH63UA3VNFG",
                "SecretAccessKey": "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",
                "SessionToken": "temp_session_token",
            }
        }
        mock_sts_client_instance.assume_role.return_value = mock_assume_role_response

        mock_session_instance = MagicMock()
        mock_boto_session.return_value = mock_session_instance

        # Act
        session = get_aws_sts_session(mock_role_arn, mock_region, mock_external_id)

        # Assert
        mock_get_secret.assert_any_call("AWS_INTEGRATION_ACCESS_KEY_ID")
        mock_get_secret.assert_any_call("AWS_INTEGRATION_SECRET_ACCESS_KEY")
        mock_boto_client.assert_called_once_with(
            "sts",
            aws_access_key_id=mock_aws_access_key_id,
            aws_secret_access_key=mock_aws_secret_access_key,
            region_name=mock_region,
        )
        mock_sts_client_instance.assume_role.assert_called_once_with(
            RoleArn=mock_role_arn,
            RoleSessionName="phase-sync-session",
            ExternalId=mock_external_id,
        )
        mock_boto_session.assert_called_once_with(
            aws_access_key_id="AKIA2OGYBAH63UA3VNFG",
            aws_secret_access_key="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",
            aws_session_token="temp_session_token",
            region_name=mock_region,
        )
        self.assertEqual(session, mock_session_instance)

    @patch("api.utils.syncing.aws.auth.boto3.Session")
    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    def test_get_aws_sts_session_with_instance_roles(
        self, mock_get_secret, mock_boto_client, mock_boto_session
    ):
        # Arrange
        mock_role_arn = "arn:aws:iam::123456789012:role/TestRole"
        mock_region = "eu-central-1"

        # Simulate get_secret returning None for integration keys
        mock_get_secret.return_value = None

        mock_sts_client_instance = MagicMock()
        mock_boto_client.return_value = mock_sts_client_instance
        mock_assume_role_response = {
            "Credentials": {
                "AccessKeyId": "AKIA2OGYBAH63UA3VNFG",
                "SecretAccessKey": "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",
                "SessionToken": "instance_temp_session_token",
            }
        }
        mock_sts_client_instance.assume_role.return_value = mock_assume_role_response

        mock_session_instance = MagicMock()
        mock_boto_session.return_value = mock_session_instance

        # Act
        session = get_aws_sts_session(mock_role_arn, mock_region, external_id=None)

        # Assert
        mock_get_secret.assert_any_call("AWS_INTEGRATION_ACCESS_KEY_ID")
        mock_boto_client.assert_called_once_with("sts", region_name=mock_region)
        mock_sts_client_instance.assume_role.assert_called_once_with(
            RoleArn=mock_role_arn, RoleSessionName="phase-sync-session"
        )
        mock_boto_session.assert_called_once_with(
            aws_access_key_id="AKIA2OGYBAH63UA3VNFG",
            aws_secret_access_key="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",
            aws_session_token="instance_temp_session_token",
            region_name=mock_region,
        )
        self.assertEqual(session, mock_session_instance)

    @patch("api.utils.syncing.aws.auth.boto3.Session")
    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    def test_get_aws_sts_session_no_external_id(
        self, mock_get_secret, mock_boto_client, mock_boto_session
    ):
        # Arrange
        mock_role_arn = "arn:aws:iam::123456789012:role/TestRole"
        mock_region = "eu-central-1"
        mock_aws_access_key_id = "AKIA2OGYBAH63UA3VNFG"
        mock_aws_secret_access_key = "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"

        mock_get_secret.side_effect = lambda key: {
            "AWS_INTEGRATION_ACCESS_KEY_ID": mock_aws_access_key_id,
            "AWS_INTEGRATION_SECRET_ACCESS_KEY": mock_aws_secret_access_key,
        }.get(key)

        mock_sts_client_instance = MagicMock()
        mock_boto_client.return_value = mock_sts_client_instance
        mock_assume_role_response = {
            "Credentials": {
                "AccessKeyId": "AKIA2OGYBAH63UA3VNFG",
                "SecretAccessKey": "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",
                "SessionToken": "temp_session_token_no_ext",
            }
        }
        mock_sts_client_instance.assume_role.return_value = mock_assume_role_response

        mock_session_instance = MagicMock()
        mock_boto_session.return_value = mock_session_instance

        # Act
        session = get_aws_sts_session(mock_role_arn, mock_region, external_id=None)

        # Assert
        mock_sts_client_instance.assume_role.assert_called_once_with(
            RoleArn=mock_role_arn,
            RoleSessionName="phase-sync-session",
            # No ExternalId here
        )
        mock_boto_session.assert_called_once_with(
            aws_access_key_id="AKIA2OGYBAH63UA3VNFG",
            aws_secret_access_key="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",
            aws_session_token="temp_session_token_no_ext",
            region_name=mock_region,
        )
        self.assertEqual(session, mock_session_instance)

    @patch("api.utils.syncing.aws.auth.decrypt_asymmetric")
    @patch("api.utils.syncing.aws.auth.get_server_keypair")
    def test_get_aws_assume_role_credentials_all_present(
        self, mock_get_server_keypair, mock_decrypt_asymmetric
    ):
        # Arrange
        mock_pk_hex, mock_sk_hex = "pk_hex_val", "sk_hex_val"
        mock_pk, mock_sk = MagicMock(), MagicMock()
        mock_pk.hex.return_value = mock_pk_hex
        mock_sk.hex.return_value = mock_sk_hex
        mock_get_server_keypair.return_value = (mock_pk, mock_sk)

        decrypted_values = {
            "enc_role_arn": "decrypted_role_arn",
            "enc_region": "decrypted_region",
            "enc_external_id": "decrypted_external_id",
        }
        mock_decrypt_asymmetric.side_effect = lambda val, sk, pk: decrypted_values.get(
            val
        )

        mock_environment_sync = MagicMock()
        mock_environment_sync.authentication.credentials = {
            "role_arn": "enc_role_arn",
            "region": "enc_region",
            "external_id": "enc_external_id",
        }

        # Act
        creds = get_aws_assume_role_credentials(mock_environment_sync)

        # Assert
        mock_get_server_keypair.assert_called_once()
        calls = [
            unittest.mock.call("enc_role_arn", mock_sk_hex, mock_pk_hex),
            unittest.mock.call("enc_region", mock_sk_hex, mock_pk_hex),
            unittest.mock.call("enc_external_id", mock_sk_hex, mock_pk_hex),
        ]
        mock_decrypt_asymmetric.assert_has_calls(calls, any_order=True)
        self.assertEqual(mock_decrypt_asymmetric.call_count, 3)
        expected_creds = {
            "role_arn": "decrypted_role_arn",
            "region": "decrypted_region",
            "external_id": "decrypted_external_id",
        }
        self.assertEqual(creds, expected_creds)

    @patch("api.utils.syncing.aws.auth.decrypt_asymmetric")
    @patch("api.utils.syncing.aws.auth.get_server_keypair")
    def test_get_aws_assume_role_credentials_no_region(
        self, mock_get_server_keypair, mock_decrypt_asymmetric
    ):
        # Arrange
        mock_pk_hex, mock_sk_hex = "pk_hex_val", "sk_hex_val"
        mock_pk, mock_sk = MagicMock(), MagicMock()
        mock_pk.hex.return_value = mock_pk_hex
        mock_sk.hex.return_value = mock_sk_hex
        mock_get_server_keypair.return_value = (mock_pk, mock_sk)

        decrypted_values = {
            "enc_role_arn": "decrypted_role_arn",
            "enc_external_id": "decrypted_external_id",
        }
        mock_decrypt_asymmetric.side_effect = lambda val, sk, pk: decrypted_values.get(
            val
        )

        mock_environment_sync = MagicMock()
        mock_environment_sync.authentication.credentials = {
            "role_arn": "enc_role_arn",
            "external_id": "enc_external_id",
            # No region
        }

        # Act
        creds = get_aws_assume_role_credentials(mock_environment_sync)

        # Assert
        mock_get_server_keypair.assert_called_once()
        calls = [
            unittest.mock.call("enc_role_arn", mock_sk_hex, mock_pk_hex),
            unittest.mock.call("enc_external_id", mock_sk_hex, mock_pk_hex),
        ]
        mock_decrypt_asymmetric.assert_has_calls(calls, any_order=True)
        self.assertEqual(mock_decrypt_asymmetric.call_count, 2)
        expected_creds = {
            "role_arn": "decrypted_role_arn",
            "region": None,
            "external_id": "decrypted_external_id",
        }
        self.assertEqual(creds, expected_creds)

    @patch("api.utils.syncing.aws.auth.decrypt_asymmetric")
    @patch("api.utils.syncing.aws.auth.get_server_keypair")
    def test_get_aws_assume_role_credentials_no_external_id(
        self, mock_get_server_keypair, mock_decrypt_asymmetric
    ):
        # Arrange
        mock_pk_hex, mock_sk_hex = "pk_hex_val", "sk_hex_val"
        mock_pk, mock_sk = MagicMock(), MagicMock()
        mock_pk.hex.return_value = mock_pk_hex
        mock_sk.hex.return_value = mock_sk_hex
        mock_get_server_keypair.return_value = (mock_pk, mock_sk)

        decrypted_values = {
            "enc_role_arn": "decrypted_role_arn",
            "enc_region": "decrypted_region",
        }
        mock_decrypt_asymmetric.side_effect = lambda val, sk, pk: decrypted_values.get(
            val
        )

        mock_environment_sync = MagicMock()
        mock_environment_sync.authentication.credentials = {
            "role_arn": "enc_role_arn",
            "region": "enc_region",
            # No external_id
        }

        # Act
        creds = get_aws_assume_role_credentials(mock_environment_sync)

        # Assert
        mock_get_server_keypair.assert_called_once()
        calls = [
            unittest.mock.call("enc_role_arn", mock_sk_hex, mock_pk_hex),
            unittest.mock.call("enc_region", mock_sk_hex, mock_pk_hex),
        ]
        mock_decrypt_asymmetric.assert_has_calls(calls, any_order=True)
        self.assertEqual(mock_decrypt_asymmetric.call_count, 2)
        expected_creds = {
            "role_arn": "decrypted_role_arn",
            "region": "decrypted_region",
            "external_id": None,
        }
        self.assertEqual(creds, expected_creds)

    @patch("api.utils.syncing.aws.auth.decrypt_asymmetric")
    @patch("api.utils.syncing.aws.auth.get_server_keypair")
    def test_get_aws_assume_role_credentials_no_region_no_external_id(
        self, mock_get_server_keypair, mock_decrypt_asymmetric
    ):
        # Arrange
        mock_pk_hex, mock_sk_hex = "pk_hex_val", "sk_hex_val"
        mock_pk, mock_sk = MagicMock(), MagicMock()
        mock_pk.hex.return_value = mock_pk_hex
        mock_sk.hex.return_value = mock_sk_hex
        mock_get_server_keypair.return_value = (mock_pk, mock_sk)

        decrypted_values = {"enc_role_arn": "decrypted_role_arn"}
        mock_decrypt_asymmetric.side_effect = lambda val, sk, pk: decrypted_values.get(
            val
        )

        mock_environment_sync = MagicMock()
        mock_environment_sync.authentication.credentials = {
            "role_arn": "enc_role_arn"
            # No region, no external_id
        }

        # Act
        creds = get_aws_assume_role_credentials(mock_environment_sync)

        # Assert
        mock_get_server_keypair.assert_called_once()
        mock_decrypt_asymmetric.assert_called_once_with(
            "enc_role_arn", mock_sk_hex, mock_pk_hex
        )
        expected_creds = {
            "role_arn": "decrypted_role_arn",
            "region": None,
            "external_id": None,
        }
        self.assertEqual(creds, expected_creds)

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    def test_validate_aws_assume_role_auth_with_integration_creds_success(
        self, mock_get_secret, mock_boto_client
    ):
        # Arrange
        mock_get_secret.side_effect = lambda key: {
            "AWS_INTEGRATION_ACCESS_KEY_ID": "fake_id",
            "AWS_INTEGRATION_SECRET_ACCESS_KEY": "fake_key",
        }.get(key)
        mock_sts_client = MagicMock()
        mock_sts_client.get_caller_identity.return_value = {"UserId": "test_user_id"}
        mock_boto_client.return_value = mock_sts_client

        # Act
        result = validate_aws_assume_role_auth()

        # Assert
        self.assertTrue(result["valid"])
        self.assertEqual(result["method"], "integration_credentials")
        mock_boto_client.assert_called_once_with(
            "sts",
            aws_access_key_id="fake_id",
            aws_secret_access_key="fake_key",
            region_name="us-east-1",
        )
        mock_sts_client.get_caller_identity.assert_called_once()

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    def test_validate_aws_assume_role_auth_with_integration_creds_failure(
        self, mock_get_secret, mock_boto_client
    ):
        # Arrange
        mock_get_secret.side_effect = lambda key: {
            "AWS_INTEGRATION_ACCESS_KEY_ID": "fake_id",
            "AWS_INTEGRATION_SECRET_ACCESS_KEY": "fake_key",
        }.get(key)
        mock_sts_client = MagicMock()
        mock_sts_client.get_caller_identity.side_effect = Exception("STS error")
        mock_boto_client.return_value = mock_sts_client

        # Act
        result = validate_aws_assume_role_auth()

        # Assert
        self.assertFalse(result["valid"])
        self.assertEqual(result["method"], "error")  # General exception catch
        self.assertIn("AWS credential validation failed: STS error", result["message"])
        self.assertEqual(result["error"], "STS error")

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    def test_validate_aws_assume_role_auth_with_machine_roles_success(
        self, mock_get_secret, mock_boto_client
    ):
        # Arrange
        mock_get_secret.return_value = None  # No integration creds
        mock_sts_client = MagicMock()
        mock_sts_client.get_caller_identity.return_value = {"UserId": "machine_user_id"}
        mock_boto_client.return_value = mock_sts_client

        # Act
        result = validate_aws_assume_role_auth()

        # Assert
        self.assertTrue(result["valid"])
        self.assertEqual(result["method"], "machine_roles")
        mock_boto_client.assert_called_once_with("sts", region_name="us-east-1")
        mock_sts_client.get_caller_identity.assert_called_once()

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    def test_validate_aws_assume_role_auth_with_machine_roles_failure(
        self, mock_get_secret, mock_boto_client
    ):
        # Arrange
        mock_get_secret.return_value = None  # No integration creds
        mock_sts_client = MagicMock()
        mock_sts_client.get_caller_identity.side_effect = Exception(
            "Machine role error"
        )
        mock_boto_client.return_value = mock_sts_client

        # Act
        result = validate_aws_assume_role_auth()

        # Assert
        self.assertFalse(result["valid"])
        self.assertEqual(result["method"], "none")
        self.assertIn(
            "AWS credentials or machine/instance roles that are required for assuming role have not been configured.",
            result["message"],
        )
        self.assertEqual(result["error"], "Machine role error")

    @patch(
        "api.utils.syncing.aws.auth.get_secret",
        side_effect=Exception("Unexpected get_secret error"),
    )
    def test_validate_aws_assume_role_auth_general_exception(self, mock_get_secret):
        # Act
        result = validate_aws_assume_role_auth()

        # Assert
        self.assertFalse(result["valid"])
        self.assertEqual(result["method"], "error")
        self.assertIn(
            "AWS credential validation failed: Unexpected get_secret error",
            result["message"],
        )
        self.assertEqual(result["error"], "Unexpected get_secret error")

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_auth_check_fails(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        # Arrange
        mock_validate_auth.return_value = {
            "valid": False,
            "message": "Base auth failed",
            "error": "Base error",
        }
        role_arn = "arn:aws:iam::123456789012:role/TestRole"

        # Act
        result = validate_aws_assume_role_credentials(role_arn)

        # Assert
        self.assertEqual(
            result,
            {"valid": False, "message": "Base auth failed", "error": "Base error"},
        )
        mock_validate_auth.assert_called_once()
        mock_get_secret.assert_not_called()
        mock_boto_client.assert_not_called()

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_success_with_integration_creds(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        # Arrange
        mock_validate_auth.return_value = {"valid": True}
        mock_get_secret.side_effect = lambda key: {
            "AWS_INTEGRATION_ACCESS_KEY_ID": "fake_id",
            "AWS_INTEGRATION_SECRET_ACCESS_KEY": "fake_key",
        }.get(key)

        mock_sts_client = MagicMock()
        mock_sts_client.assume_role.return_value = {
            "AssumedRoleUser": {"Arn": "assumed_role_arn"}
        }
        mock_boto_client.return_value = mock_sts_client

        role_arn = "test_role_arn"
        region = "us-east-1"
        external_id = "test_external_id"

        # Act
        result = validate_aws_assume_role_credentials(role_arn, region, external_id)

        # Assert
        self.assertTrue(result["valid"])
        self.assertEqual(result["assumed_role_arn"], "assumed_role_arn")
        mock_boto_client.assert_called_once_with(
            "sts",
            aws_access_key_id="fake_id",
            aws_secret_access_key="fake_key",
            region_name=region,
        )
        mock_sts_client.assume_role.assert_called_once_with(
            RoleArn=role_arn,
            RoleSessionName="phase-validation-session",
            ExternalId=external_id,
        )

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_success_with_machine_roles_no_optional_params(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        # Arrange
        mock_validate_auth.return_value = {"valid": True}
        mock_get_secret.return_value = None  # No integration creds

        mock_sts_client = MagicMock()
        mock_sts_client.assume_role.return_value = {
            "AssumedRoleUser": {"Arn": "assumed_machine_role_arn"}
        }
        mock_boto_client.return_value = mock_sts_client

        role_arn = "test_machine_role_arn"

        # Act
        result = validate_aws_assume_role_credentials(
            role_arn, region=None, external_id=None
        )

        # Assert
        self.assertTrue(result["valid"])
        self.assertEqual(result["assumed_role_arn"], "assumed_machine_role_arn")
        mock_boto_client.assert_called_once_with(
            "sts", region_name="us-east-1"
        )  # Default region
        mock_sts_client.assume_role.assert_called_once_with(
            RoleArn=role_arn,
            RoleSessionName="phase-validation-session",
            # No ExternalId
        )

    def _setup_assume_role_failure_mocks(
        self, mock_validate_auth, mock_get_secret, mock_boto_client, exception_to_raise
    ):
        mock_validate_auth.return_value = {"valid": True}
        mock_get_secret.return_value = (
            None  # Use machine roles for simplicity in these failure cases
        )
        mock_sts_client = MagicMock()
        if isinstance(
            exception_to_raise, str
        ):  # Simulate ClientError with specific message
            error_response = {
                "Error": {"Code": "TestException", "Message": exception_to_raise}
            }
            mock_sts_client.assume_role.side_effect = ClientError(
                error_response, "assume_role"
            )
        else:
            mock_sts_client.assume_role.side_effect = exception_to_raise
        mock_boto_client.return_value = mock_sts_client
        return mock_sts_client

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_failure_access_denied(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        role_arn = "test_role_arn"
        self._setup_assume_role_failure_mocks(
            mock_validate_auth,
            mock_get_secret,
            mock_boto_client,
            "AccessDenied test message",
        )
        result = validate_aws_assume_role_credentials(role_arn)
        self.assertFalse(result["valid"])
        self.assertIn("Access denied when assuming role", result["message"])
        self.assertIn("AccessDenied test message", result["error"])

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_failure_invalid_user_id(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        role_arn = "test_role_arn"
        self._setup_assume_role_failure_mocks(
            mock_validate_auth,
            mock_get_secret,
            mock_boto_client,
            "InvalidUserID.NotFound test message",
        )
        result = validate_aws_assume_role_credentials(role_arn)
        self.assertFalse(result["valid"])
        self.assertIn("The specified role ARN was not found", result["message"])
        self.assertIn("InvalidUserID.NotFound test message", result["error"])

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_failure_external_id(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        role_arn = "test_role_arn"
        self._setup_assume_role_failure_mocks(
            mock_validate_auth,
            mock_get_secret,
            mock_boto_client,
            "external id validation failed",
        )
        result = validate_aws_assume_role_credentials(role_arn)
        self.assertFalse(result["valid"])
        self.assertIn("External ID validation failed", result["message"])
        self.assertIn("external id validation failed", result["error"])

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_failure_other_client_error(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        role_arn = "test_role_arn"
        self._setup_assume_role_failure_mocks(
            mock_validate_auth,
            mock_get_secret,
            mock_boto_client,
            "Some other ClientError",
        )
        result = validate_aws_assume_role_credentials(role_arn)
        self.assertFalse(result["valid"])
        expected_message = "Role assumption failed: An error occurred (TestException) when calling the assume_role operation: Some other ClientError"
        self.assertEqual(result["message"], expected_message)
        self.assertIn("Some other ClientError", result["error"])

    @patch("api.utils.syncing.aws.auth.boto3.client")
    @patch("api.utils.syncing.aws.auth.get_secret")
    @patch("api.utils.syncing.aws.auth.validate_aws_assume_role_auth")
    def test_validate_aws_assume_role_credentials_failure_non_client_exception(
        self, mock_validate_auth, mock_get_secret, mock_boto_client
    ):
        role_arn = "test_role_arn"
        self._setup_assume_role_failure_mocks(
            mock_validate_auth,
            mock_get_secret,
            mock_boto_client,
            Exception("Non-ClientError Exception"),
        )
        result = validate_aws_assume_role_credentials(role_arn)
        self.assertFalse(result["valid"])
        self.assertIn(
            "Role assumption failed: Non-ClientError Exception", result["message"]
        )
        self.assertEqual("Non-ClientError Exception", result["error"])


if __name__ == "__main__":
    unittest.main()
