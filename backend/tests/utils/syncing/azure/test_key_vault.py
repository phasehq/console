import unittest
import json
from unittest.mock import patch, MagicMock
from datetime import datetime
from azure.core.exceptions import HttpResponseError

from api.utils.syncing.azure.key_vault import (
    _transform_secret_name,
    _retry_on_rate_limit,
    list_kv_secrets,
    list_all_kv_secrets,
    list_deleted_kv_secrets,
    get_kv_secret,
    set_kv_secret,
    disable_kv_secret,
    enable_kv_secret,
    recover_kv_secret,
    sync_azure_kv_individual,
    sync_azure_kv_blob,
)


class TestTransformSecretName(unittest.TestCase):

    def test_underscores_replaced_with_hyphens(self):
        self.assertEqual(_transform_secret_name("MY_SECRET"), "MY-SECRET")

    def test_no_underscores_unchanged(self):
        self.assertEqual(_transform_secret_name("MY-SECRET"), "MY-SECRET")

    def test_multiple_underscores(self):
        self.assertEqual(_transform_secret_name("A_B_C_D"), "A-B-C-D")

    def test_empty_string(self):
        self.assertEqual(_transform_secret_name(""), "")


class TestRetryOnRateLimit(unittest.TestCase):

    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_success_no_retry(self, mock_sleep):
        func = MagicMock(return_value="ok")
        result = _retry_on_rate_limit(func, "arg1")
        self.assertEqual(result, "ok")
        func.assert_called_once_with("arg1")
        mock_sleep.assert_not_called()

    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_retries_on_429(self, mock_sleep):
        error_429 = HttpResponseError(message="rate limited")
        error_429.status_code = 429

        func = MagicMock(side_effect=[error_429, error_429, "ok"])
        result = _retry_on_rate_limit(func, "arg1")
        self.assertEqual(result, "ok")
        self.assertEqual(func.call_count, 3)
        mock_sleep.assert_any_call(1)  # 2^0
        mock_sleep.assert_any_call(2)  # 2^1
        self.assertEqual(mock_sleep.call_count, 2)

    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_raises_on_max_retries_exceeded(self, mock_sleep):
        error_429 = HttpResponseError(message="rate limited")
        error_429.status_code = 429

        func = MagicMock(side_effect=[error_429, error_429, error_429, error_429])
        with self.assertRaises(HttpResponseError):
            _retry_on_rate_limit(func, "arg1")
        self.assertEqual(func.call_count, 4)  # initial + 3 retries
        self.assertEqual(mock_sleep.call_count, 3)

    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_retries_on_409_conflict(self, mock_sleep):
        error_409 = HttpResponseError(message="conflict")
        error_409.status_code = 409

        func = MagicMock(side_effect=[error_409, "ok"])
        result = _retry_on_rate_limit(func, "arg1")
        self.assertEqual(result, "ok")
        self.assertEqual(func.call_count, 2)
        mock_sleep.assert_called_once_with(1)  # 2^0

    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_raises_immediately_on_non_retryable_error(self, mock_sleep):
        error_403 = HttpResponseError(message="forbidden")
        error_403.status_code = 403

        func = MagicMock(side_effect=error_403)
        with self.assertRaises(HttpResponseError):
            _retry_on_rate_limit(func)
        func.assert_called_once()
        mock_sleep.assert_not_called()


