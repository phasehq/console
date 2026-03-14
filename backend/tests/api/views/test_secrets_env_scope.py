import pytest
import json
from unittest.mock import MagicMock, patch, PropertyMock
from django.http import JsonResponse
from rest_framework.test import APIRequestFactory
from api.views.secrets import E2EESecretsView


class TestE2EESecretsViewEnvironmentScoping:
    """Tests that secret PUT/DELETE operations are scoped to the authenticated environment."""

    def _make_authed_request(self, method, env_id, body=None, auth_env=None):
        """Helper to create a request with mocked auth."""
        factory = APIRequestFactory()
        if method == "PUT":
            request = factory.put(
                "/secrets/",
                data=json.dumps(body),
                content_type="application/json",
            )
        elif method == "DELETE":
            request = factory.delete(
                "/secrets/",
                data=json.dumps(body),
                content_type="application/json",
            )
        else:
            request = factory.get("/secrets/")

        request.META["HTTP_ENVIRONMENT"] = str(env_id)
        request.META["HTTP_HOST"] = "localhost"

        # Mock auth
        mock_env = MagicMock()
        mock_env.id = auth_env or env_id
        mock_env.app.organisation = MagicMock()
        mock_env.app.sse_enabled = False

        request.auth = {
            "auth_type": "User",
            "environment": mock_env,
            "org_member": MagicMock(),
            "service_token": None,
            "service_account_token": None,
            "service_account": None,
        }
        request.user = MagicMock()
        return request, mock_env

    @patch("api.views.secrets.log_secret_event")
    @patch("api.views.secrets.SecretTag")
    @patch("api.views.secrets.validate_encrypted_string", return_value=True)
    @patch("api.views.secrets.check_for_duplicates_blind", return_value=False)
    @patch("api.views.secrets.Environment")
    @patch("api.views.secrets.Secret")
    def test_put_rejects_secret_from_different_environment(
        self, MockSecret, MockEnv, mock_dup, mock_validate, MockTag, mock_log
    ):
        """PUT must reject secrets that belong to a different environment."""
        import uuid

        auth_env_id = uuid.uuid4()
        other_env_id = uuid.uuid4()
        secret_id = uuid.uuid4()

        # Secret belongs to other_env_id, not auth_env_id
        mock_secret_obj = MagicMock()
        mock_secret_obj.environment_id = other_env_id
        mock_secret_obj.version = 1
        MockSecret.objects.get.return_value = mock_secret_obj

        mock_env = MagicMock()
        mock_env.id = auth_env_id
        MockEnv.objects.get.return_value = mock_env

        request, _ = self._make_authed_request(
            "PUT",
            auth_env_id,
            body={
                "secrets": [
                    {
                        "id": str(secret_id),
                        "key": "ph:v1:" + "a" * 64 + ":test",
                        "keyDigest": "digest",
                        "value": "ph:v1:" + "b" * 64 + ":val",
                        "comment": "",
                        "tags": [],
                        "path": "/",
                    }
                ]
            },
        )
        request.auth["environment"] = mock_env

        view = E2EESecretsView()
        view.request = request
        response = view.put(request)

        assert response.status_code == 403

    @patch("api.views.secrets.log_secret_event")
    @patch("api.views.secrets.Secret")
    def test_delete_only_deletes_secrets_in_authenticated_environment(
        self, MockSecret, mock_log
    ):
        """DELETE must filter secrets by the authenticated environment."""
        import uuid

        auth_env_id = uuid.uuid4()
        secret_id = uuid.uuid4()

        mock_env = MagicMock()
        mock_env.id = auth_env_id

        # Return empty queryset (secret doesn't belong to this env)
        mock_qs = MagicMock()
        mock_qs.exists.return_value = False
        MockSecret.objects.filter.return_value = mock_qs

        request, _ = self._make_authed_request(
            "DELETE",
            auth_env_id,
            body={"secrets": [str(secret_id)]},
        )
        request.auth["environment"] = mock_env

        view = E2EESecretsView()
        view.request = request
        response = view.delete(request)

        # Verify the filter included environment scoping
        MockSecret.objects.filter.assert_called_once_with(
            id__in=[str(secret_id)], environment=mock_env
        )

    @patch("api.views.secrets.log_secret_event")
    @patch("api.views.secrets.SecretTag")
    @patch("api.views.secrets.validate_encrypted_string", return_value=True)
    @patch("api.views.secrets.check_for_duplicates_blind", return_value=False)
    @patch("api.views.secrets.Environment")
    @patch("api.views.secrets.Secret")
    def test_put_allows_secret_from_same_environment(
        self, MockSecret, MockEnv, mock_dup, mock_validate, MockTag, mock_log
    ):
        """PUT must allow updates to secrets that belong to the authenticated environment."""
        import uuid

        env_id = uuid.uuid4()
        secret_id = uuid.uuid4()

        mock_secret_obj = MagicMock()
        mock_secret_obj.environment_id = env_id
        mock_secret_obj.version = 1
        mock_secret_obj.key = "ph:v1:" + "a" * 64 + ":test"
        mock_secret_obj.key_digest = "digest"
        mock_secret_obj.value = "ph:v1:" + "b" * 64 + ":val"
        mock_secret_obj.comment = ""
        MockSecret.objects.get.return_value = mock_secret_obj

        mock_env = MagicMock()
        mock_env.id = env_id
        mock_env.app.organisation = MagicMock()
        MockEnv.objects.get.return_value = mock_env
        MockTag.objects.filter.return_value = []

        request, _ = self._make_authed_request(
            "PUT",
            env_id,
            body={
                "secrets": [
                    {
                        "id": str(secret_id),
                        "key": "ph:v1:" + "a" * 64 + ":test",
                        "keyDigest": "digest",
                        "value": "ph:v1:" + "b" * 64 + ":val",
                        "comment": "",
                        "tags": [],
                        "path": "/",
                    }
                ]
            },
        )
        request.auth["environment"] = mock_env

        view = E2EESecretsView()
        view.request = request
        response = view.put(request)

        assert response.status_code == 200
