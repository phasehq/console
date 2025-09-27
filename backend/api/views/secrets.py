from api.auth import PhaseTokenAuthentication
from api.models import (
    DynamicSecret,
    DynamicSecretLease,
    Environment,
    PersonalSecret,
    Secret,
    SecretEvent,
    SecretTag,
)
from api.serializers import (
    SecretSerializer,
)
from api.utils.secrets import (
    check_for_duplicates_blind,
    create_environment_folder_structure,
    normalize_path_string,
    compute_key_digest,
    get_environment_keys,
)
from api.utils.access.permissions import (
    user_has_permission,
)
from api.utils.audit_logging import log_secret_event

from api.utils.crypto import encrypt_asymmetric, validate_encrypted_string
from api.utils.rest import (
    METHOD_TO_ACTION,
    get_resolver_request_meta,
)
import logging
import json
from api.content_negotiation import CamelCaseContentNegotiation
from api.utils.access.middleware import IsIPAllowed
from ee.integrations.secrets.dynamic.serializers import DynamicSecretSerializer
from ee.integrations.secrets.dynamic.utils import create_dynamic_secret_lease
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from django.http import JsonResponse
from django.utils import timezone
from djangorestframework_camel_case.render import (
    CamelCaseJSONRenderer,
)
from rest_framework.renderers import JSONRenderer

logger = logging.getLogger(__name__)