class TestListKvSecrets(unittest.TestCase):

    def test_returns_enabled_secrets_only(self):
        mock_client = MagicMock()
        now = datetime(2025, 1, 1, 12, 0, 0)

        enabled_secret = MagicMock()
        enabled_secret.name = "secret-1"
        enabled_secret.enabled = True
        enabled_secret.updated_on = now
        enabled_secret.content_type = "text/plain"

        disabled_secret = MagicMock()
        disabled_secret.name = "secret-2"
        disabled_secret.enabled = False
        disabled_secret.updated_on = now
        disabled_secret.content_type = None

        mock_client.list_properties_of_secrets.return_value = [
            enabled_secret,
            disabled_secret,
        ]

        result = list_kv_secrets(mock_client)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "secret-1")

    def test_empty_vault(self):
        mock_client = MagicMock()
        mock_client.list_properties_of_secrets.return_value = []
        self.assertEqual(list_kv_secrets(mock_client), [])

    def test_includes_metadata(self):
        mock_client = MagicMock()
        now = datetime(2025, 6, 15, 8, 30, 0)

        secret = MagicMock()
        secret.name = "my-secret"
        secret.enabled = True
        secret.updated_on = now
        secret.content_type = "application/json"

        mock_client.list_properties_of_secrets.return_value = [secret]

        result = list_kv_secrets(mock_client)
        self.assertEqual(result[0]["updated_on"], now)
        self.assertEqual(result[0]["content_type"], "application/json")


class TestListAllKvSecrets(unittest.TestCase):

    def test_returns_all_with_enabled_status(self):
        mock_client = MagicMock()

        s1 = MagicMock()
        s1.name = "enabled-secret"
        s1.enabled = True

        s2 = MagicMock()
        s2.name = "disabled-secret"
        s2.enabled = False

        mock_client.list_properties_of_secrets.return_value = [s1, s2]

        result = list_all_kv_secrets(mock_client)
        self.assertEqual(result, {"enabled-secret": True, "disabled-secret": False})

    def test_empty_vault(self):
        mock_client = MagicMock()
        mock_client.list_properties_of_secrets.return_value = []
        self.assertEqual(list_all_kv_secrets(mock_client), {})


class TestListDeletedKvSecrets(unittest.TestCase):

    def test_returns_deleted_secret_names(self):
        mock_client = MagicMock()
        d1 = MagicMock()
        d1.name = "old-secret"
        mock_client.list_deleted_secrets.return_value = [d1]
        self.assertEqual(list_deleted_kv_secrets(mock_client), ["old-secret"])


class TestGetKvSecret(unittest.TestCase):

    def test_returns_secret_value(self):
        mock_client = MagicMock()
        mock_secret = MagicMock()
        mock_secret.value = "super-secret-value"
        mock_client.get_secret.return_value = mock_secret
        self.assertEqual(get_kv_secret(mock_client, "my-secret"), "super-secret-value")
        mock_client.get_secret.assert_called_once_with("my-secret")


class TestSetKvSecret(unittest.TestCase):

    def test_sets_secret_without_content_type(self):
        mock_client = MagicMock()
        set_kv_secret(mock_client, "my-secret", "my-value")
        mock_client.set_secret.assert_called_once_with("my-secret", "my-value")

    def test_sets_secret_with_content_type(self):
        mock_client = MagicMock()
        set_kv_secret(mock_client, "my-secret", "my-value", content_type="application/json")
        mock_client.set_secret.assert_called_once_with(
            "my-secret", "my-value", content_type="application/json"
        )


class TestDisableKvSecret(unittest.TestCase):

    def test_disables_secret(self):
        mock_client = MagicMock()
        disable_kv_secret(mock_client, "my-secret")
        mock_client.update_secret_properties.assert_called_once_with(
            "my-secret", enabled=False
        )


class TestEnableKvSecret(unittest.TestCase):

    def test_enables_secret(self):
        mock_client = MagicMock()
        enable_kv_secret(mock_client, "my-secret")
        mock_client.update_secret_properties.assert_called_once_with(
            "my-secret", enabled=True
        )


class TestRecoverKvSecret(unittest.TestCase):

    def test_recovers_and_waits(self):
        mock_client = MagicMock()
        mock_poller = MagicMock()
        mock_client.begin_recover_deleted_secret.return_value = mock_poller
        recover_kv_secret(mock_client, "my-secret")
        mock_client.begin_recover_deleted_secret.assert_called_once_with("my-secret")
        mock_poller.wait.assert_called_once()


