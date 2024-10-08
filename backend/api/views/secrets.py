from api.auth import PhaseTokenAuthentication
from api.models import (
    Environment,
    PersonalSecret,
    Secret,
    SecretEvent,
    SecretTag,
    ServerEnvironmentKey,
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
from api.utils.access.permissions import user_can_access_environment
from api.utils.audit_logging import log_secret_event

from api.utils.crypto import encrypt_asymmetric, validate_encrypted_string
from api.utils.rest import (
    get_resolver_request_meta,
)

import json
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse, HttpResponse
from django.utils import timezone
from djangorestframework_camel_case.render import (
    CamelCaseJSONRenderer,
)


class E2EESecretsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated]

    @csrf_exempt
    def dispatch(self, request, *args):
        return super(E2EESecretsView, self).dispatch(request, *args)

    def get(self, request):

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)
        if not env.id:
            return HttpResponse(status=404)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_filter = {"environment": env, "deleted_at": None}

        try:
            key_digest = request.headers["keydigest"]
            if key_digest:
                secrets_filter["key_digest"] = key_digest
        except:
            pass

        try:
            path = request.headers["path"]
            if path:
                path = normalize_path_string(path)
                secrets_filter["path"] = path
        except:
            pass

        secrets = Secret.objects.filter(**secrets_filter)

        for secret in secrets:
            log_secret_event(
                secret,
                SecretEvent.READ,
                request.auth["org_member"],
                request.auth["service_token"],
                ip_address,
                user_agent,
            )

        serializer = SecretSerializer(
            secrets, many=True, context={"org_member": request.auth["org_member"]}
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)
        if not env:
            return HttpResponse(status=404)

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

            tags = SecretTag.objects.filter(id__in=secret["tags"])

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

    def put(self, request):

        env_id = request.headers["environment"]
        env = Environment.objects.get(id=env_id)
        if not env:
            return HttpResponse(status=404)

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

            secret_obj = Secret.objects.get(id=secret["id"])

            tags = SecretTag.objects.filter(id__in=secret["tags"])

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

    def delete(self, request):

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_to_delete = Secret.objects.filter(id__in=request_body["secrets"])

        for secret in secrets_to_delete:
            if not Secret.objects.filter(id=secret.id).exists():
                return HttpResponse(status=404)

            if request.auth[
                "org_member"
            ] is not None and not user_can_access_environment(
                request.auth["org_member"].user.userId, secret.environment.id
            ):
                return HttpResponse(status=403)

        for secret in secrets_to_delete:
            secret.updated_at = timezone.now()
            secret.deleted_at = timezone.now()
            secret.save()

            log_secret_event(
                secret,
                SecretEvent.DELETE,
                request.auth["org_member"],
                request.auth["service_token"],
                ip_address,
                user_agent,
            )

        return Response(status=status.HTTP_200_OK)


class PublicSecretsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated]
    renderer_classes = [
        CamelCaseJSONRenderer,
    ]

    @csrf_exempt
    def dispatch(self, request, *args):
        return super(PublicSecretsView, self).dispatch(request, *args)

    def get(self, request):
        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_filter = {"environment": env, "deleted_at": None}

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

        secrets = Secret.objects.filter(**secrets_filter)

        for secret in secrets:
            log_secret_event(
                secret,
                SecretEvent.READ,
                request.auth["org_member"],
                request.auth["service_token"],
                ip_address,
                user_agent,
            )

        serializer = SecretSerializer(
            secrets,
            many=True,
            context={"org_member": request.auth["org_member"], "sse": True},
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):

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

    def put(self, request):

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

    def delete(self, request):

        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        request_body = json.loads(request.body)

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_to_delete = Secret.objects.filter(id__in=request_body["secrets"])

        for secret in secrets_to_delete:
            if not Secret.objects.filter(id=secret.id).exists():
                return HttpResponse(status=404)

            if request.auth[
                "org_member"
            ] is not None and not user_can_access_environment(
                request.auth["org_member"].user.userId, secret.environment.id
            ):
                return HttpResponse(status=403)

        for secret in secrets_to_delete:
            secret.updated_at = timezone.now()
            secret.deleted_at = timezone.now()
            secret.save()

            log_secret_event(
                secret,
                SecretEvent.DELETE,
                request.auth["org_member"],
                request.auth["service_token"],
                ip_address,
                user_agent,
            )

        return Response(
            {"message": f"Deleted {len(secrets_to_delete)} secrets"},
            status=status.HTTP_200_OK,
        )
