from datetime import timedelta

from api.utils.secrets import (
    check_for_duplicates_blind,
    compute_key_digest,
    create_environment_folder_structure,
    get_environment_keys,
)
from api.utils.crypto import decrypt_asymmetric
from api.models import DynamicSecretLease, DynamicSecretLeaseEvent
from api.utils.rest import get_resolver_request_meta
from ee.integrations.secrets.dynamic.aws.utils import (
    create_aws_dynamic_secret_lease,
)
from ee.integrations.secrets.dynamic.providers import DynamicSecretProviders
from uuid import uuid4
from django.core.exceptions import ValidationError
from graphql import GraphQLError
from django.utils import timezone
import django_rq
from rq.job import Job
import logging
from django.apps import apps

logger = logging.getLogger(__name__)

DynamicSecret = apps.get_model("api", "DynamicSecret")


def validate_key_map(key_map, provider, environment, path, dynamic_secret_id=None):
    provider_def = None
    for prov in DynamicSecretProviders.__dict__.values():
        if isinstance(prov, dict) and prov.get("id") == provider:
            provider_def = prov
            break
    if not provider_def:
        raise ValidationError(f"Unsupported provider: {provider}")

    valid_creds = {c["id"]: c for c in provider_def.get("credentials", [])}
    validated_key_map = []

    env_pubkey, env_privkey = get_environment_keys(environment.id)

    for entry in key_map:
        decrypted_key_name = decrypt_asymmetric(
            entry["key_name"], env_privkey, env_pubkey
        )
        entry["dynamic_secret_id"] = dynamic_secret_id
        entry["path"] = path
        digest = compute_key_digest(decrypted_key_name, environment.id)
        entry["keyDigest"] = digest

    if check_for_duplicates_blind(key_map, environment):
        raise ValidationError("One or more secrets keys already exist ")

    for entry in key_map:
        if not isinstance(entry, dict):
            raise ValidationError(f"Invalid key_map entry (must be dict): {entry}")

        key_id = entry.get("id")
        key_name = entry.get("key_name")
        key_digest = entry.get("keyDigest")

        if key_id not in valid_creds:
            raise ValidationError(
                f"Invalid key id '{key_id}' for provider '{provider}'"
            )

        # fallback to provider default_key_name
        if not key_name:
            key_name = valid_creds[key_id].get("default_key_name")

        if not key_name:
            raise ValidationError(
                f"No key name provided for key id '{key_id}', and no default defined"
            )

        # Get masked property from provider definition
        masked = valid_creds[key_id].get("masked", True)  # default to masked

        validated_key_map.append(
            {
                "id": key_id,
                "key_name": key_name,
                "key_digest": key_digest,
                "masked": masked,
            }
        )

    return validated_key_map


def create_dynamic_secret(
    *,
    environment,
    path,
    name: str,
    description="",
    default_ttl,
    max_ttl,
    authentication=None,
    provider: str,
    config: dict,
    key_map: list,
) -> DynamicSecret:
    """
    Create a DynamicSecret with validated provider config.
    Used by both GraphQL resolvers and REST API.
    """

    Organisation = apps.get_model("api", "Organisation")

    org = environment.app.organisation
    if not org.plan == Organisation.ENTERPRISE_PLAN:
        raise Exception("Dynamic secrets are only available on the Enterprise plan.")

    # --- ensure name is unique in this environment and path ---
    if DynamicSecret.objects.filter(
        environment=environment,
        path=path,
        name=name,
        deleted_at=None,
    ).exists():
        raise ValidationError(
            f"A dynamic secret with name '{name}' already exists at this path."
        )

    # --- validate provider ---
    provider_def = None
    for prov in DynamicSecretProviders.__dict__.values():
        if isinstance(prov, dict) and prov.get("id") == provider:
            provider_def = prov
            break
    if not provider_def:
        raise ValidationError(f"Unsupported provider: {provider}")

    folder = None
    if path and path != "/":
        folder = create_environment_folder_structure(path, environment.id)

    # --- validate required config fields ---
    validated_config = {}
    for field in provider_def.get("config_map", []):
        fid = field["id"]
        required = field.get("required", False)
        default = field.get("default")

        if fid in config:
            validated_config[fid] = config[fid]
        elif required and default is None:
            raise ValidationError(f"Missing required config field: {fid}")
        elif default is not None:
            validated_config[fid] = default

    # --- validate key_map ---
    validated_key_map = validate_key_map(key_map, provider, environment, path)

    # --- construct DynamicSecret ---
    dynamic_secret = DynamicSecret.objects.create(
        id=uuid4(),
        environment=environment,
        folder=folder,
        path=path,
        name=name,
        description=description,
        default_ttl=default_ttl,
        max_ttl=max_ttl,
        authentication=authentication,
        provider=provider,
        config=validated_config,
        key_map=validated_key_map,
    )

    # Update environment timestamp
    environment.updated_at = timezone.now()
    environment.save(update_fields=["updated_at"])

    return dynamic_secret


