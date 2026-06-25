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
    get_environment_crypto_context,
)
from api.utils.access.permissions import (
    user_has_permission,
)
from api.utils.audit_logging import log_secret_event, log_secret_events_bulk

from api.utils.crypto import encrypt_asymmetric, validate_encrypted_string
from api.utils.rest import (
    METHOD_TO_ACTION,
    get_resolver_request_meta,
)
import logging
import json
from api.content_negotiation import CamelCaseContentNegotiation
from api.utils.access.middleware import IsIPAllowed
from api.throttling import PlanBasedRateThrottle
from ee.integrations.secrets.dynamic.exceptions import (
    DynamicSecretError,
    PlanRestrictionError,
    TTLExceededError,
)
from ee.integrations.secrets.dynamic.serializers import DynamicSecretSerializer
from ee.integrations.secrets.dynamic.utils import (
    create_dynamic_secret_lease,
)
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


def _parse_json_body(request):
    """Parse the request body as a JSON object. Returns (body, None) on
    success or (None, Response) on failure. Replaces ad-hoc
    `json.loads(request.body)` calls that 500'd on empty / non-object /
    deeply-nested bodies."""
    raw = request.body
    if not raw:
        return None, JsonResponse(
            {"error": "Request body is required."}, status=400
        )
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, RecursionError, ValueError):
        return None, JsonResponse(
            {"error": "Request body must be valid JSON."}, status=400
        )
    if not isinstance(body, dict):
        return None, JsonResponse(
            {"error": "Request body must be a JSON object."}, status=400
        )
    return body, None


def _validate_override(override):
    """A non-null `override` must be an object with both `value` (str)
    and `isActive` (bool). Partial / null shapes 500'd before this."""
    if not isinstance(override, dict):
        return "'override' must be a JSON object."
    if "value" not in override or not isinstance(override.get("value"), str):
        return "'override.value' must be a string."
    if "isActive" not in override or not isinstance(override.get("isActive"), bool):
        return "'override.isActive' must be a boolean."
    return None


_SECRET_TAG_NAME_MAX_LEN = 64


def _resolve_secret_tags(tag_names, org):
    """Resolve tag names to SecretTag rows for the org, auto-creating any
    that don't yet exist. Returns (tags, error_response_or_None). Without
    auto-create, names that aren't already in the org's tag set would
    silently disappear (no public REST endpoint exists to pre-create
    tags)."""
    resolved = []
    for raw in tag_names or []:
        if not isinstance(raw, str):
            continue
        name = raw.strip()
        if not name:
            continue
        if len(name) > _SECRET_TAG_NAME_MAX_LEN:
            return None, JsonResponse(
                {
                    "error": (
                        f"Tag name exceeds {_SECRET_TAG_NAME_MAX_LEN} "
                        f"characters: {name[:32]!r}…"
                    )
                },
                status=400,
            )
        tag, _ = SecretTag.objects.get_or_create(
            organisation=org,
            name=name,
            defaults={"color": ""},
        )
        resolved.append(tag)
    return resolved, None


