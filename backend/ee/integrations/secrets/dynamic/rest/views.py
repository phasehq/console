from api.auth import PhaseTokenAuthentication
from api.models import (
    DynamicSecret,
    DynamicSecretLease,
    OrganisationMember,
)
from api.utils.secrets import (
    normalize_path_string,
)
from api.utils.access.permissions import (
    user_has_permission,
)
from ee.integrations.secrets.dynamic.serializers import (
    DynamicSecretLeaseSerializer,
)
from api.utils.rest import (
    METHOD_TO_ACTION,
    get_resolver_request_meta,
)

from api.utils.access.middleware import IsIPAllowed
from ee.integrations.secrets.dynamic.aws.utils import (
    revoke_aws_dynamic_secret_lease,
)
from ee.integrations.secrets.dynamic.utils import (
    create_dynamic_secret_lease,
    renew_dynamic_secret_lease,
)
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import (
    CamelCaseJSONRenderer,
)
from rest_framework.exceptions import PermissionDenied, NotFound
import logging

logger = logging.getLogger(__name__)


class DynamicSecretsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    renderer_classes = [
        CamelCaseJSONRenderer,
    ]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        # Determine the action based on the request method
        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise PermissionDenied(f"Unsupported HTTP method: {request.method}")

        # Perform permission check
        account = None
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]

        if account is not None:
            env = request.auth["environment"]
            organisation = env.app.organisation

            if not user_has_permission(
                account,
                action,
                "Secrets",
                organisation,
                True,
                request.auth.get("service_account") is not None,
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} secrets in this environment."
                )

    def get(self, request, *args, **kwargs):
        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        ip_address, user_agent = get_resolver_request_meta(request)

        dynamic_secrets_filter = {
            "environment": env,
            "deleted_at": None,
        }

        try:
            path = request.GET.get("path")
            if path:
                path = normalize_path_string(path)
                dynamic_secrets_filter["path"] = path
        except:
            pass

        # Filter by secret id
        secret_id = request.GET.get("id")
        if secret_id:
            dynamic_secrets_filter["id"] = secret_id

        # Filter by secret name
        secret_name = request.GET.get("name")
        if secret_name:
            dynamic_secrets_filter["name"] = secret_name

        dynamic_secrets = DynamicSecret.objects.filter(**dynamic_secrets_filter)

        # 2. Create leases for each secret
        if request.auth["service_account_token"] is not None:
            service_account = request.auth["service_account_token"].service_account
        dynamic_leases = [
            create_dynamic_secret_lease(
                secret,
                organisation_member=request.auth["org_member"],
                service_account=service_account,
                request=request,
            )[0]
            for secret in dynamic_secrets
        ]

        if len(dynamic_leases) > 0:
            from ee.integrations.secrets.dynamic.serializers import (
                DynamicSecretLeaseSerializer,
            )

            dynamic_serializer = DynamicSecretLeaseSerializer(
                dynamic_leases, many=True, context={"sse": True}
            )

        return Response(
            {
                "dynamicSecrets": (
                    dynamic_serializer.data if len(dynamic_leases) > 0 else []
                ),
            },
            status=status.HTTP_200_OK,
        )


class DynamicSecretLeaseView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_account_and_org(self, request):
        account = None
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
        env = request.auth["environment"] if account is not None else None
        organisation = env.app.organisation if env is not None else None
        return account, organisation

    def _get_lease_or_404(self, lease_id: str) -> DynamicSecretLease:
        try:
            return DynamicSecretLease.objects.get(id=lease_id)
        except DynamicSecretLease.DoesNotExist:
            raise NotFound("Lease not found")

    def _assert_can_act_on_lease(self, request, lease: DynamicSecretLease, action: str):
        # action: "update" for renew, "delete" for revoke
        account, organisation = self._get_account_and_org(request)
        lease_holder = lease.organisation_member or lease.service_account
        if (
            lease_holder
            and hasattr(lease_holder, "id")
            and lease_holder.id == getattr(account, "id", None)
        ):
            return
        if not user_has_permission(
            account,
            action,
            "DynamicSecretLeases",
            organisation,
            True,
            request.auth.get("service_account") is not None,
        ):
            raise PermissionDenied(
                f"You don't have permission to {action} leases for other accounts."
            )

    # List leases
    def get(self, request, *args, **kwargs):
        secret_id = request.query_params.get("secret_id")
        if not secret_id:
            return Response({"error": "secret_id is required"}, status=400)

        account, organisation = self._get_account_and_org(request)

        if not user_has_permission(
            account,
            "read",
            "Secrets",
            organisation,
            True,
            request.auth.get("service_account") is not None,
        ):
            raise PermissionDenied(
                f"You don't have permission to read secrets in this environment."
            )

        try:
            secret = DynamicSecret.objects.get(id=secret_id)
        except DynamicSecret.DoesNotExist:
            return Response({"error": "Secret not found"}, status=404)

        leases_filter = {"secret": secret}

        # only return own leases if no permission to view all leases
        if not user_has_permission(
            account,
            "read",
            "DynamicSecretLeases",
            organisation,
            True,
            request.auth.get("service_account") is not None,
        ):
            if request.auth["org_member"] is not None:
                leases_filter["organisation_member"] = request.auth["org_member"]
            elif request.auth["service_account_token"] is not None:
                leases_filter["service_account"] = request.auth[
                    "service_account_token"
                ]["service_account"]

        leases = DynamicSecretLease.objects.filter(secret=secret).order_by(
            "-created_at"
        )
        serializer = DynamicSecretLeaseSerializer(
            leases, many=True, context={"sse": False}
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    # Renew
    def put(self, request, *args, **kwargs):
        lease_id = request.data.get("lease_id")
        ttl = request.data.get("ttl", 3600)
        if not lease_id:
            return Response({"error": "lease_id is required"}, status=400)

        lease = self._get_lease_or_404(lease_id)
        self._assert_can_act_on_lease(request, lease, action="update")

        org_member = service_account = None
        if request.auth["auth_type"] == "User":
            org_member = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            service_account = request.auth["service_account"]

        try:
            lease = renew_dynamic_secret_lease(
                lease,
                ttl,
                request=request,
                organisation_member=org_member or None,
                service_account=service_account or None,
            )
        except Exception as e:
            logger.exception(
                "Failed to renew dynamic secret lease (lease_id=%s)", lease_id
            )
            return Response(
                {"error": "An internal error occurred while renewing the lease."},
                status=400,
            )
        return Response(status=status.HTTP_200_OK)

    # Revoke
    def delete(self, request, *args, **kwargs):
        lease_id = request.data.get("lease_id") or request.query_params.get("lease_id")
        if not lease_id:
            return Response({"error": "lease_id is required"}, status=400)

        lease = self._get_lease_or_404(lease_id)
        self._assert_can_act_on_lease(request, lease, action="delete")

        org_member = service_account = None
        if request.auth["auth_type"] == "User":
            org_member = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            service_account = request.auth["service_account"]

        if lease.secret.provider == "aws":
            revoke_aws_dynamic_secret_lease(
                lease.id,
                manual=True,
                request=request,
                organisation_member=org_member,
                service_account=service_account,
            )

        return Response(status=status.HTTP_200_OK)
