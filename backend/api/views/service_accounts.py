import json
import logging

from django.core.exceptions import ObjectDoesNotExist

from api.auth import PhaseTokenAuthentication
from api.models import (
    App,
    Environment,
    EnvironmentKey,
    OrganisationMember,
    Role,
    ServiceAccount,
    ServiceAccountToken,
)
from api.serializers import ServiceAccountSerializer
from api.utils.access.permissions import (
    role_has_global_access,
    user_has_permission,
)
from api.utils.crypto import (
    decrypt_asymmetric,
    ed25519_to_kx,
    encrypt_asymmetric,
    get_server_keypair,
    random_hex,
    split_secret_hex,
    wrap_share_hex,
)
from api.utils.environments import _ed25519_pk_to_curve25519, _wrap_env_secrets_for_key
from api.utils.rest import METHOD_TO_ACTION
from api.utils.service_accounts import generate_server_managed_sa_keys
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import CamelCaseJSONRenderer
from django.conf import settings
from django.db import transaction

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"


def _serialize_sa(sa):
    """Serialize a ServiceAccount with token count and timestamps."""
    data = ServiceAccountSerializer(sa).data
    data["created_at"] = sa.created_at
    data["updated_at"] = sa.updated_at
    return data


def _serialize_sa_detail(sa):
    """Serialize a ServiceAccount with full detail including tokens and app access."""
    data = _serialize_sa(sa)

    # Include non-deleted tokens (name, id, created_at only — no secret material)
    tokens = sa.serviceaccounttoken_set.filter(deleted_at=None).order_by("-created_at")
    data["tokens"] = [
        {
            "id": t.id,
            "name": t.name,
            "created_at": t.created_at,
            "expires_at": t.expires_at,
        }
        for t in tokens
    ]

    # Include app memberships with environment access
    apps_data = []
    for app in sa.apps.filter(is_deleted=False).order_by("-created_at"):
        env_keys = EnvironmentKey.objects.filter(
            service_account=sa,
            environment__app=app,
            deleted_at=None,
        ).select_related("environment")
        apps_data.append(
            {
                "id": str(app.id),
                "name": app.name,
                "environments": [
                    {
                        "id": str(ek.environment.id),
                        "name": ek.environment.name,
                        "env_type": ek.environment.env_type,
                    }
                    for ek in env_keys
                ],
            }
        )
    data["apps"] = apps_data

    return data