class TestSyncAzureKvIndividual(unittest.TestCase):

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_all_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_syncs_secrets_successfully(
        self,
        mock_sleep,
        mock_set,
        mock_list_deleted,
        mock_list_all,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_all.return_value = {}
        mock_list_deleted.return_value = []

        secrets = [("DB_HOST", "localhost", ""), ("DB_PORT", "5432", "")]
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertTrue(success)
        self.assertEqual(mock_set.call_count, 2)
        mock_get_cred.assert_called_once_with("tid", "cid", "csecret")
        mock_get_client.assert_called_once()

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    def test_name_collision_returns_error(self, mock_get_cred, mock_get_client):
        # MY_KEY and MY-KEY both map to MY-KEY
        secrets = [("MY_KEY", "v1", ""), ("MY-KEY", "v2", "")]
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertFalse(success)
        self.assertIn("collision", result["message"].lower())
        # Should fail before calling Azure
        mock_get_cred.assert_not_called()

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_all_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.disable_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_disables_secrets_not_in_phase(
        self,
        mock_sleep,
        mock_disable,
        mock_list_deleted,
        mock_list_all,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_all.return_value = {"FOO": True}
        mock_list_deleted.return_value = []

        secrets = []  # No Phase secrets
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertTrue(success)
        mock_disable.assert_called_once()
        self.assertEqual(mock_disable.call_args[0][1], "FOO")

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_all_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.recover_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_recovers_soft_deleted_secrets(
        self,
        mock_sleep,
        mock_set,
        mock_recover,
        mock_list_deleted,
        mock_list_all,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_all.return_value = {}
        mock_list_deleted.return_value = ["MY-SECRET"]

        secrets = [("MY_SECRET", "val", "")]
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertTrue(success)
        mock_recover.assert_called_once()
        self.assertEqual(mock_recover.call_args[0][1], "MY-SECRET")

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_all_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.enable_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_re_enables_disabled_secrets(
        self,
        mock_sleep,
        mock_set,
        mock_enable,
        mock_list_deleted,
        mock_list_all,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_all.return_value = {"MY-SECRET": False}  # disabled
        mock_list_deleted.return_value = []

        secrets = [("MY_SECRET", "val", "")]
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertTrue(success)
        mock_enable.assert_called_once()
        self.assertEqual(mock_enable.call_args[0][1], "MY-SECRET")

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_all_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.disable_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_empty_secrets_disables_all_existing(
        self,
        mock_sleep,
        mock_disable,
        mock_list_deleted,
        mock_list_all,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_all.return_value = {"SECRET-A": True, "SECRET-B": True}
        mock_list_deleted.return_value = []

        secrets = []
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertTrue(success)
        self.assertEqual(mock_disable.call_count, 2)

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_all_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_per_secret_error_identifies_failing_secret(
        self,
        mock_sleep,
        mock_set,
        mock_list_deleted,
        mock_list_all,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_all.return_value = {}
        mock_list_deleted.return_value = []

        error = HttpResponseError(message="bad request")
        error.status_code = 400
        mock_set.side_effect = [None, error]  # first succeeds, second fails

        secrets = [("GOOD_KEY", "val1", ""), ("BAD_KEY", "val2", "")]
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertFalse(success)
        self.assertIn("BAD-KEY", result["message"])
        self.assertIn("invalid characters", result["message"])

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    def test_http_response_error_returns_sanitized_message(
        self, mock_get_cred, mock_get_client
    ):
        error = HttpResponseError(message="detailed azure internal error")
        error.status_code = 403
        mock_get_client.side_effect = error

        secrets = [("KEY", "val", "")]
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertFalse(success)
        self.assertIn("HTTP 403", result["message"])
        self.assertIn("service principal", result["message"])
        self.assertNotIn("detailed azure internal error", result["message"])

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    def test_unexpected_error_returns_sanitized_message(
        self, mock_get_cred, mock_get_client
    ):
        mock_get_client.side_effect = RuntimeError("something broke internally")

        secrets = [("KEY", "val", "")]
        success, result = sync_azure_kv_individual(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net"
        )

        self.assertFalse(success)
        self.assertIn("unexpected error", result["message"].lower())
        self.assertNotIn("something broke internally", result["message"])


class TestSyncAzureKvBlob(unittest.TestCase):

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_syncs_blob_successfully(
        self,
        mock_sleep,
        mock_set,
        mock_list_deleted,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_deleted.return_value = []

        secrets = [("DB_HOST", "localhost", ""), ("DB_PORT", "5432", "")]
        success, result = sync_azure_kv_blob(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net", "my-blob"
        )

        self.assertTrue(success)
        mock_set.assert_called_once()
        call_args = mock_set.call_args
        # Verify JSON content and content_type
        blob_value = call_args[0][2]
        self.assertEqual(json.loads(blob_value), {"DB_HOST": "localhost", "DB_PORT": "5432"})
        self.assertEqual(call_args[1]["content_type"], "application/json")

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.recover_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_recovers_deleted_blob_secret(
        self,
        mock_sleep,
        mock_set,
        mock_recover,
        mock_list_deleted,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_deleted.return_value = ["my-blob"]

        secrets = [("KEY", "val", "")]
        success, result = sync_azure_kv_blob(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net", "my-blob"
        )

        self.assertTrue(success)
        mock_recover.assert_called_once()
        self.assertEqual(mock_recover.call_args[0][1], "my-blob")

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_json_escaping(
        self,
        mock_sleep,
        mock_set,
        mock_list_deleted,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_deleted.return_value = []

        secrets = [("KEY_WITH_QUOTES", 'value "with" quotes', ""), ("SPECIAL", "a\nb\\c", "")]
        success, result = sync_azure_kv_blob(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net", "my-blob"
        )

        self.assertTrue(success)
        blob_value = mock_set.call_args[0][2]
        parsed = json.loads(blob_value)
        self.assertEqual(parsed["KEY_WITH_QUOTES"], 'value "with" quotes')
        self.assertEqual(parsed["SPECIAL"], "a\nb\\c")

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    @patch("api.utils.syncing.azure.key_vault.list_deleted_kv_secrets")
    @patch("api.utils.syncing.azure.key_vault.set_kv_secret")
    @patch("api.utils.syncing.azure.key_vault.time.sleep")
    def test_empty_secrets_syncs_empty_json(
        self,
        mock_sleep,
        mock_set,
        mock_list_deleted,
        mock_get_cred,
        mock_get_client,
    ):
        mock_list_deleted.return_value = []

        secrets = []
        success, result = sync_azure_kv_blob(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net", "my-blob"
        )

        self.assertTrue(success)
        blob_value = mock_set.call_args[0][2]
        self.assertEqual(json.loads(blob_value), {})

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    def test_http_response_error_returns_sanitized_message(
        self, mock_get_cred, mock_get_client
    ):
        error = HttpResponseError(message="detailed azure internal error")
        error.status_code = 401
        mock_get_client.side_effect = error

        secrets = [("KEY", "val", "")]
        success, result = sync_azure_kv_blob(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net", "my-blob"
        )

        self.assertFalse(success)
        self.assertIn("HTTP 401", result["message"])
        self.assertIn("credentials", result["message"])
        self.assertNotIn("detailed azure internal error", result["message"])

    @patch("api.utils.syncing.azure.key_vault.get_kv_client")
    @patch("api.utils.syncing.azure.key_vault.get_azure_client_credential")
    def test_unexpected_error_returns_sanitized_message(
        self, mock_get_cred, mock_get_client
    ):
        mock_get_client.side_effect = RuntimeError("kaboom")

        secrets = [("KEY", "val", "")]
        success, result = sync_azure_kv_blob(
            secrets, "tid", "cid", "csecret", "https://myvault.vault.azure.net", "my-blob"
        )

        self.assertFalse(success)
        self.assertIn("unexpected error", result["message"].lower())
        self.assertNotIn("kaboom", result["message"])


if __name__ == "__main__":
    unittest.main()
