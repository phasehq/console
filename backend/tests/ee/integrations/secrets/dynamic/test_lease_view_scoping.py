"""Dynamic secret lease listing is scoped to the token's environment.

Authentication can resolve that environment from a Secret-Id header that differs
from the secret_id being listed, so the view must bind the lookup itself.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from api.models import DynamicSecret
from ee.integrations.secrets.dynamic.rest import views


def _make_request(env, secret_id):
    return SimpleNamespace(
        query_params={"secret_id": secret_id},
        auth={
            "auth_type": "User",
            "org_member": MagicMock(id="member-1"),
            "service_account": None,
            "environment": env,
        },
    )


@pytest.fixture
def lease_view(monkeypatch):
    token_env = MagicMock(id="env-token")
    other_env = MagicMock(id="env-other")
    secrets = {
        "ds-own": SimpleNamespace(id="ds-own", environment=token_env),
        "ds-other": SimpleNamespace(id="ds-other", environment=other_env),
    }

    def get_secret(**lookup):
        secret = secrets.get(lookup["id"])
        env = lookup.get("environment", secret.environment if secret else None)
        if secret is None or secret.environment is not env:
            raise DynamicSecret.DoesNotExist
        return secret

    mock_secret_model = MagicMock()
    mock_secret_model.DoesNotExist = DynamicSecret.DoesNotExist
    mock_secret_model.objects.get.side_effect = get_secret
    monkeypatch.setattr(views, "DynamicSecret", mock_secret_model)

    mock_lease_model = MagicMock()
    monkeypatch.setattr(views, "DynamicSecretLease", mock_lease_model)
    monkeypatch.setattr(views, "user_has_permission", MagicMock(return_value=True))
    monkeypatch.setattr(
        views,
        "DynamicSecretLeaseSerializer",
        MagicMock(return_value=SimpleNamespace(data=[])),
    )

    return SimpleNamespace(
        view=views.DynamicSecretLeaseView(),
        token_env=token_env,
        secrets=secrets,
        lease_model=mock_lease_model,
    )


def test_lists_leases_for_secret_in_token_environment(lease_view):
    request = _make_request(lease_view.token_env, "ds-own")

    response = lease_view.view.get(request)

    assert response.status_code == 200
    filters = lease_view.lease_model.objects.filter.call_args.kwargs
    assert filters["secret"] is lease_view.secrets["ds-own"]


def test_returns_not_found_for_secret_in_another_environment(lease_view):
    request = _make_request(lease_view.token_env, "ds-other")

    response = lease_view.view.get(request)

    assert response.status_code == 404
    lease_view.lease_model.objects.filter.assert_not_called()
