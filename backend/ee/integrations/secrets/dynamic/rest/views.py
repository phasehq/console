from api.auth import PhaseTokenAuthentication
from api.models import (
    DynamicSecret,
    DynamicSecretLease,
)
from api.utils.secrets import (
    normalize_path_string,
)
from api.utils.access.permissions import (
    user_has_permission,
)
from ee.integrations.secrets.dynamic.serializers import (
    DynamicSecretLeaseSerializer,
    DynamicSecretSerializer,
)
from api.utils.rest import (
    METHOD_TO_ACTION,
    get_request_principal,
)

from api.utils.access.middleware import IsIPAllowed
from api.throttling import PlanBasedRateThrottle
from ee.integrations.secrets.dynamic.aws.utils import (
    revoke_aws_dynamic_secret_lease,
)
from ee.integrations.secrets.dynamic.exceptions import (
    DynamicSecretError,
    PlanRestrictionError,
    LeaseRenewalError,
    LeaseExpiredError,
    TTLExceededError,
    LeaseAlreadyRevokedError,
)
from ee.integrations.secrets.dynamic.utils import (
    LEASE_CREATE_PERMISSION_ERROR,
    can_create_dynamic_secret_lease,
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
    throttle_classes = [PlanBasedRateThrottle]
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
        account, is_sa = get_request_principal(request)

        env = request.auth["environment"]
        organisation = env.app.organisation

        if not user_has_permission(
            account,
            action,
            "Secrets",
            organisation,
            True,
            is_sa,
            app=env.app,
        ):
            raise PermissionDenied(
                f"You don't have permission to {action} secrets in this environment."
            )

    def get(self, request, *args, **kwargs):
        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

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

        # Filter by secret ID
        secret_id = request.GET.get("id")
        if secret_id:
            dynamic_secrets_filter["id"] = secret_id

        # Filter by secret name
        secret_name = request.GET.get("name")
        if secret_name:
            dynamic_secrets_filter["name"] = secret_name

        dynamic_secrets = DynamicSecret.objects.filter(**dynamic_secrets_filter)

        if not dynamic_secrets.exists():
            return Response({"error": "No dynamic secrets found"}, status=404)

        # If lease param is present, generate a lease per secret
        include_lease = (
            "lease" in request.GET
            and request.GET.get("lease", "false").lower() != "false"
        )

        # Get optional TTL parameter for lease creation
        lease_ttl = request.GET.get("ttl")
        if lease_ttl:
            try:
                lease_ttl = int(lease_ttl)
            except ValueError:
                return Response(
                    {"error": "ttl must be a valid integer (seconds)"}, status=400
                )

        # 2. Create leases for each secret
        service_account = org_member = None

        if request.auth["auth_type"] == "User":
            org_member = request.auth["org_member"]
        elif request.auth["auth_type"] == "ServiceAccount":
            service_account = request.auth["service_account"]

        if include_lease:
            if not can_create_dynamic_secret_lease(
                env, organisation_member=org_member, service_account=service_account
            ):
                return Response({"error": LEASE_CREATE_PERMISSION_ERROR}, status=403)

            leases_by_secret_id = {}
            for ds in dynamic_secrets:
                try:
                    lease, _ = create_dynamic_secret_lease(
                        ds,
                        ttl=lease_ttl,
                        organisation_member=org_member,
                        service_account=service_account,
                        request=request,
                    )
                    leases_by_secret_id[ds.id] = str(lease.id)
                except PlanRestrictionError as e:
                    return Response({"error": str(e)}, status=403)
                except (TTLExceededError, LeaseRenewalError) as e:
                    return Response({"error": str(e)}, status=400)
                except DynamicSecretError as e:
                    return Response({"error": str(e)}, status=400)
                except Exception as e:
                    logger.exception(
                        "Unexpected error creating lease for dynamic secret %s", ds.id
                    )
                    return Response(
                        {
                            "error": "An internal error occurred while creating the lease"
                        },
                        status=500,
                    )

            # Serialize each secret with its lease_id in context
            dynamic_secrets_data = [
                DynamicSecretSerializer(
                    ds,
                    context={
                        "sse": True,
                        "with_credentials": True,
                        "lease_id": leases_by_secret_id.get(ds.id),
                    },
                ).data
                for ds in dynamic_secrets
            ]
        else:
            # Serialize without lease
            dynamic_secrets_data = DynamicSecretSerializer(
                dynamic_secrets, many=True, context={"sse": True}
            ).data

        return Response(
            dynamic_secrets_data,
            status=status.HTTP_200_OK,
        )


class DynamicSecretLeaseView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        get_request_principal(request)

    def _get_account_and_org(self, request):
        account, _ = get_request_principal(request)
        env = request.auth["environment"]
        organisation = env.app.organisation if env is not None else None
        return account, organisation

    def _get_lease_or_404(self, lease_id: str) -> DynamicSecretLease:
        try:
            env = self.request.auth["environment"]
            return DynamicSecretLease.objects.get(id=lease_id, secret__environment=env)
        except DynamicSecretLease.DoesNotExist:
            raise NotFound("Lease not found")

    def _is_lease_holder(self, request, lease: DynamicSecretLease) -> bool:
        # Compare like with like: member and service account ids share one id space.
        if request.auth["auth_type"] == "User":
            member = request.auth["org_member"]
            return member is not None and lease.organisation_member_id == member.id
        if request.auth["auth_type"] == "ServiceAccount":
            service_account = request.auth["service_account"]
            return (
                service_account is not None
                and lease.service_account_id == service_account.id
            )
        return False

    def _assert_can_act_on_lease(self, request, lease: DynamicSecretLease, action: str):
        # action: "update" for renew, "delete" for revoke
        if self._is_lease_holder(request, lease):
            return
        account, organisation = self._get_account_and_org(request)
        env = request.auth["environment"]
        if not user_has_permission(
            account,
            action,
            "DynamicSecretLeases",
            organisation,
            True,
            request.auth.get("service_account") is not None,
            app=env.app,
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

        env = request.auth["environment"]
        if not user_has_permission(
            account,
            "read",
            "Secrets",
            organisation,
            True,
            request.auth.get("service_account") is not None,
            app=env.app,
        ):
            raise PermissionDenied(
                f"You don't have permission to read secrets in this environment."
            )

        try:
            secret = DynamicSecret.objects.get(id=secret_id, environment=env)
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
            app=env.app,
        ):
            if request.auth["org_member"] is not None:
                leases_filter["organisation_member"] = request.auth["org_member"]
            elif request.auth["service_account"] is not None:
                leases_filter["service_account"] = request.auth["service_account"]

        leases = DynamicSecretLease.objects.filter(**leases_filter).order_by(
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
            org_member = request.auth["org_member"]
        elif request.auth["auth_type"] == "ServiceAccount":
            service_account = request.auth["service_account"]

        try:
            lease = renew_dynamic_secret_lease(
                lease,
                ttl,
                request=request,
                organisation_member=org_member,
                service_account=service_account,
            )
        except PlanRestrictionError as e:
            return Response({"error": str(e)}, status=403)
        except (LeaseRenewalError, TTLExceededError, LeaseExpiredError) as e:
            return Response({"error": str(e)}, status=400)
        except DynamicSecretError as e:
            # Catch any other dynamic secret errors
            return Response({"error": str(e)}, status=400)
        except Exception as e:
            logger.exception("Unexpected error renewing lease (lease_id=%s)", lease_id)
            return Response(
                {"error": "An internal error occurred while renewing the lease"},
                status=500,
            )

        return Response(
            {
                "message": f"Lease renewed successfully. Updated expiry: {lease.expires_at}"
            },
            status=status.HTTP_200_OK,
        )

    # Revoke
    def delete(self, request, *args, **kwargs):
        lease_id = request.data.get("lease_id") or request.query_params.get("lease_id")
        if not lease_id:
            return Response({"error": "lease_id is required"}, status=400)

        lease = self._get_lease_or_404(lease_id)
        self._assert_can_act_on_lease(request, lease, action="delete")

        org_member = service_account = None
        if request.auth["auth_type"] == "User":
            org_member = request.auth["org_member"]
        elif request.auth["auth_type"] == "ServiceAccount":
            service_account = request.auth["service_account"]

        try:
            if lease.secret.provider == "aws":
                revoke_aws_dynamic_secret_lease(
                    lease.id,
                    manual=True,
                    request=request,
                    organisation_member=org_member,
                    service_account=service_account,
                )

            return Response(
                {"message": "Lease revoked successfully"}, status=status.HTTP_200_OK
            )

        except LeaseAlreadyRevokedError as e:
            # If lease is already revoked, still return success with message
            return Response(
                {"message": "Lease was already revoked"}, status=status.HTTP_200_OK
            )
        except PlanRestrictionError as e:
            return Response({"error": str(e)}, status=403)
        except DynamicSecretError as e:
            # Catch any other dynamic secret errors
            return Response({"error": str(e)}, status=400)
        except Exception as e:
            logger.exception("Unexpected error revoking lease (lease_id=%s)", lease_id)
            return Response(
                {"error": "An internal error occurred while revoking the lease"},
                status=500,
            )
