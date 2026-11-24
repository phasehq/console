"""Lease listing is bound to the environment the request was authenticated
for, whichever secret the query names."""

import uuid
from unittest.mock import Mock, patch

import pytest
from rest_framework import status
from rest_framework.test import APIRequestFactory, force_authenticate

from ee.integrations.secrets.dynamic.rest import views
from ee.integrations.secrets.dynamic.rest.views import DynamicSecretLeaseView


class _NotFound(Exception):
    pass


@pytest.fixture
def lease_view():
    org_member = Mock(id=uuid.uuid4())
    environment = Mock(id=uuid.uuid4())
    auth = {
        "token": "Bearer User test_token",
        "auth_type": "User",
        "app": environment.app,
        "environment": environment,
        "org_member": org_member,
        "service_account": None,
        "service_account_token": None,
    }

    def call(secret_id):
        request = APIRequestFactory().get("/", {"secret_id": secret_id})
        user = Mock(is_authenticated=True, is_active=True)
        force_authenticate(request, user=user, token=auth)
        return DynamicSecretLeaseView.as_view()(request)

    with patch.object(views, "DynamicSecret") as secret_model, patch.object(
        views, "DynamicSecretLease"
    ) as lease_model, patch.object(
        views, "DynamicSecretLeaseSerializer"
    ) as serializer, patch.object(
        views, "user_has_permission", return_value=True
    ), patch.object(
        views, "get_request_principal", return_value=(org_member, False)
    ), patch.object(
        views.IsIPAllowed, "has_permission", return_value=True
    ), patch.object(
        views.PlanBasedRateThrottle, "allow_request", return_value=True
    ):
        secret_model.DoesNotExist = _NotFound
        serializer.return_value.data = [{"name": "lease"}]
        call.environment = environment
        call.secret_model = secret_model
        call.lease_model = lease_model
        yield call


def test_looks_the_secret_up_in_the_authenticated_environment(lease_view):
    response = lease_view("secret-1")

    assert response.status_code == status.HTTP_200_OK
    lease_view.secret_model.objects.get.assert_called_once_with(
        id="secret-1", environment=lease_view.environment
    )
    lease_view.lease_model.objects.filter.assert_called_once_with(
        secret=lease_view.secret_model.objects.get.return_value
    )


def test_a_secret_of_another_environment_is_not_found(lease_view):
    # Another organisation's, or one pending deletion: the caller's access
    # was checked for the authenticated environment only.
    lease_view.secret_model.objects.get.side_effect = _NotFound

    response = lease_view("someone-elses-secret")

    assert response.status_code == status.HTTP_404_NOT_FOUND
    lease_view.lease_model.objects.filter.assert_not_called()
