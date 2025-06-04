import unittest
from unittest.mock import patch, MagicMock
from botocore.exceptions import ClientError
import json

from api.utils.syncing.aws.secrets_manager import (
    get_secrets_client_from_session,
    list_aws_secrets,
    sync_aws_secrets,
)


class TestSecretsManager(unittest.TestCase):

    def test_get_secrets_client_from_session(self):
        # Arrange
        mock_session = MagicMock()
        mock_sm_client = MagicMock()
        mock_session.client.return_value = mock_sm_client

        # Act
        sm_client = get_secrets_client_from_session(mock_session)

        # Assert
        mock_session.client.assert_called_once_with("secretsmanager")
        self.assertEqual(sm_client, mock_sm_client)

    @patch("api.utils.syncing.aws.secrets_manager.get_secrets_client_from_session")
    @patch("api.utils.syncing.aws.secrets_manager.get_aws_sts_session")
    def test_list_aws_secrets_with_role_arn_success(
        self, mock_get_aws_sts_session, mock_get_secrets_client_from_session
    ):
        # Arrange
        mock_region = "eu-central-1"
        mock_role_arn = "arn:aws:iam::123456789012:role/TestRole"
        mock_external_id = (
            "ccd754c9cb5e95f8e58c361e5269bcd77367b6eb57ae69c0ede2226b03cf2980"
        )

        mock_session_instance = MagicMock()
        mock_get_aws_sts_session.return_value = mock_session_instance

        mock_secrets_client = MagicMock()
        mock_get_secrets_client_from_session.return_value = mock_secrets_client

        mock_paginator = MagicMock()
        mock_secrets_client.get_paginator.return_value = mock_paginator

        page1_secrets = [
            {"Name": "secret1", "ARN": "arn1"},
            {"Name": "secret2", "ARN": "arn2"},
        ]
        page2_secrets = [{"Name": "secret3", "ARN": "arn3"}]
        mock_paginator.paginate.return_value = [
            {"SecretList": page1_secrets},
            {"SecretList": page2_secrets},
        ]

        expected_secrets_list = [
            {"name": "secret1", "arn": "arn1"},
            {"name": "secret2", "arn": "arn2"},
            {"name": "secret3", "arn": "arn3"},
        ]

        # Act
        secrets_list = list_aws_secrets(
            region=mock_region, role_arn=mock_role_arn, external_id=mock_external_id
        )

        # Assert
        mock_get_aws_sts_session.assert_called_once_with(
            mock_role_arn, mock_region, mock_external_id
        )
        mock_get_secrets_client_from_session.assert_called_once_with(
            mock_session_instance
        )
        mock_secrets_client.get_paginator.assert_called_once_with("list_secrets")
        mock_paginator.paginate.assert_called_once()
        self.assertEqual(secrets_list, expected_secrets_list)

    @patch("api.utils.syncing.aws.secrets_manager.get_client")
    def test_list_aws_secrets_with_access_keys_success(self, mock_get_client):
        # Arrange
        mock_region = "eu-central-1"
        mock_access_key_id = "AKIA2OGYBAH63UA3VNFG"
        mock_secret_access_key = "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"

        mock_secrets_client = MagicMock()
        mock_get_client.return_value = mock_secrets_client

        mock_paginator = MagicMock()
        mock_secrets_client.get_paginator.return_value = mock_paginator

        page_secrets = [{"Name": "secret_key_1", "ARN": "arn_key_1"}]
        mock_paginator.paginate.return_value = [{"SecretList": page_secrets}]

        expected_secrets_list = [{"name": "secret_key_1", "arn": "arn_key_1"}]

        # Act
        secrets_list = list_aws_secrets(
            region=mock_region,
            AWS_ACCESS_KEY_ID=mock_access_key_id,
            AWS_SECRET_ACCESS_KEY=mock_secret_access_key,
        )

        # Assert
        mock_get_client.assert_called_once_with(
            mock_access_key_id, mock_secret_access_key, mock_region
        )
        mock_secrets_client.get_paginator.assert_called_once_with("list_secrets")
        mock_paginator.paginate.assert_called_once()
        self.assertEqual(secrets_list, expected_secrets_list)

    def test_list_aws_secrets_no_auth_provided(self):
        # Arrange
        mock_region = "ap-south-1"

        # Act & Assert
        with self.assertRaisesRegex(
            Exception, "Please provide either assume role parameters or access keys."
        ):
            list_aws_secrets(region=mock_region)

    @patch("api.utils.syncing.aws.secrets_manager.get_client")
    def test_list_aws_secrets_client_error(self, mock_get_client):
        # Arrange
        mock_region = "ca-central-1"
        mock_access_key_id = "test_key_id_fail"
        mock_secret_access_key = "test_secret_key_fail"

        mock_secrets_client = MagicMock()
        mock_get_client.return_value = mock_secrets_client

        error_response = {
            "Error": {"Code": "AccessDenied", "Message": "User not authorized"}
        }
        mock_secrets_client.get_paginator.side_effect = ClientError(
            error_response, "list_secrets"
        )

        # Act & Assert
        expected_error_message = "Failed to list AWS Secrets: An error occurred \\(AccessDenied\\) when calling the list_secrets operation: User not authorized"
        with self.assertRaisesRegex(Exception, expected_error_message):
            list_aws_secrets(
                region=mock_region,
                AWS_ACCESS_KEY_ID=mock_access_key_id,
                AWS_SECRET_ACCESS_KEY=mock_secret_access_key,
            )
        mock_get_client.assert_called_once_with(
            mock_access_key_id, mock_secret_access_key, mock_region
        )

    @patch("api.utils.syncing.aws.secrets_manager.get_secrets_client_from_session")
    @patch("api.utils.syncing.aws.secrets_manager.get_aws_sts_session")
    def test_sync_aws_secrets_with_role_arn_update_by_arn_success(
        self, mock_get_aws_sts_session, mock_get_secrets_client_from_session
    ):
        # Arrange
        mock_region = "us-west-2"
        mock_role_arn = "arn:aws:iam::123456789012:role/SyncRole"
        mock_external_id = (
            "ccd754c9cb5e95f8e58c361e5269bcd77367b6eb57ae69c0ede2226b03cf2980"
        )
        mock_secrets_to_sync = [("key1", "value1", None), ("key2", "value2", None)]
        mock_arn = (
            "arn:aws:secretsmanager:us-west-2:123456789012:secret:MySecret-xxxxxx"
        )
        mock_kms_id = "alias/myKmsCMKKey"

        mock_session_instance = MagicMock()
        mock_get_aws_sts_session.return_value = mock_session_instance
        mock_sm_client = MagicMock()
        mock_get_secrets_client_from_session.return_value = mock_sm_client

        expected_secret_string = json.dumps({"key1": "value1", "key2": "value2"})

        # Act
        success, result = sync_aws_secrets(
            secrets=mock_secrets_to_sync,
            region=mock_region,
            secret_name=None,  # Testing update by ARN
            arn=mock_arn,
            kms_id=mock_kms_id,
            role_arn=mock_role_arn,
            external_id=mock_external_id,
        )

        # Assert
        self.assertTrue(success)
        self.assertEqual(
            result, {"message": f"Secret '{mock_arn}' updated with provided secrets."}
        )
        mock_get_aws_sts_session.assert_called_once_with(
            mock_role_arn, mock_region, mock_external_id
        )
        mock_get_secrets_client_from_session.assert_called_once_with(
            mock_session_instance
        )
        mock_sm_client.update_secret.assert_called_once_with(
            SecretId=mock_arn, SecretString=expected_secret_string, KmsKeyId=mock_kms_id
        )
        mock_sm_client.create_secret.assert_not_called()
        mock_sm_client.get_secret_value.assert_not_called()

    @patch("api.utils.syncing.aws.secrets_manager.get_client")
    def test_sync_aws_secrets_with_access_keys_create_by_name_success(
        self, mock_get_client
    ):
        # Arrange
        mock_region = "eu-central-1"
        mock_access_key_id = "AKIA2OGYBAH63UA3VNFG"
        mock_secret_access_key = "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"
        mock_secrets_to_sync = [("new_key", "new_value", None)]
        mock_secret_name = "MyNewSecret"

        mock_sm_client = MagicMock()
        mock_get_client.return_value = mock_sm_client

        # Simulate secret not found, so it gets created
        # Set .exceptions.ResourceNotFoundException to the TYPE ClientError
        mock_sm_client.exceptions = MagicMock()  # Ensure .exceptions attribute exists
        mock_sm_client.exceptions.ResourceNotFoundException = ClientError
        # Make get_secret_value raise an INSTANCE of ClientError that simulates "ResourceNotFoundException"
        resource_not_found_error_instance = ClientError(
            error_response={
                "Error": {
                    "Code": "ResourceNotFoundException",
                    "Message": "Secret not found",
                }
            },
            operation_name="get_secret_value",
        )
        mock_sm_client.get_secret_value.side_effect = resource_not_found_error_instance

        expected_secret_string = json.dumps({"new_key": "new_value"})

        # Act
        success, result = sync_aws_secrets(
            secrets=mock_secrets_to_sync,
            region=mock_region,
            secret_name=mock_secret_name,
            arn=None,  # Testing create by name
            AWS_ACCESS_KEY_ID=mock_access_key_id,
            AWS_SECRET_ACCESS_KEY=mock_secret_access_key,
        )

        # Assert
        self.assertTrue(success)
        self.assertEqual(
            result, {"message": f"New secret '{mock_secret_name}' created."}
        )
        mock_get_client.assert_called_once_with(
            mock_access_key_id, mock_secret_access_key, mock_region
        )
        mock_sm_client.get_secret_value.assert_called_once_with(
            SecretId=mock_secret_name
        )
        mock_sm_client.create_secret.assert_called_once_with(
            Name=mock_secret_name,
            SecretString=expected_secret_string,
            # KmsKeyId not provided in this test case
        )
        mock_sm_client.update_secret.assert_not_called()

    @patch("api.utils.syncing.aws.secrets_manager.get_client")
    def test_sync_aws_secrets_with_access_keys_update_by_name_success(
        self, mock_get_client
    ):
        # Arrange
        mock_region = "ap-northeast-1"
        mock_access_key_id = "AKIA2OGYBAH63UA3VNFG"
        mock_secret_access_key = "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"
        mock_secrets_to_sync = [("updated_key", "updated_value", None)]
        mock_secret_name = "MyExistingSecret"
        mock_kms_id = "kms_for_update"

        mock_sm_client = MagicMock()
        mock_get_client.return_value = mock_sm_client
        # Simulate secret found, so it gets updated
        mock_sm_client.get_secret_value.return_value = {"SecretString": "old_value"}
        # Define .exceptions.ResourceNotFoundException to the TYPE ClientError for the try-except block in source
        mock_sm_client.exceptions = MagicMock()
        mock_sm_client.exceptions.ResourceNotFoundException = ClientError

        expected_secret_string = json.dumps({"updated_key": "updated_value"})

        # Act
        success, result = sync_aws_secrets(
            secrets=mock_secrets_to_sync,
            region=mock_region,
            secret_name=mock_secret_name,
            arn=None,  # Testing update by name
            kms_id=mock_kms_id,
            AWS_ACCESS_KEY_ID=mock_access_key_id,
            AWS_SECRET_ACCESS_KEY=mock_secret_access_key,
        )

        # Assert
        self.assertTrue(success)
        self.assertEqual(
            result, {"message": f"Existing secret '{mock_secret_name}' updated."}
        )
        mock_get_client.assert_called_once_with(
            mock_access_key_id, mock_secret_access_key, mock_region
        )
        mock_sm_client.get_secret_value.assert_called_once_with(
            SecretId=mock_secret_name
        )
        mock_sm_client.update_secret.assert_called_once_with(
            SecretId=mock_secret_name,
            SecretString=expected_secret_string,
            KmsKeyId=mock_kms_id,
        )
        mock_sm_client.create_secret.assert_not_called()

    def test_sync_aws_secrets_no_auth_provided(self):
        # Arrange
        mock_secrets = [("k", "v", None)]
        mock_region = "sa-east-1"
        mock_secret_name = "SomeName"

        # Act
        success, result = sync_aws_secrets(
            mock_secrets, mock_region, mock_secret_name, None
        )

        # Assert
        self.assertFalse(success)
        self.assertEqual(
            result,
            {"message": "Please provide either assume role parameters or access keys."},
        )

    def test_sync_aws_secrets_no_arn_or_name_provided(self):
        # Arrange
        mock_secrets = [("k", "v", None)]
        mock_region = "us-east-2"

        # Act
        success, result = sync_aws_secrets(
            secrets=mock_secrets,
            region=mock_region,
            secret_name=None,
            arn=None,
            AWS_ACCESS_KEY_ID="AKIA2OGYBAH63UA3VNFG",  # Auth needed to bypass first check
            AWS_SECRET_ACCESS_KEY="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",
        )

        # Assert
        self.assertFalse(success)
        self.assertEqual(
            result, {"message": "Please provide either a secret ARN or a name."}
        )

    @patch("api.utils.syncing.aws.secrets_manager.get_client")
    def test_sync_aws_secrets_client_error_on_update(self, mock_get_client):
        # Arrange
        mock_region = "eu-north-1"
        mock_access_key_id = "error_key_id"
        mock_secret_access_key = "error_secret_key"
        mock_secrets_to_sync = [("key1", "value1", None)]
        mock_arn = "arn_to_fail_update"

        mock_sm_client = MagicMock()
        mock_get_client.return_value = mock_sm_client

        error_response = {
            "Error": {"Code": "InvalidRequestException", "Message": "Update failed"}
        }
        mock_sm_client.update_secret.side_effect = ClientError(
            error_response, "update_secret"
        )

        # Act
        success, result = sync_aws_secrets(
            secrets=mock_secrets_to_sync,
            region=mock_region,
            secret_name=None,
            arn=mock_arn,
            AWS_ACCESS_KEY_ID=mock_access_key_id,
            AWS_SECRET_ACCESS_KEY=mock_secret_access_key,
        )

        # Assert
        self.assertFalse(success)
        self.assertEqual(
            result, {"message": str(ClientError(error_response, "update_secret"))}
        )
        mock_sm_client.update_secret.assert_called_once()

    @patch("api.utils.syncing.aws.secrets_manager.get_client")  # Mock get_client
    @patch("api.utils.syncing.aws.secrets_manager.json.dumps")  # Mock json.dumps
    def test_sync_aws_secrets_unexpected_error(self, mock_json_dumps, mock_get_client):
        # Arrange
        mock_region = "ap-southeast-1"
        mock_access_key_id = "exp_key_id"
        mock_secret_access_key = "exp_secret_key"
        mock_secrets_to_sync = [("key1", "value1", None)]
        mock_secret_name = "SecretForUnexpectedError"

        mock_sm_client = MagicMock()
        mock_get_client.return_value = mock_sm_client

        mock_sm_client.get_secret_value.return_value = {"SecretString": "old_value"}
        # Define .exceptions.ResourceNotFoundException to the TYPE ClientError
        mock_sm_client.exceptions = MagicMock()
        mock_sm_client.exceptions.ResourceNotFoundException = ClientError

        mock_json_dumps.side_effect = TypeError("Unexpected JSON processing error")

        # Act
        success, result = sync_aws_secrets(
            secrets=mock_secrets_to_sync,
            region=mock_region,
            secret_name=mock_secret_name,
            arn=None,
            AWS_ACCESS_KEY_ID=mock_access_key_id,
            AWS_SECRET_ACCESS_KEY=mock_secret_access_key,
        )

        # Assert
        self.assertFalse(success)
        self.assertEqual(
            result,
            {
                "message": "An unexpected error occurred: Unexpected JSON processing error"
            },
        )
        mock_get_client.assert_called_once_with(
            mock_access_key_id, mock_secret_access_key, mock_region
        )
        mock_json_dumps.assert_called_once_with({"key1": "value1"})


if __name__ == "__main__":
    unittest.main()