class E2EESecretsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
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
            if env is None:
                raise PermissionDenied(
                    "Environment context required. Supply `app_id` and `env` "
                    "as query parameters."
                )
            organisation = env.app.organisation

            if not user_has_permission(
                account,
                action,
                "Secrets",
                organisation,
                True,
                request.auth.get("service_account") is not None,
                app=env.app,
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} secrets in this environment."
                )

    def get(self, request, *args, **kwargs):

        env = request.auth["environment"]

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

        secrets = list(
            Secret.objects.filter(**secrets_filter).prefetch_related('tags')
        )

        log_secret_events_bulk(
            secrets,
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

            # Get optional lease_ttl header for custom TTL
            lease_ttl = request.headers.get("lease_ttl")
            if lease_ttl:
                try:
                    lease_ttl = int(lease_ttl)
                except ValueError:
                    return Response(
                        {"error": "lease_ttl must be a valid integer (seconds)"},
                        status=400,
                    )

            service_account = None
            if request.auth.get("service_account_token") is not None:
                service_account = request.auth["service_account_token"].service_account

            if include_lease:
                leases_by_secret_id = {}
                failed_leases = []
                for ds in dynamic_secrets_qs:
                    try:
                        lease, _ = create_dynamic_secret_lease(
                            ds,
                            ttl=lease_ttl,  # Pass the TTL if provided
                            organisation_member=request.auth.get("org_member"),
                            service_account=service_account,
                            request=request,
                        )
                        leases_by_secret_id[ds.id] = str(lease.id)
                    except PlanRestrictionError as e:
                        return Response({"error": str(e)}, status=403)
                    except DynamicSecretError as e:
                        failed_leases.append(
                            {
                                "secret_id": str(ds.id),
                                "secret_name": ds.name,
                                "error": str(e),
                            }
                        )
                    except Exception as e:
                        logger.exception(
                            "Unexpected error creating lease for dynamic secret %s",
                            ds.id,
                        )
                        failed_leases.append(
                            {
                                "secret_id": str(ds.id),
                                "secret_name": ds.name,
                                "error": "Internal error occurred",
                            }
                        )

                # If any leases failed to create, return error response
                if failed_leases:
                    return Response(
                        {
                            "error": "One or more dynamic secret leases could not be created",
                            "failed_leases": failed_leases,
                            "successful_leases": len(leases_by_secret_id),
                        },
                        status=400,
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

        env = request.auth["environment"]

        request_body, err = _parse_json_body(request)
        if err is not None:
            return err

        ip_address, user_agent = get_resolver_request_meta(request)

        if check_for_duplicates_blind(
            request_body["secrets"], env.id
        ):
            return JsonResponse({"error": "Duplicate secret found"}, status=409)

        created_secrets = []

        # Defer per-secret sync triggering (trigger_sync=False); trigger once below.
        try:
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

                tags, err = _resolve_secret_tags(secret.get("tags") or [], env.app.organisation)
                if err is not None:
                    return err

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
                    "type": secret.get("type", "secret"),
                }

                secret_obj = Secret(**secret_data)
                secret_obj.save(force_insert=True, trigger_sync=False)
                secret_obj.tags.set(tags)
                created_secrets.append(secret_obj)

                # If the request is authenticated as a user and an override is supplied
                if request.auth["org_member"] and "override" in secret:
                    PersonalSecret.objects.create(
                        secret=secret_obj,
                        user=request.auth["org_member"],
                        value=secret["override"]["value"],
                    )
        finally:
            if created_secrets:
                env.save()

        log_secret_events_bulk(
            created_secrets,
            SecretEvent.CREATE,
            request.auth["org_member"],
            request.auth["service_token"],
            request.auth["service_account_token"],
            ip_address,
            user_agent,
        )

        return Response(status=status.HTTP_200_OK)

    def put(self, request, *args, **kwargs):

        env = request.auth["environment"]

        request_body, err = _parse_json_body(request)
        if err is not None:
            return err

        ip_address, user_agent = get_resolver_request_meta(request)

        if check_for_duplicates_blind(
            request_body["secrets"], env.id
        ):
            return JsonResponse({"error": "Duplicate secret found"}, status=409)

        updated_secrets = []

        # Defer per-secret sync triggering (trigger_sync=False); trigger once below.
        try:
            for secret in request_body["secrets"]:

                secret_obj = Secret.objects.get(id=secret["id"])

                if secret_obj.rotating_secret_id is not None:
                    return JsonResponse(
                        {
                            "error": (
                                "Rotating secrets are managed by the Phase rotation "
                                "engine and cannot be updated via this endpoint."
                            )
                        },
                        status=400,
                    )

                tags, err = _resolve_secret_tags(secret.get("tags") or [], env.app.organisation)
                if err is not None:
                    return err

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

                # Enforce seal permanence
                if secret_obj.type == "sealed" and secret.get("type") is not None and secret.get("type") != "sealed":
                    return JsonResponse(
                        {"error": "Sealed secrets cannot be unsealed. Delete and recreate the secret instead."},
                        status=400,
                    )

                secret_data = {
                    "environment": env,
                    "key": secret["key"],
                    "key_digest": secret["keyDigest"],
                    "value": secret["value"],
                    "version": secret_obj.version + 1,
                    "comment": secret["comment"],
                }

                # For sealed secrets, preserve existing encrypted value
                if secret_obj.type == "sealed":
                    secret_data["value"] = secret_obj.value

                # Set type if provided
                if "type" in secret:
                    secret_data["type"] = secret["type"]

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

                secret_obj.updated_at = timezone.now()
                secret_obj.tags.set(tags)
                secret_obj.save(trigger_sync=False)
                updated_secrets.append(secret_obj)

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
        finally:
            if updated_secrets:
                env.save()

        log_secret_events_bulk(
            updated_secrets,
            SecretEvent.UPDATE,
            request.auth["org_member"],
            request.auth["service_token"],
            request.auth["service_account_token"],
            ip_address,
            user_agent,
        )

        return Response(status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):

        request_body, err = _parse_json_body(request)
        if err is not None:
            return err

        ip_address, user_agent = get_resolver_request_meta(request)

        secrets_to_delete = Secret.objects.filter(
            id__in=request_body["secrets"]
        ).prefetch_related('tags')

        if not secrets_to_delete.exists():
            return Response(status=status.HTTP_200_OK)

        if any(s.rotating_secret_id is not None for s in secrets_to_delete):
            return JsonResponse(
                {
                    "error": (
                        "Rotating secrets are managed by the Phase rotation "
                        "engine and cannot be deleted via this endpoint."
                    )
                },
                status=400,
            )

        deleted_secrets = []
        affected_envs = {}

        # Defer per-secret sync triggering; trigger once per affected environment
        # afterwards (a delete batch may span environments).
        try:
            for secret in secrets_to_delete:
                affected_envs[secret.environment_id] = secret.environment
                secret.updated_at = timezone.now()
                secret.deleted_at = timezone.now()
                secret.save(trigger_sync=False)
                deleted_secrets.append(secret)
        finally:
            for env in affected_envs.values():
                env.save()

        log_secret_events_bulk(
            deleted_secrets,
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
        account = None
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]

        if account is not None:
            env = request.auth["environment"]
            if env is None:
                raise PermissionDenied(
                    "Environment context required. Supply `app_id` and `env` "
                    "as query parameters."
                )
            organisation = env.app.organisation

            if not user_has_permission(
                account,
                action,
                "Secrets",
                organisation,
                True,
                request.auth.get("service_account") is not None,
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

        secrets = list(
            Secret.objects.filter(**secrets_filter).prefetch_related('tags')
        )

        log_secret_events_bulk(
            secrets,
            SecretEvent.READ,
            request.auth["org_member"],
            request.auth["service_token"],
            request.auth["service_account_token"],
            ip_address,
            user_agent,
        )

        # Pre-compute crypto context for N+1 optimization
        crypto_context = get_environment_crypto_context(env)
        context_cache = {}

        serializer = SecretSerializer(
            secrets,
            many=True,
            context={
                "org_member": request.auth["org_member"],
                "account": account,
                "sse": True,
                "crypto_context": crypto_context,
                "context_cache": context_cache,
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

            # Get optional lease_ttl parameter for custom TTL
            lease_ttl = request.GET.get("lease_ttl")
            if lease_ttl:
                try:
                    lease_ttl = int(lease_ttl)
                except ValueError:
                    return Response(
                        {"error": "lease_ttl must be a valid integer (seconds)"},
                        status=400,
                    )

            service_account = None
            if request.auth.get("service_account_token") is not None:
                service_account = request.auth["service_account_token"].service_account

            if include_lease:
                leases_by_secret_id = {}
                failed_leases = []
                for ds in dynamic_secrets_qs:
                    try:
                        lease, _ = create_dynamic_secret_lease(
                            ds,
                            ttl=lease_ttl,
                            organisation_member=request.auth.get("org_member"),
                            service_account=service_account,
                            request=request,
                        )
                        leases_by_secret_id[ds.id] = str(lease.id)
                    except PlanRestrictionError as e:
                        return Response({"error": str(e)}, status=403)
                    except (TTLExceededError,) as e:
                        failed_leases.append(
                            {
                                "secret_id": str(ds.id),
                                "secret_name": ds.name,
                                "error": str(e),
                            }
                        )
                    except DynamicSecretError as e:
                        failed_leases.append(
                            {
                                "secret_id": str(ds.id),
                                "secret_name": ds.name,
                                "error": str(e),
                            }
                        )
                    except Exception as e:
                        logger.exception(
                            "Unexpected error creating lease for dynamic secret %s",
                            ds.id,
                        )
                        failed_leases.append(
                            {
                                "secret_id": str(ds.id),
                                "secret_name": ds.name,
                                "error": str(e),
                            }
                        )

                # If any leases failed to create, return error response
                if failed_leases:
                    return Response(
                        {
                            "error": "One or more dynamic secret leases could not be created",
                            "failed_leases": failed_leases,
                            "successful_leases": len(leases_by_secret_id),
                        },
                        status=400,
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

        request_body, err = _parse_json_body(request)
        if err is not None:
            return err

        secrets = request_body.get("secrets")
        if not isinstance(secrets, list) or not secrets:
            return JsonResponse(
                {"error": "'secrets' must be a non-empty list."}, status=400
            )

        # Validate every entry upfront so we 400 cleanly instead of 500ing
        # halfway through the encryption loop on a missing key/value.
        allowed_types = {c[0] for c in Secret.SECRET_TYPE_CHOICES}
        for s in secrets:
            if not isinstance(s, dict):
                return JsonResponse(
                    {"error": "Each entry in 'secrets' must be an object."}, status=400
                )
            key = s.get("key")
            value = s.get("value")
            if not isinstance(key, str) or not key.strip():
                return JsonResponse(
                    {"error": "Each secret requires a non-empty 'key'."}, status=400
                )
            if not isinstance(value, str):
                return JsonResponse(
                    {"error": "Each secret requires a 'value' string."}, status=400
                )
            stype = s.get("type")
            if stype is not None and stype not in allowed_types:
                return JsonResponse(
                    {
                        "error": (
                            f"Invalid 'type': {stype!r}. Must be one of "
                            f"{sorted(allowed_types)}."
                        )
                    },
                    status=400,
                )
            if "override" in s:
                ov_err = _validate_override(s["override"])
                if ov_err:
                    return JsonResponse({"error": ov_err}, status=400)

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

        # Defer per-secret sync triggering (trigger_sync=False); trigger once below.
        try:
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
                    "type": secret.get("type", "secret"),
                }

                secret_obj = Secret(**secret_data)
                secret_obj.save(force_insert=True, trigger_sync=False)

                # Optionally set tags (auto-create unknown names so the caller
                # doesn't silently lose them — see _resolve_secret_tags).
                if "tags" in secret:
                    tags, err = _resolve_secret_tags(
                        secret["tags"],
                        request.auth["environment"].app.organisation,
                    )
                    if err is not None:
                        return err
                    secret_obj.tags.set(tags)

                # If the request is authenticated as a user and an override is supplied
                if request.auth["org_member"] and "override" in secret:
                    PersonalSecret.objects.create(
                        secret=secret_obj,
                        user=request.auth["org_member"],
                        value=secret["override"]["value"],
                    )

                created_secrets.append(secret_obj)
        finally:
            if created_secrets:
                env.save()

        log_secret_events_bulk(
            created_secrets,
            SecretEvent.CREATE,
            request.auth["org_member"],
            request.auth["service_token"],
            request.auth["service_account_token"],
            ip_address,
            user_agent,
        )

        # Pre-compute crypto context for N+1 optimization
        crypto_context = get_environment_crypto_context(env)
        context_cache = {}

        serializer = SecretSerializer(
            created_secrets,
            many=True,
            context={
                "org_member": request.auth["org_member"],
                "sse": True,
                "crypto_context": crypto_context,
                "context_cache": context_cache,
            },
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request, *args, **kwargs):

        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        request_body, err = _parse_json_body(request)
        if err is not None:
            return err

        secrets = request_body.get("secrets")
        if not isinstance(secrets, list) or not secrets:
            return JsonResponse(
                {"error": "'secrets' must be a non-empty list."}, status=400
            )

        allowed_types = {c[0] for c in Secret.SECRET_TYPE_CHOICES}
        for secret in secrets:
            if not isinstance(secret, dict) or "id" not in secret:
                return JsonResponse({"error": "Secret id not provided"}, status=400)
            stype = secret.get("type")
            if stype is not None and stype not in allowed_types:
                return JsonResponse(
                    {
                        "error": (
                            f"Invalid 'type': {stype!r}. Must be one of "
                            f"{sorted(allowed_types)}."
                        )
                    },
                    status=400,
                )
            if "override" in secret:
                ov_err = _validate_override(secret["override"])
                if ov_err:
                    return JsonResponse({"error": ov_err}, status=400)

        ip_address, user_agent = get_resolver_request_meta(request)

        env_pubkey, _ = get_environment_keys(env.id)

        for secret in secrets:
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

        # Defer per-secret sync triggering (trigger_sync=False); trigger once below.
        try:
            for secret in secrets:

                try:
                    secret_obj = Secret.objects.get(id=secret["id"], environment=env)
                except (Secret.DoesNotExist, ValueError):
                    return JsonResponse(
                        {"error": f"Secret not found: {secret['id']}"},
                        status=404,
                    )

                if secret_obj.rotating_secret_id is not None:
                    return JsonResponse(
                        {
                            "error": (
                                "Rotating secrets are managed by the Phase rotation "
                                "engine and cannot be updated via this endpoint."
                            )
                        },
                        status=400,
                    )

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

                # Enforce seal permanence
                if secret_obj.type == "sealed" and secret.get("type") is not None and secret.get("type") != "sealed":
                    return JsonResponse(
                        {"error": "Sealed secrets cannot be unsealed. Delete and recreate the secret instead."},
                        status=400,
                    )

                secret_data = {
                    "environment": env,
                    "key": secret["key"],
                    "key_digest": secret["keyDigest"],
                    "value": secret["value"],
                    "version": secret_obj.version + 1,
                    "comment": secret["comment"],
                }

                # For sealed secrets, preserve existing encrypted value
                if secret_obj.type == "sealed":
                    secret_data["value"] = secret_obj.value

                # Set type if provided
                if "type" in secret:
                    secret_data["type"] = secret["type"]

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

                # Optionally update tags (auto-create unknown names so the
                # caller doesn't lose them — see _resolve_secret_tags).
                if "tags" in secret:
                    tags, err = _resolve_secret_tags(
                        secret["tags"],
                        request.auth["environment"].app.organisation,
                    )
                    if err is not None:
                        return err
                    secret_obj.tags.set(tags)

                secret_obj.updated_at = timezone.now()

                secret_obj.save(trigger_sync=False)

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
        finally:
            if updated_secrets:
                env.save()

        log_secret_events_bulk(
            updated_secrets,
            SecretEvent.UPDATE,
            request.auth["org_member"],
            request.auth["service_token"],
            request.auth["service_account_token"],
            ip_address,
            user_agent,
        )

        # Pre-compute crypto context for N+1 optimization
        crypto_context = get_environment_crypto_context(env)
        context_cache = {}

        serializer = SecretSerializer(
            updated_secrets,
            many=True,
            context={
                "org_member": request.auth["org_member"],
                "sse": True,
                "crypto_context": crypto_context,
                "context_cache": context_cache,
            },
        )

        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, *args, **kwargs):

        env = request.auth["environment"]

        # Check if SSE is enabled for this environment
        if not env.app.sse_enabled:
            return Response({"error": "SSE is not enabled for this App"}, status=400)

        request_body, err = _parse_json_body(request)
        if err is not None:
            return err

        ip_address, user_agent = get_resolver_request_meta(request)

        requested_ids = request_body.get("secrets") or []
        if not isinstance(requested_ids, list) or not requested_ids:
            return JsonResponse(
                {"error": "'secrets' must be a non-empty list of secret ids."},
                status=400,
            )

        secrets_to_delete = list(
            Secret.objects.filter(
                id__in=requested_ids,
                environment=env,
                deleted_at__isnull=True,
            ).prefetch_related('tags')
        )

        found_ids = {str(s.id) for s in secrets_to_delete}
        missing_ids = [sid for sid in requested_ids if str(sid) not in found_ids]
        if missing_ids:
            return JsonResponse(
                {
                    "error": (
                        f"Secret(s) not found in this environment: "
                        f"{', '.join(missing_ids)}"
                    )
                },
                status=404,
            )

        if any(s.rotating_secret_id is not None for s in secrets_to_delete):
            return JsonResponse(
                {
                    "error": (
                        "Rotating secrets are managed by the Phase rotation "
                        "engine and cannot be deleted via this endpoint."
                    )
                },
                status=400,
            )

        deleted_secrets = []

        # Defer per-secret sync triggering (trigger_sync=False); trigger once below.
        try:
            for secret in secrets_to_delete:
                secret.updated_at = timezone.now()
                secret.deleted_at = timezone.now()
                secret.save(trigger_sync=False)
                deleted_secrets.append(secret)
        finally:
            if deleted_secrets:
                env.save()

        log_secret_events_bulk(
            deleted_secrets,
            SecretEvent.DELETE,
            request.auth["org_member"],
            request.auth["service_token"],
            request.auth["service_account_token"],
            ip_address,
            user_agent,
        )

        n = len(secrets_to_delete)
        return Response(
            {"message": f"Deleted {n} secret{'' if n == 1 else 's'}"},
            status=status.HTTP_200_OK,
        )