def create_dynamic_secret_lease(
    secret,
    lease_name=None,
    ttl=None,
    organisation_member=None,
    service_account=None,
    request=None,
):
    try:
        lease_name = lease_name or secret.name
        ttl = ttl or int(secret.default_ttl.total_seconds())
        if secret.provider == "aws":
            lease, lease_data, meta = create_aws_dynamic_secret_lease(
                secret=secret,
                lease_name=lease_name,
                organisation_member=organisation_member,
                service_account=service_account,
                ttl_seconds=ttl,
            )

            # Record creation event with request metadata (if available)
            ip_address, user_agent = (None, None)
            if request is not None:
                try:
                    ip_address, user_agent = get_resolver_request_meta(request)
                except Exception:
                    logger.debug(
                        "Failed to read request meta for lease event", exc_info=True
                    )

            DynamicSecretLeaseEvent.objects.create(
                lease=lease,
                event_type=DynamicSecretLease.CREATED,
                organisation_member=(
                    organisation_member if organisation_member else None
                ),
                service_account=service_account if service_account else None,
                ip_address=ip_address,
                user_agent=user_agent,
                metadata=meta,
            )

            return lease, lease_data

    except ValidationError as e:
        logger.error(f"Error creating dynamic secret lease: {e}")
        raise GraphQLError(e.message)


def renew_dynamic_secret_lease(
    lease,
    ttl,
    request=None,
    organisation_member=None,
    service_account=None,
):
    if timedelta(seconds=ttl) > lease.secret.max_ttl:
        raise Exception(
            "The specified TTL exceeds the maximum TTL for this dynamic secret."
        )

    if lease.expires_at <= timezone.now():
        raise Exception("This lease has expired and cannot be renewed")

    else:
        lease.expires_at = timezone.now() + timedelta(seconds=ttl)
        lease.updated_at = timezone.now()

    # --- reschedule cleanup job ---
    scheduler = django_rq.get_scheduler("scheduled-jobs")

    # cancel the old job if it exists
    if lease.cleanup_job_id:
        try:
            old_job = Job.fetch(lease.cleanup_job_id, connection=scheduler.connection)
            old_job.cancel()
        except Exception as e:
            logger.info(f"Failed to delete job: {e}")
            pass

    lease.save()

    # enqueue a new revocation job
    schedule_lease_revocation(lease)

    # record renewal event
    ip_address, user_agent = (None, None)
    if request is not None:
        try:
            ip_address, user_agent = get_resolver_request_meta(request)
        except Exception:
            logger.debug(
                "Failed to read request meta for lease renewal event", exc_info=True
            )

    try:
        DynamicSecretLeaseEvent.objects.create(
            lease=lease,
            event_type=DynamicSecretLease.RENEWED,
            organisation_member=organisation_member,
            service_account=service_account,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata={"action": "renew", "ttl": ttl},
        )
    except Exception as e:
        logger.warning(f"Failed to create renewal event for lease {lease.id}: {e}")

    return lease


def schedule_lease_revocation(lease, immediate=False):
    """
    Schedule a job to revoke the lease at its expiry time.
    """

    # --- Schedule revocation ---

    if lease.revoked_at is not None:
        logger.info(f"Lease {lease.id} already revoked at {lease.revoked_at}")
        return

    scheduled_revoke_time = lease.expires_at
    if immediate:
        scheduled_revoke_time = timezone.now()

    scheduler = django_rq.get_scheduler("scheduled-jobs")

    if lease.secret.provider == "aws":
        from ee.integrations.secrets.dynamic.aws.utils import (
            revoke_aws_dynamic_secret_lease,
        )

        revoke_job = revoke_aws_dynamic_secret_lease

    job = scheduler.enqueue_at(
        scheduled_revoke_time,
        revoke_job,
        lease.id,
    )

    lease.cleanup_job_id = job.id
    lease.save()
