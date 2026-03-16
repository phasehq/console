import unittest
from unittest.mock import patch, MagicMock

from api.utils.syncing.azure.auth import (
    get_azure_client_credential,
    get_kv_client,
    get_azure_credential,
)


class TestGetAzureClientCredential(unittest.TestCase):

    @patch("api.utils.syncing.azure.auth.ClientSecretCredential")
    def test_returns_credential_with_correct_params(self, mock_csc):
        mock_csc.return_value = "mock_credential"
        result = get_azure_client_credential("tid", "cid", "csecret")

        self.assertEqual(result, "mock_credential")
        mock_csc.assert_called_once_with(
            tenant_id="tid",
            client_id="cid",
            client_secret="csecret",
        )


class TestGetKvClient(unittest.TestCase):

    @patch("api.utils.syncing.azure.auth.SecretClient")
    def test_returns_client_with_correct_params(self, mock_sc):
        mock_sc.return_value = "mock_client"
        mock_cred = MagicMock()
        result = get_kv_client(mock_cred, "https://myvault.vault.azure.net")

        self.assertEqual(result, "mock_client")
        mock_sc.assert_called_once_with(
            vault_url="https://myvault.vault.azure.net",
            credential=mock_cred,
        )


class TestGetAzureCredential(unittest.TestCase):

    @patch("api.utils.syncing.azure.auth.decrypt_asymmetric")
    @patch("api.utils.syncing.azure.auth.get_server_keypair")
    def test_decrypts_all_credential_fields(
        self, mock_get_server_keypair, mock_decrypt
    ):
        mock_pk, mock_sk = MagicMock(), MagicMock()
        mock_pk.hex.return_value = "pk_hex"
        mock_sk.hex.return_value = "sk_hex"
        mock_get_server_keypair.return_value = (mock_pk, mock_sk)

        decrypted_map = {
            "enc_tenant": "decrypted_tenant",
            "enc_client_id": "decrypted_client_id",
            "enc_client_secret": "decrypted_client_secret",
        }
        mock_decrypt.side_effect = lambda val, sk, pk: decrypted_map.get(val)

        mock_env_sync = MagicMock()
        mock_env_sync.authentication.credentials = {
            "tenant_id": "enc_tenant",
            "client_id": "enc_client_id",
            "client_secret": "enc_client_secret",
        }

        result = get_azure_credential(mock_env_sync)

        self.assertEqual(result, {
            "tenant_id": "decrypted_tenant",
            "client_id": "decrypted_client_id",
            "client_secret": "decrypted_client_secret",
        })
        self.assertEqual(mock_decrypt.call_count, 3)
        mock_get_server_keypair.assert_called_once()


if __name__ == "__main__":
    unittest.main()