class PublicServiceAccountsView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise PermissionDenied(f"Unsupported HTTP method: {request.method}")

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, action, "ServiceAccounts", org, False, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} service accounts."
                )

    def get(self, request, *args, **kwargs):
        org = self._get_org(request)

        service_accounts = ServiceAccount.objects.filter(
            organisation=org,
            deleted_at=None,
        ).select_related("role").order_by("-created_at")

        data = [_serialize_sa(sa) for sa in service_accounts]
        return Response(data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        org = self._get_org(request)

        # --- Validate input ---
        name = request.data.get("name")
        if not name or not str(name).strip():
            return Response(
                {"error": "Missing required field: name"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        name = str(name).strip()
        if len(name) > 64:
            return Response(
                {"error": "Service account name cannot exceed 64 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Validate role ---
        role_id = request.data.get("role_id")
        if not role_id:
            return Response(
                {"error": "Missing required field: role_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            role = Role.objects.get(id=role_id, organisation=org)
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Role not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if role_has_global_access(role):
            return Response(
                {"error": f"Service accounts cannot be assigned the '{role.name}' role."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Generate cryptographic material ---
        identity_key, server_wrapped_keyring, server_wrapped_recovery = (
            generate_server_managed_sa_keys()
        )

        # --- Create service account ---
        try:
            with transaction.atomic():
                sa = ServiceAccount.objects.create(
                    name=name,
                    organisation=org,
                    role=role,
                    identity_key=identity_key,
                    server_wrapped_keyring=server_wrapped_keyring,
                    server_wrapped_recovery=server_wrapped_recovery,
                )
        except ValueError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_403_FORBIDDEN,
            )

        if CLOUD_HOSTED:
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(org)

        # --- Mint an initial token ---
        token_name = request.data.get("token_name", "Default")

        pk, sk = get_server_keypair()
        keyring_json = decrypt_asymmetric(
            sa.server_wrapped_keyring, sk.hex(), pk.hex()
        )
        keyring = json.loads(keyring_json)
        kx_pub, kx_priv = ed25519_to_kx(keyring["publicKey"], keyring["privateKey"])

        wrap_key = random_hex(32)
        token_value = random_hex(32)
        share_a, share_b = split_secret_hex(kx_priv)
        wrapped_share_b = wrap_share_hex(share_b, wrap_key)

        # Determine creator
        created_by = None
        created_by_sa = None
        if request.auth["auth_type"] == "User":
            created_by = request.auth["org_member"]
        elif request.auth["auth_type"] == "ServiceAccount":
            created_by_sa = request.auth["service_account"]

        ServiceAccountToken.objects.create(
            service_account=sa,
            name=str(token_name).strip()[:64],
            identity_key=kx_pub,
            token=token_value,
            wrapped_key_share=wrapped_share_b,
            created_by=created_by,
            created_by_service_account=created_by_sa,
        )

        full_token = f"pss_service:v2:{token_value}:{kx_pub}:{share_a}:{wrap_key}"
        bearer_token = f"ServiceAccount {token_value}"

        response_data = _serialize_sa(sa)
        response_data["token"] = full_token
        response_data["bearer_token"] = bearer_token
        return Response(response_data, status=status.HTTP_201_CREATED)


class PublicServiceAccountDetailView(APIView):
    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        action = METHOD_TO_ACTION.get(request.method)
        if not action:
            raise PermissionDenied(f"Unsupported HTTP method: {request.method}")

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, action, "ServiceAccounts", org, False, is_sa
            ):
                raise PermissionDenied(
                    f"You don't have permission to {action} service accounts."
                )

    def _get_service_account(self, request, sa_id):
        org = self._get_org(request)
        try:
            return ServiceAccount.objects.select_related("role").get(
                id=sa_id,
                organisation=org,
                deleted_at=None,
            )
        except (ObjectDoesNotExist, ValueError):
            return None

    def get(self, request, sa_id, *args, **kwargs):
        sa = self._get_service_account(request, sa_id)
        if sa is None:
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_serialize_sa_detail(sa), status=status.HTTP_200_OK)

    def put(self, request, sa_id, *args, **kwargs):
        sa = self._get_service_account(request, sa_id)
        if sa is None:
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        name = request.data.get("name")
        role_id = request.data.get("role_id")

        if name is None and role_id is None:
            return Response(
                {"error": "At least one of 'name' or 'role_id' must be provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if name is not None:
            if not name or str(name).strip() == "":
                return Response(
                    {"error": "Service account name cannot be blank."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(str(name)) > 64:
                return Response(
                    {"error": "Service account name cannot exceed 64 characters."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            sa.name = str(name).strip()

        if role_id is not None:
            try:
                role = Role.objects.get(id=role_id, organisation=sa.organisation)
            except (ObjectDoesNotExist, ValueError):
                return Response(
                    {"error": "Role not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            if role_has_global_access(role):
                return Response(
                    {"error": f"Service accounts cannot be assigned the '{role.name}' role."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            sa.role = role

        sa.save()
        return Response(_serialize_sa_detail(sa), status=status.HTTP_200_OK)

    def delete(self, request, sa_id, *args, **kwargs):
        sa = self._get_service_account(request, sa_id)
        if sa is None:
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        sa.delete()

        if CLOUD_HOSTED:
            from ee.billing.stripe import update_stripe_subscription_seats

            update_stripe_subscription_seats(sa.organisation)

        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicServiceAccountAccessView(APIView):
    """
    Manage app and environment access for a service account.

    PUT /service-accounts/<sa_id>/access/

    Request body:
        {
            "apps": [
                {
                    "id": "<app_id>",
                    "environments": ["<env_id_1>", "<env_id_2>"]
                },
                ...
            ]
        }

    This replaces the service account's entire access configuration.
    - Apps not in the list are removed.
    - Environment access is granted by creating EnvironmentKey records
      with server-wrapped keys for the SA's identity key.
    - Environments not in the list for a given app are revoked.
    """

    authentication_classes = [PhaseTokenAuthentication]
    permission_classes = [IsAuthenticated, IsIPAllowed]
    throttle_classes = [PlanBasedRateThrottle]
    renderer_classes = [CamelCaseJSONRenderer]

    def _get_org(self, request):
        if request.auth.get("organisation"):
            return request.auth["organisation"]
        if request.auth.get("app"):
            return request.auth["app"].organisation
        raise PermissionDenied("Could not resolve organisation from request.")

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        # Access management requires "update" on ServiceAccounts
        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(
                account, "update", "ServiceAccounts", org, False, is_sa
            ):
                raise PermissionDenied(
                    "You don't have permission to update service accounts."
                )

    def put(self, request, sa_id, *args, **kwargs):
        org = self._get_org(request)

        try:
            sa = ServiceAccount.objects.select_related("role").get(
                id=sa_id,
                organisation=org,
                deleted_at=None,
            )
        except (ObjectDoesNotExist, ValueError):
            return Response(
                {"error": "Service account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # --- Validate input ---
        apps_input = request.data.get("apps")
        if apps_input is None:
            return Response(
                {"error": "Missing required field: apps"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(apps_input, list):
            return Response(
                {"error": "'apps' must be a list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Resolve all apps and environments upfront ---
        desired_app_ids = set()
        desired_env_map = {}  # app_id -> set of env_ids

        for app_entry in apps_input:
            if not isinstance(app_entry, dict):
                return Response(
                    {"error": "Each entry in 'apps' must be an object with 'id' and 'environments'."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            app_id = app_entry.get("id")
            if not app_id:
                return Response(
                    {"error": "Each app entry must have an 'id' field."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                app = App.objects.get(id=app_id, organisation=org, is_deleted=False)
            except (ObjectDoesNotExist, ValueError):
                return Response(
                    {"error": f"App not found: {app_id}"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if not app.sse_enabled:
                return Response(
                    {"error": f"App '{app.name}' does not have SSE enabled. Only SSE apps are supported."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            env_ids = app_entry.get("environments", [])
            if not isinstance(env_ids, list):
                return Response(
                    {"error": f"'environments' for app '{app_id}' must be a list of environment IDs."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Validate all env IDs belong to this app
            valid_envs = set(
                Environment.objects.filter(
                    app=app,
                    id__in=env_ids,
                ).values_list("id", flat=True)
            )
            invalid_ids = set(str(e) for e in env_ids) - set(str(e) for e in valid_envs)
            if invalid_ids:
                return Response(
                    {"error": f"Environment(s) not found in app '{app.name}': {', '.join(invalid_ids)}"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            desired_app_ids.add(str(app.id))
            desired_env_map[str(app.id)] = valid_envs

        # --- Check SA has server-wrapped keyring for key wrapping ---
        if not sa.server_wrapped_keyring:
            return Response(
                {"error": "Service account does not have server-side key management enabled."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Decrypt SA keyring to get its public key for env key wrapping
        server_pk, server_sk = get_server_keypair()
        keyring_json = decrypt_asymmetric(
            sa.server_wrapped_keyring, server_sk.hex(), server_pk.hex()
        )
        keyring = json.loads(keyring_json)
        sa_kx_pub = _ed25519_pk_to_curve25519(keyring["publicKey"])

        # --- Apply changes atomically ---
        with transaction.atomic():
            # 1. Remove app memberships not in the desired list
            current_app_ids = set(
                str(a.id) for a in sa.apps.filter(is_deleted=False)
            )
            apps_to_remove = current_app_ids - desired_app_ids
            if apps_to_remove:
                apps_to_remove_qs = App.objects.filter(id__in=apps_to_remove)
                sa.apps.remove(*apps_to_remove_qs)
                # Soft-delete env keys for removed apps
                EnvironmentKey.objects.filter(
                    service_account=sa,
                    environment__app__id__in=apps_to_remove,
                    deleted_at=None,
                ).update(deleted_at=sa.updated_at)

            # 2. Add new app memberships
            apps_to_add = desired_app_ids - current_app_ids
            if apps_to_add:
                sa.apps.add(*App.objects.filter(id__in=apps_to_add))

            # 3. Sync environment access per app
            for app_id_str, desired_envs in desired_env_map.items():
                desired_env_id_strs = set(str(e) for e in desired_envs)

                # Get current env keys for this SA + app
                current_env_keys = EnvironmentKey.objects.filter(
                    service_account=sa,
                    environment__app_id=app_id_str,
                    deleted_at=None,
                )
                current_env_ids = set(
                    str(ek.environment_id) for ek in current_env_keys
                )

                # Revoke access to environments not in the desired list
                envs_to_revoke = current_env_ids - desired_env_id_strs
                if envs_to_revoke:
                    EnvironmentKey.objects.filter(
                        service_account=sa,
                        environment_id__in=envs_to_revoke,
                        deleted_at=None,
                    ).update(deleted_at=sa.updated_at)

                # Grant access to new environments
                envs_to_grant = desired_env_id_strs - current_env_ids
                if envs_to_grant:
                    from api.models import ServerEnvironmentKey

                    new_env_keys = []
                    for env_id in envs_to_grant:
                        # Get the ServerEnvironmentKey to obtain the env seed/salt
                        try:
                            sek = ServerEnvironmentKey.objects.get(
                                environment_id=env_id,
                                deleted_at=None,
                            )
                        except ObjectDoesNotExist:
                            logger.warning(
                                "No ServerEnvironmentKey for env %s — skipping.",
                                env_id,
                            )
                            continue

                        # Decrypt env seed/salt from server key
                        env_seed = decrypt_asymmetric(
                            sek.wrapped_seed, server_sk.hex(), server_pk.hex()
                        )
                        env_salt = decrypt_asymmetric(
                            sek.wrapped_salt, server_sk.hex(), server_pk.hex()
                        )

                        # Re-wrap for the SA's identity key
                        wrapped_seed, wrapped_salt = _wrap_env_secrets_for_key(
                            env_seed, env_salt, sa_kx_pub
                        )

                        env = Environment.objects.get(id=env_id)
                        new_env_keys.append(
                            EnvironmentKey(
                                environment=env,
                                service_account=sa,
                                identity_key=sek.identity_key,
                                wrapped_seed=wrapped_seed,
                                wrapped_salt=wrapped_salt,
                            )
                        )

                    if new_env_keys:
                        EnvironmentKey.objects.bulk_create(new_env_keys)

        return Response(_serialize_sa_detail(sa), status=status.HTTP_200_OK)