class E2EESecretsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    content_negotiation_class = CamelCaseContentNegotiation

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

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)
        if not env.id:
            return JsonResponse({"error": "Environment doesn't exist"}, status=404)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_filter = {"environment": env, "deleted_at": None}

        # Filter by key
        try:
            key_digest = request.headers["keydigest"]
            if key_digest:
                secrets_filter["key_digest"] = key_digest
        except:
            pass

        # Filter by path
        try:
            path = request.headers["path"]
            if path:
                path = normalize_path_string(path)
                secrets_filter["path"] = path
        except:
            pass

        # Filter by tags
        try:
            tag_names = request.headers["tags"]
            if tag_names:
                tag_list = tag_names.split(",")
                # Fetch all matching tags for the given organization
                tags = SecretTag.objects.filter(
                    organisation=env.app.organisation, name__in=tag_list
                )
                # Filter secrets based on these tags
                secrets_filter["tags__in"] = tags
        except:
            pass

        secrets = Secret.objects.filter(**secrets_filter)

        for secret in secrets:
            log_secret_event(
                secret,
                SecretEvent.READ,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

        serializer = SecretSerializer(
            secrets, many=True, context={"org_member": request.auth["org_member"]}
        )

        include_dynamic_secrets = (
            # treat presence (any value) of either header as True unless explicitly "false"
            (
                "dynamic" in request.headers
                and request.headers.get("dynamic", "false").lower() != "false"
            )
            or (
                "include_dynamic" in request.headers
                and request.headers.get("include_dynamic", "false").lower() != "false"
            )
        )

        dynamic_secrets_data = []
        if include_dynamic_secrets:
            dynamic_secrets_filter = {
                "environment": env,
                "deleted_at": None,
            }
            try:
                path = request.headers.get("path")
                if path:
                    path = normalize_path_string(path)
                    dynamic_secrets_filter["path"] = path
            except Exception:
                pass

            dynamic_secrets_qs = DynamicSecret.objects.filter(**dynamic_secrets_filter)

            # If lease header is present, generate a lease per secret
            include_lease = (
                "lease" in request.headers
                and request.headers.get("lease", "false").lower() != "false"
            )

            service_account = None
            if request.auth.get("service_account_token") is not None:
                service_account = request.auth["service_account_token"].service_account

            if include_lease:
                leases_by_secret_id = {}
                for ds in dynamic_secrets_qs:
                    try:
                        lease, _ = create_dynamic_secret_lease(
                            ds,
                            organisation_member=request.auth.get("org_member"),
                            service_account=service_account,
                            request=request,
                        )
                        leases_by_secret_id[ds.id] = str(lease.id)
                    except Exception as e:
                        logger.error(
                            f"Failed to create lease for dynamic secret {ds.id}: {e}"
                        )

                # Serialize each secret with its lease_id in context
                dynamic_secrets_data = [
                    DynamicSecretSerializer(
                        ds,
                        context={
                            "sse": False,
                            "with_credentials": True,
                            "lease_id": leases_by_secret_id.get(ds.id),
                        },
                    ).data
                    for ds in dynamic_secrets_qs
                ]
            else:
                # Serialize without lease
                dynamic_secrets_data = DynamicSecretSerializer(
                    dynamic_secrets_qs, many=True, context={"sse": False}
                ).data

        response_data = serializer.data

        if include_dynamic_secrets:
            response_data.extend(dynamic_secrets_data)

        return Response(
            response_data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, *args, **kwargs):

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)
        if not env:
            return JsonResponse({"error": "Environment doesn't exist"}, status=404)

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        if check_for_duplicates_blind(
            request_body["secrets"], request.headers["environment"]
        ):
            return JsonResponse({"error": "Duplicate secret found"}, status=409)

        for secret in request_body["secrets"]:

            # Check that all encrypted fields are valid
            encrypted_fields = [secret["key"], secret["value"], secret["comment"]]
            if "override" in secret:
                encrypted_fields.append(secret["override"]["value"])

            for encrypted_field in encrypted_fields:
                if not validate_encrypted_string(encrypted_field):
                    return JsonResponse(
                        {"error": "Invalid ciphertext format"}, status=400
                    )

            tags = SecretTag.objects.filter(
                name__in=secret["tags"], organisation=env.app.organisation
            )

            try:
                path = normalize_path_string(secret["path"])
            except:
                path = "/"

            folder = None

            if path != "/":
                folder = create_environment_folder_structure(path, env_id)

            secret_data = {
                "environment": env,
                "path": path,
                "folder": folder,
                "key": secret["key"],
                "key_digest": secret["keyDigest"],
                "value": secret["value"],
                "version": 1,
                "comment": secret["comment"],
            }

            secret_obj = Secret.objects.create(**secret_data)
            secret_obj.tags.set(tags)

            log_secret_event(
                secret_obj,
                SecretEvent.CREATE,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

            # If the request is authenticated as a user and an override is supplied
            if request.auth["org_member"] and "override" in secret:
                PersonalSecret.objects.create(
                    secret=secret_obj,
                    user=request.auth["org_member"],
                    value=secret["override"]["value"],
                )

        return Response(status=status.HTTP_200_OK)

    def put(self, request, *args, **kwargs):

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)
        if not env:
            return JsonResponse({"error": "Environment doesn't exist"}, status=404)

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        if check_for_duplicates_blind(
            request_body["secrets"], request.headers["environment"]
        ):
            return JsonResponse({"error": "Duplicate secret found"}, status=409)

        for secret in request_body["secrets"]:

            secret_obj = Secret.objects.get(id=secret["id"])

            tags = SecretTag.objects.filter(
                name__in=secret["tags"], organisation=env.app.organisation
            )

            if "key" not in secret:
                secret["key"] = secret_obj.key
                try:
                    secret["keyDigest"] = secret_obj.key_digest
                except:
                    return JsonResponse(
                        {"error": "Key supplied without digest"}, status=400
                    )

            if "value" not in secret:
                secret["value"] = secret_obj.value

            if "comment" not in secret:
                secret["comment"] = secret_obj.comment

            # Check that all encrypted fields are valid
            encrypted_fields = [secret["key"], secret["value"], secret["comment"]]
            if "override" in secret:
                encrypted_fields.append(secret["override"]["value"])

            for encrypted_field in encrypted_fields:
                if not validate_encrypted_string(encrypted_field):
                    return JsonResponse(
                        {"error": "Invalid ciphertext format"}, status=400
                    )

            secret_data = {
                "environment": env,
                "key": secret["key"],
                "key_digest": secret["keyDigest"],
                "value": secret["value"],
                "version": secret_obj.version + 1,
                "comment": secret["comment"],
            }

            try:
                folder = None
                path = normalize_path_string(secret["path"])

                if path != "/":
                    folder = create_environment_folder_structure(path, env_id)

                secret_data["path"] = path
                secret_data["folder"] = folder
            except:
                pass

            for key, value in secret_data.items():
                setattr(secret_obj, key, value)

            secret_obj.updated_at = timezone.now()
            secret_obj.tags.set(tags)
            secret_obj.save()

            log_secret_event(
                secret_obj,
                SecretEvent.UPDATE,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

            # If the request is authenticated as a user and an override is supplied
            if request.auth["org_member"] and "override" in secret:
                PersonalSecret.objects.update_or_create(
                    secret=secret_obj,
                    user=request.auth["org_member"],
                    defaults={
                        "value": secret["override"]["value"],
                        "is_active": secret["override"]["isActive"],
                        "updated_at": timezone.now(),
                    },
                )

        return Response(status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_to_delete = Secret.objects.filter(id__in=request_body["secrets"])

        if not secrets_to_delete.exists():
            return Response(status=status.HTTP_200_OK)

        env = secrets_to_delete[0].environment

        for secret in secrets_to_delete:
            secret.updated_at = timezone.now()
            secret.deleted_at = timezone.now()
            secret.save()

            log_secret_event(
                secret,
                SecretEvent.DELETE,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

        return Response(status=status.HTTP_200_OK)


class PublicSecretsView(APIView):
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

        secrets_filter = {"environment": env, "deleted_at": None}

        account = None
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]

        # Filter by key
        key = request.GET.get("key")
        if key:
            key_digest = compute_key_digest(key, env.id)
            secrets_filter["key_digest"] = key_digest

        # Filter by path
        path = request.GET.get("path")
        if path:
            path = normalize_path_string(path)
            secrets_filter["path"] = path

        # Filter by tags
        tag_names = request.GET.get("tags")
        if tag_names:
            tag_list = tag_names.split(",")
            # Fetch all matching tags for the given organization
            tags = SecretTag.objects.filter(
                organisation=env.app.organisation, name__in=tag_list
            )
            # Filter secrets based on these tags
            secrets_filter["tags__in"] = tags

        secrets = Secret.objects.filter(**secrets_filter)

        for secret in secrets:
            log_secret_event(
                secret,
                SecretEvent.READ,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

        serializer = SecretSerializer(
            secrets,
            many=True,
            context={
                "org_member": request.auth["org_member"],
                "account": account,
                "sse": True,
            },
        )

        include_dynamic_secrets = (
            # treat presence (any value) of either param as True unless explicitly "false"
            (
                "dynamic" in request.GET
                and request.GET.get("dynamic", "false").lower() != "false"
            )
            or (
                "include_dynamic" in request.GET
                and request.GET.get("include_dynamic", "false").lower() != "false"
            )
        )

        dynamic_secrets_data = []
        if include_dynamic_secrets:
            dynamic_secrets_filter = {
                "environment": env,
                "deleted_at": None,
            }
            try:
                path = request.GET.get("path")
                if path:
                    path = normalize_path_string(path)
                    dynamic_secrets_filter["path"] = path
            except Exception:
                pass

            dynamic_secrets_qs = DynamicSecret.objects.filter(**dynamic_secrets_filter)

            # If ?lease is present, generate a lease per secret
            include_lease = (
                "lease" in request.GET
                and request.GET.get("lease", "false").lower() != "false"
            )

            service_account = None
            if request.auth.get("service_account_token") is not None:
                service_account = request.auth["service_account_token"].service_account

            if include_lease:
                leases_by_secret_id = {}
                for ds in dynamic_secrets_qs:
                    try:
                        lease, _ = create_dynamic_secret_lease(
                            ds,
                            organisation_member=request.auth.get("org_member"),
                            service_account=service_account,
                            request=request,
                        )
                        leases_by_secret_id[ds.id] = str(lease.id)
                    except Exception as e:
                        logger.error(
                            f"Failed to create lease for dynamic secret {ds.id}: {e}"
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
                    for ds in dynamic_secrets_qs
                ]
            else:
                # Serialize without lease
                dynamic_secrets_data = DynamicSecretSerializer(
                    dynamic_secrets_qs, many=True, context={"sse": True}
                ).data

        response_data = serializer.data

        if include_dynamic_secrets:
            response_data.extend(dynamic_secrets_data)

        return Response(
            response_data,
            status=status.HTTP_200_OK,
        )

    def post(self, request, *args, **kwargs):

        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        request_body = json.loads(request.body)

        secrets = request_body["secrets"]

        ip_address, user_agent = get_resolver_request_meta(request)

        env_pubkey, _ = get_environment_keys(env.id)

        for secret in secrets:
            secret.pop("id", None)
            secret["keyDigest"] = compute_key_digest(secret["key"], env.id)
            secret["key"] = encrypt_asymmetric(secret["key"].upper(), env_pubkey)
            secret["value"] = encrypt_asymmetric(secret["value"], env_pubkey)

            if "comment" in secret:
                secret["comment"] = encrypt_asymmetric(secret["comment"], env_pubkey)
            else:
                secret["comment"] = ""
            if "override" in secret:
                secret["override"]["value"] = encrypt_asymmetric(
                    (secret["override"]["value"]), env_pubkey
                )

        if check_for_duplicates_blind(secrets, env):
            return JsonResponse({"error": "Duplicate secret found"}, status=409)

        created_secrets = []

        for secret in secrets:

            try:
                path = normalize_path_string(secret["path"])
            except:
                path = "/"

            folder = None

            if path != "/":
                folder = create_environment_folder_structure(path, env.id)

            secret_data = {
                "environment": env,
                "path": path,
                "folder": folder,
                "key": secret["key"],
                "key_digest": secret["keyDigest"],
                "value": secret["value"],
                "version": 1,
                "comment": secret["comment"],
            }

            secret_obj = Secret.objects.create(**secret_data)

            # Optionally set tags
            if "tags" in secret:
                tags = SecretTag.objects.filter(
                    name__in=secret["tags"],
                    organisation=request.auth["environment"].app.organisation,
                )
                secret_obj.tags.set(tags)

            log_secret_event(
                secret_obj,
                SecretEvent.CREATE,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

            # If the request is authenticated as a user and an override is supplied
            if request.auth["org_member"] and "override" in secret:
                PersonalSecret.objects.create(
                    secret=secret_obj,
                    user=request.auth["org_member"],
                    value=secret["override"]["value"],
                )

            created_secrets.append(secret_obj)

        serializer = SecretSerializer(
            created_secrets,
            many=True,
            context={"org_member": request.auth["org_member"], "sse": True},
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request, *args, **kwargs):

        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        request_body = json.loads(request.body)

        secrets = request_body["secrets"]

        ip_address, user_agent = get_resolver_request_meta(request)

        env_pubkey, _ = get_environment_keys(env.id)

        for secret in secrets:
            # make sure all secrets have an id
            if "id" not in secret:
                return JsonResponse({"error": "Secret id not provided"}, status=400)

            # if a secret key is being updated, encrypt the key, compute digest, and check for duplicates
            if "key" in secret:
                secret["keyDigest"] = compute_key_digest(secret["key"], env.id)
                secret["key"] = encrypt_asymmetric(secret["key"].upper(), env_pubkey)

                if check_for_duplicates_blind(secrets, env):
                    return JsonResponse({"error": "Duplicate secret found"}, status=409)
            if "override" in secret:
                secret["override"]["value"] = encrypt_asymmetric(
                    (secret["override"]["value"]), env_pubkey
                )

        updated_secrets = []

        for secret in secrets:

            secret_obj = Secret.objects.get(id=secret["id"])

            if "key" not in secret:
                secret["key"] = secret_obj.key
                secret["keyDigest"] = secret_obj.key_digest

            if "value" in secret:
                secret["value"] = encrypt_asymmetric(secret["value"], env_pubkey)
            else:
                secret["value"] = secret_obj.value

            if "comment" in secret:
                secret["comment"] = encrypt_asymmetric(secret["comment"], env_pubkey)
            else:
                secret["comment"] = secret_obj.comment

            secret_data = {
                "environment": env,
                "key": secret["key"],
                "key_digest": secret["keyDigest"],
                "value": secret["value"],
                "version": secret_obj.version + 1,
                "comment": secret["comment"],
            }

            try:
                folder = None
                path = normalize_path_string(secret["path"])

                if path != "/":
                    folder = create_environment_folder_structure(path, env.id)

                secret_data["path"] = path
                secret_data["folder"] = folder
            except:
                pass

            for key, value in secret_data.items():
                setattr(secret_obj, key, value)

            # Optionally reset tags
            if "tags" in secret:
                tags = SecretTag.objects.filter(
                    name__in=secret["tags"],
                    organisation=request.auth["environment"].app.organisation,
                )
                secret_obj.tags.set(tags)

            secret_obj.updated_at = timezone.now()

            secret_obj.save()

            log_secret_event(
                secret_obj,
                SecretEvent.UPDATE,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

            # If the request is authenticated as a user and an override is supplied
            if request.auth["org_member"] and "override" in secret:
                PersonalSecret.objects.update_or_create(
                    secret=secret_obj,
                    user=request.auth["org_member"],
                    defaults={
                        "value": secret["override"]["value"],
                        "is_active": secret["override"]["isActive"],
                        "updated_at": timezone.now(),
                    },
                )

            updated_secrets.append(secret_obj)

        serializer = SecretSerializer(
            updated_secrets,
            many=True,
            context={"org_member": request.auth["org_member"], "sse": True},
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):

        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_to_delete = Secret.objects.filter(id__in=request_body["secrets"])

        for secret in secrets_to_delete:
            if not Secret.objects.filter(id=secret.id).exists():
                return JsonResponse({"error": "Secret does not exist"}, status=404)

        for secret in secrets_to_delete:
            secret.updated_at = timezone.now()
            secret.deleted_at = timezone.now()
            secret.save()

            log_secret_event(
                secret,
                SecretEvent.DELETE,
                request.auth["org_member"],
                request.auth["service_token"],
                request.auth["service_account_token"],
                ip_address,
                user_agent,
            )

        return Response(
            {"message": f"Deleted {len(secrets_to_delete)} secrets"},
            status=status.HTTP_200_OK,
        )
