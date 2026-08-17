"""Provider-agnostic rotation engine."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Optional

import django_rq
from django.apps import apps
from django.db import transaction
from django.utils import timezone
from django_rq import job
from api.utils.crypto import encrypt_asymmetric
from api.utils.secrets import get_environment_keys
from api.utils.syncing.auth import get_credentials

from ee.integrations.secrets.providers.exceptions import (
    ProviderConfigError,
    ProviderError,
    ProviderNotFound,
    ProviderTransientError,
)
from ee.integrations.secrets.providers.sanitize import sanitize

from .providers import get_provider

logger = logging.getLogger(__name__)

QUEUE_NAME = "scheduled-jobs"

MINT_BACKOFF_SECONDS = (60, 300, 1800, 7200)
REVOKE_BACKOFF_SECONDS = (60, 300, 1800, 7200, 21600, 43200, 86400)
MAX_CONSECUTIVE_TRANSIENT_FAILURES = 5


def record_event(
    rotating_secret,
    event_type,
    *,
    credential=None,
    organisation_member=None,
    service_account=None,
    ip_address=None,
    user_agent=None,
    metadata: Optional[dict] = None,
):
    RotatingSecretEvent = apps.get_model("api", "RotatingSecretEvent")
    try:
        RotatingSecretEvent.objects.create(
            rotating_secret=rotating_secret,
            credential=credential,
            event_type=event_type,
            organisation_member=organisation_member,
            service_account=service_account,
            ip_address=ip_address,
            user_agent=user_agent,
            metadata=sanitize(metadata or {}),
        )
    except Exception:
        logger.exception(
            "Failed to record rotation event",
            extra={
                "rotating_secret_id": rotating_secret.id,
                "event_type": event_type,
            },
        )


def _materialise_secret_rows(rotating_secret, credential) -> None:
    Secret = apps.get_model("api", "Secret")
    SecretEvent = apps.get_model("api", "SecretEvent")
    key_map = rotating_secret.key_map or []
    encrypted_values = credential.encrypted_values or {}
    for entry in key_map:
        if not isinstance(entry, dict):
            continue
        output_id = entry.get("id")
        encrypted_value = encrypted_values.get(output_id) if output_id else None
        if not output_id or encrypted_value is None:
            continue
        encrypted_key_name = entry.get("key_name") or entry.get("key") or ""
        key_digest = entry.get("key_digest") or entry.get("keyDigest") or ""
        secret, created = Secret.objects.get_or_create(
            rotating_secret=rotating_secret,
            rotating_output_id=output_id,
            defaults={
                "environment": rotating_secret.environment,
                "folder": rotating_secret.folder,
                "path": rotating_secret.path,
                "key": encrypted_key_name,
                "key_digest": key_digest,
                "value": encrypted_value,
                "comment": "",
                "type": "secret",
            },
        )
        if not created:
            # Only rotate the value — tags/comment/type are user-owned.
            new_version = secret.version + 1
            Secret.objects.filter(id=secret.id).update(
                value=encrypted_value,
                version=new_version,
            )
            secret.value = encrypted_value
            secret.version = new_version

        # No actor — engine-driven. Frontend renders these as "Phase".
        SecretEvent.objects.create(
            secret=secret,
            environment=secret.environment,
            folder=secret.folder,
            path=secret.path,
            key=secret.key,
            key_digest=secret.key_digest,
            value=secret.value,
            version=secret.version,
            comment=secret.comment,
            type=secret.type,
            event_type=SecretEvent.CREATE if created else SecretEvent.UPDATE,
        )


def encrypt_values_for_env(values: dict, environment) -> dict:
    env_pubkey, _ = get_environment_keys(environment.id)
    return {k: encrypt_asymmetric(str(v), env_pubkey) for k, v in values.items()}


def _set_health(rotating_secret, status, *, reason: str = ""):
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    prior = rotating_secret.health
    rotating_secret.health = status
    if status == RotatingSecret.HEALTHY:
        rotating_secret.consecutive_failure_count = 0
        rotating_secret.last_failure_at = None
        rotating_secret.last_failure_reason = ""
    else:
        rotating_secret.last_failure_at = timezone.now()
        rotating_secret.last_failure_reason = reason[:1024]
    rotating_secret.save(
        update_fields=[
            "health",
            "consecutive_failure_count",
            "last_failure_at",
            "last_failure_reason",
            "updated_at",
        ]
    )

    if prior == status:
        return
    if status == RotatingSecret.DEGRADED:
        record_event(
            rotating_secret,
            "health_degraded",
            metadata={"reason": reason},
        )
        _notify_health_transition(rotating_secret)
    elif status == RotatingSecret.FAILED:
        record_event(
            rotating_secret,
            "health_failed",
            metadata={"reason": reason},
        )
        _notify_health_transition(rotating_secret)
    elif status == RotatingSecret.HEALTHY and prior != RotatingSecret.HEALTHY:
        record_event(rotating_secret, "health_recovered")


def _notify_health_transition(rotating_secret) -> None:
    # Best-effort enqueue — never let a Redis blip in the email queue knock
    # over the rotation worker. The audit event is already recorded above.
    try:
        from api.tasks.emails import send_rotation_unhealthy_email_job

        send_rotation_unhealthy_email_job(rotating_secret.id)
    except Exception:
        logger.exception(
            "Failed to enqueue rotation-unhealthy email",
            extra={"rotating_secret_id": rotating_secret.id},
        )


def _scheduler():
    return django_rq.get_scheduler(QUEUE_NAME)


def _cancel_job(job_id: Optional[str]) -> None:
    # scheduler.cancel() removes the entry from rq-scheduler's sorted set
    # (ZREM). Job.cancel() alone only marks the job state and leaves the
    # scheduler-side entry, so the job still fires at its scheduled time.
    if not job_id:
        return
    scheduler = _scheduler()
    try:
        scheduler.cancel(job_id)
    except Exception:
        logger.debug("Could not cancel scheduled job %s", job_id, exc_info=True)


def _schedule_next_rotation(rotating_secret, *, delay: Optional[timedelta] = None):
    _cancel_job(rotating_secret.rotation_job_id)
    # bool(timedelta(0)) is False — explicit None check so a zero-remaining
    # resume fires immediately instead of waiting a full interval.
    effective_delay = delay if delay is not None else rotating_secret.rotation_interval
    when = timezone.now() + effective_delay
    new_job = _scheduler().enqueue_at(when, perform_rotation, rotating_secret.id)
    rotating_secret.rotation_job_id = new_job.id
    rotating_secret.next_rotation_at = when
    rotating_secret.save(update_fields=["rotation_job_id", "next_rotation_at", "updated_at"])


def cancel_rotation_jobs(rotating_secret) -> None:
    _cancel_job(rotating_secret.rotation_job_id)
    for cred in rotating_secret.credentials.all():
        _cancel_job(cred.revoke_job_id)


def _mint_once(rotating_secret, *, actor_kwargs: dict, manual: bool):
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")

    provider_cls = get_provider(rotating_secret.provider)
    # ProviderCredentials FK is SET_NULL on delete — surface a typed error
    # so the failure path records the event and pauses the schedule.
    if not rotating_secret.authentication_id:
        raise ProviderConfigError(
            "Rotating secret has no root credentials",
            user_message=(
                "Root credentials are missing. Reattach a provider credential "
                "in the rotating-secret config and resume rotation."
            ),
        )
    root_creds = get_credentials(rotating_secret.authentication_id)

    attempt_number = rotating_secret.consecutive_failure_count + 1
    record_event(
        rotating_secret,
        "mint_attempted",
        metadata={
            "attempt_number": attempt_number,
            "manual": manual,
            "provider": rotating_secret.provider,
        },
        **actor_kwargs,
    )

    try:
        result = provider_cls.mint(
            root_creds,
            rotating_secret.config,
            caller_id=str(rotating_secret.id),
        )
    except ProviderError as e:
        record_event(
            rotating_secret,
            "mint_failed",
            metadata={
                "attempt_number": attempt_number,
                "error_class": e.__class__.__name__,
                "user_message": e.user_message,
                "raw": e.raw,
                "is_terminal": not e.retryable,
                "manual": manual,
                "provider": rotating_secret.provider,
            },
            **actor_kwargs,
        )
        raise

    try:
        encrypted = encrypt_values_for_env(result.values, rotating_secret.environment)
    except Exception as e:
        logger.exception(
            "Encryption failed after mint; attempting compensating revoke",
            extra={"rotating_secret_id": rotating_secret.id},
        )
        try:
            provider_cls.revoke(root_creds, result.provider_credential_id)
        except Exception:
            record_event(
                rotating_secret,
                "orphaned_credential",
                metadata={
                    "provider_credential_id": result.provider_credential_id,
                    "reason": "encryption_failed",
                },
            )
        raise ProviderConfigError(
            f"Encryption failed after mint: {e}",
            user_message="Internal error encrypting the new credential.",
        ) from e

    # Savepoint: outer perform_rotation catches ProviderError + returns,
    # which would commit a phantom ACTIVE cred whose key we've revoked.
    try:
        with transaction.atomic():
            cred = RotatingSecretCredential.objects.create(
                rotating_secret=rotating_secret,
                status=RotatingSecretCredential.ACTIVE,
                provider_credential_id=result.provider_credential_id,
                encrypted_values=encrypted,
                metadata=sanitize(result.metadata),
            )
            _materialise_secret_rows(rotating_secret, cred)
    except Exception as e:
        logger.exception(
            "DB write failed after mint; attempting compensating revoke",
            extra={"rotating_secret_id": rotating_secret.id},
        )
        try:
            provider_cls.revoke(root_creds, result.provider_credential_id)
        except Exception:
            record_event(
                rotating_secret,
                "orphaned_credential",
                metadata={
                    "provider_credential_id": result.provider_credential_id,
                    "reason": "db_write_failed",
                },
            )
        raise ProviderConfigError(
            f"DB write failed after mint: {e}",
            user_message="Internal error persisting the new credential.",
        ) from e

    return cred


def _retire_prior_credential(rotating_secret, new_credential, *, actor_kwargs: dict):
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    prior = (
        rotating_secret.credentials.filter(status=RotatingSecretCredential.ACTIVE)
        .exclude(id=new_credential.id)
        .order_by("-created_at")
        .first()
    )
    if prior is None:
        return

    delay = rotating_secret.revocation_delay or timedelta(0)
    if delay.total_seconds() <= 0:
        revoke_credential(prior.id, immediate=True, actor_kwargs=actor_kwargs)
        return

    prior.status = RotatingSecretCredential.EXPIRING
    prior.expire_at = timezone.now() + delay
    prior.save(update_fields=["status", "expire_at"])

    _cancel_job(prior.revoke_job_id)
    new_job = _scheduler().enqueue_at(prior.expire_at, revoke_credential, prior.id)
    prior.revoke_job_id = new_job.id
    prior.save(update_fields=["revoke_job_id"])


def perform_initial_rotation(rotating_secret, *, actor_kwargs: dict):
    RotatingSecret = apps.get_model("api", "RotatingSecret")

    with transaction.atomic():
        rotating_secret = (
            RotatingSecret.objects.select_for_update().get(id=rotating_secret.id)
        )
        cred = _mint_once(rotating_secret, actor_kwargs=actor_kwargs, manual=False)
        record_event(
            rotating_secret,
            "rotated",
            credential=cred,
            metadata={
                "initial": True,
                "provider": rotating_secret.provider,
                "provider_credential_id": cred.provider_credential_id,
                "mint_response": cred.metadata,
            },
            **actor_kwargs,
        )
        _set_health(rotating_secret, RotatingSecret.HEALTHY)
        _schedule_next_rotation(rotating_secret)
    return cred


@job(QUEUE_NAME, timeout=120)
def perform_rotation(rotating_secret_id, *, manual: bool = False, actor_kwargs: Optional[dict] = None):
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    actor_kwargs = actor_kwargs or {}

    try:
        with transaction.atomic():
            rs = RotatingSecret.objects.select_for_update().get(
                id=rotating_secret_id, deleted_at__isnull=True
            )
            if not rs.is_active:
                logger.info(
                    "Skipping rotation for paused secret %s", rotating_secret_id
                )
                return

            try:
                cred = _mint_once(rs, actor_kwargs=actor_kwargs, manual=manual)
            except ProviderError as e:
                _handle_mint_failure(rs, e)
                return

            _retire_prior_credential(rs, cred, actor_kwargs=actor_kwargs)
            record_event(
                rs,
                "manual_rotate" if manual else "rotated",
                credential=cred,
                metadata={
                    "provider": rs.provider,
                    "provider_credential_id": cred.provider_credential_id,
                    "mint_response": cred.metadata,
                },
                **actor_kwargs,
            )
            rs.consecutive_failure_count = 0
            rs.save(update_fields=["consecutive_failure_count", "updated_at"])
            _set_health(rs, RotatingSecret.HEALTHY)
            _schedule_next_rotation(rs)

            try:
                env = rs.environment
                env.updated_at = timezone.now()
                env.save(update_fields=["updated_at"])
            except Exception:
                logger.debug("Failed to bump env updated_at after rotation", exc_info=True)
    except RotatingSecret.DoesNotExist:
        logger.info(
            "Rotation skipped: RotatingSecret %s not found / deleted",
            rotating_secret_id,
        )
    except Exception as e:
        # Unknown failure (e.g. Redis ConnectionError post-mint, DB integrity
        # error). Atomic has rolled back; surface as DEGRADED + retry rather
        # than letting the rotation chain silently break.
        logger.exception(
            "Unexpected error during rotation",
            extra={"rotating_secret_id": rotating_secret_id},
        )
        _record_unknown_failure(rotating_secret_id, e, actor_kwargs=actor_kwargs, manual=manual)
        raise


def _record_unknown_failure(rotating_secret_id, error, *, actor_kwargs, manual):
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    try:
        rs = RotatingSecret.objects.get(id=rotating_secret_id, deleted_at__isnull=True)
    except RotatingSecret.DoesNotExist:
        return
    record_event(
        rs,
        "mint_failed",
        metadata={
            "error_class": error.__class__.__name__,
            "user_message": "Internal error during rotation",
            "raw": {"message": str(error)[:512]},
            "is_terminal": False,
            "manual": manual,
            "provider": rs.provider,
        },
        **(actor_kwargs or {}),
    )
    rs.consecutive_failure_count = rs.consecutive_failure_count + 1
    rs.save(update_fields=["consecutive_failure_count", "updated_at"])
    _set_health(rs, RotatingSecret.DEGRADED, reason=str(error)[:256])
    try:
        _schedule_next_rotation(rs, delay=timedelta(seconds=MINT_BACKOFF_SECONDS[0]))
    except Exception:
        logger.exception(
            "Failed to reschedule after unknown rotation error",
            extra={"rotating_secret_id": rotating_secret_id},
        )


def _handle_mint_failure(rotating_secret, error: ProviderError):
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    rotating_secret.consecutive_failure_count = (
        rotating_secret.consecutive_failure_count + 1
    )

    if isinstance(error, ProviderTransientError):
        if rotating_secret.consecutive_failure_count >= MAX_CONSECUTIVE_TRANSIENT_FAILURES:
            rotating_secret.is_active = False
            rotating_secret.save(update_fields=["consecutive_failure_count", "is_active", "updated_at"])
            _set_health(rotating_secret, RotatingSecret.FAILED, reason=error.user_message)
            return
        attempt = min(
            rotating_secret.consecutive_failure_count - 1,
            len(MINT_BACKOFF_SECONDS) - 1,
        )
        delay = timedelta(seconds=MINT_BACKOFF_SECONDS[attempt])
        if delay > rotating_secret.rotation_interval:
            delay = rotating_secret.rotation_interval
        rotating_secret.save(update_fields=["consecutive_failure_count", "updated_at"])
        _set_health(rotating_secret, RotatingSecret.DEGRADED, reason=error.user_message)
        _schedule_next_rotation(rotating_secret, delay=delay)
        return

    rotating_secret.is_active = False
    rotating_secret.save(update_fields=["consecutive_failure_count", "is_active", "updated_at"])
    _set_health(rotating_secret, RotatingSecret.FAILED, reason=error.user_message)


@job(QUEUE_NAME, timeout=120)
def revoke_credential(credential_id, *, immediate: bool = False, actor_kwargs: Optional[dict] = None):
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    actor_kwargs = actor_kwargs or {}

    # Row lock serialises a manual immediate revoke racing with the scheduled revoke job.
    with transaction.atomic():
        try:
            cred = (
                RotatingSecretCredential.objects.select_for_update()
                .select_related("rotating_secret")
                .get(id=credential_id)
            )
        except RotatingSecretCredential.DoesNotExist:
            logger.info("Revoke skipped: credential %s not found", credential_id)
            return

        if cred.status == RotatingSecretCredential.REVOKED and cred.revoked_at is not None:
            return

        cred.status = RotatingSecretCredential.REVOKING
        cred.save(update_fields=["status"])

    rs = cred.rotating_secret

    try:
        provider_cls = get_provider(rs.provider)
        root_creds = (
            get_credentials(rs.authentication_id) if rs.authentication_id else {}
        )
    except Exception as e:
        logger.exception(
            "Failed to load provider/root creds for revoke",
            extra={"credential_id": credential_id},
        )
        _mark_revoke_unknown_failure(cred, e, actor_kwargs=actor_kwargs)
        raise

    record_event(
        rs,
        "revoke_attempted",
        credential=cred,
        metadata={
            "immediate": immediate,
            "failure_count": cred.failure_count,
            "provider": rs.provider,
            "provider_credential_id": cred.provider_credential_id,
        },
        **actor_kwargs,
    )

    try:
        provider_summary = provider_cls.revoke(root_creds, cred.provider_credential_id)
    except ProviderNotFound as e:
        cred.status = RotatingSecretCredential.REVOKED
        cred.revoked_at = timezone.now()
        cred.failure_count = 0
        cred.last_failure_reason = ""
        cred.save(
            update_fields=["status", "revoked_at", "failure_count", "last_failure_reason"]
        )
        record_event(
            rs,
            "revoked",
            credential=cred,
            metadata={
                "reason": "not_found_at_provider",
                "user_message": e.user_message,
                "provider": rs.provider,
                "provider_credential_id": cred.provider_credential_id,
                "raw": e.raw,
            },
            **actor_kwargs,
        )
        return
    except ProviderTransientError as e:
        _handle_revoke_failure(cred, e, transient=True, actor_kwargs=actor_kwargs)
        return
    except ProviderError as e:
        _handle_revoke_failure(cred, e, transient=False, actor_kwargs=actor_kwargs)
        return
    except Exception as e:
        # Unknown failure after we've already set REVOKING — without this,
        # the credential stays REVOKING forever.
        logger.exception(
            "Unknown error during revoke",
            extra={"credential_id": credential_id},
        )
        _mark_revoke_unknown_failure(cred, e, actor_kwargs=actor_kwargs)
        raise

    try:
        cred.status = RotatingSecretCredential.REVOKED
        cred.revoked_at = timezone.now()
        cred.failure_count = 0
        cred.last_failure_reason = ""
        cred.save(
            update_fields=["status", "revoked_at", "failure_count", "last_failure_reason"]
        )
        record_event(
            rs,
            "revoked",
            credential=cred,
            metadata={
                "provider": rs.provider,
                "provider_credential_id": cred.provider_credential_id,
                "revoke_response": provider_summary,
            },
            **actor_kwargs,
        )
    except Exception as e:
        logger.exception(
            "Failed to persist revoked state after successful provider revoke",
            extra={"credential_id": credential_id},
        )
        _mark_revoke_unknown_failure(cred, e, actor_kwargs=actor_kwargs)
        raise


def _mark_revoke_unknown_failure(cred, error, *, actor_kwargs):
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    try:
        cred.failure_count = cred.failure_count + 1
        cred.last_failure_reason = str(error)[:1024]
        cred.status = RotatingSecretCredential.REVOKE_FAILED
        cred.save(update_fields=["status", "failure_count", "last_failure_reason"])
        record_event(
            cred.rotating_secret,
            "revoke_failed",
            credential=cred,
            metadata={
                "error_class": error.__class__.__name__,
                "user_message": "Internal error during revoke",
                "raw": {"message": str(error)[:512]},
                "is_terminal": True,
                "provider": cred.rotating_secret.provider,
                "provider_credential_id": cred.provider_credential_id,
            },
            **(actor_kwargs or {}),
        )
    except Exception:
        logger.exception("Failed to mark credential as REVOKE_FAILED")


def _handle_revoke_failure(cred, error: ProviderError, *, transient: bool, actor_kwargs: dict):
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    cred.failure_count = cred.failure_count + 1
    cred.last_failure_reason = error.user_message[:1024]

    if transient and cred.failure_count <= len(REVOKE_BACKOFF_SECONDS):
        delay = timedelta(seconds=REVOKE_BACKOFF_SECONDS[cred.failure_count - 1])
        cred.save(update_fields=["failure_count", "last_failure_reason"])
        _cancel_job(cred.revoke_job_id)
        new_job = _scheduler().enqueue_at(
            timezone.now() + delay, revoke_credential, cred.id
        )
        cred.revoke_job_id = new_job.id
        cred.save(update_fields=["revoke_job_id"])
        record_event(
            cred.rotating_secret,
            "revoke_failed",
            credential=cred,
            metadata={
                "attempt_number": cred.failure_count,
                "error_class": error.__class__.__name__,
                "user_message": error.user_message,
                "raw": error.raw,
                "is_terminal": False,
                "next_retry_at": (timezone.now() + delay).isoformat(),
                "provider": cred.rotating_secret.provider,
                "provider_credential_id": cred.provider_credential_id,
            },
            **actor_kwargs,
        )
        return

    cred.status = RotatingSecretCredential.REVOKE_FAILED
    cred.save(update_fields=["status", "failure_count", "last_failure_reason"])
    record_event(
        cred.rotating_secret,
        "revoke_failed",
        credential=cred,
        metadata={
            "attempt_number": cred.failure_count,
            "error_class": error.__class__.__name__,
            "user_message": error.user_message,
            "raw": error.raw,
            "is_terminal": True,
            "provider": cred.rotating_secret.provider,
            "provider_credential_id": cred.provider_credential_id,
        },
        **actor_kwargs,
    )


def manual_rotate(rotating_secret, *, actor_kwargs: Optional[dict] = None):
    """Break-glass rotation: mint a fresh credential and immediately revoke every
    other live credential (ACTIVE / EXPIRING / REVOKING / PENDING), bypassing
    the configured revocation_delay overlap window.
    """
    RotatingSecret = apps.get_model("api", "RotatingSecret")
    RotatingSecretCredential = apps.get_model("api", "RotatingSecretCredential")
    actor_kwargs = actor_kwargs or {}

    live_statuses = [
        RotatingSecretCredential.PENDING,
        RotatingSecretCredential.ACTIVE,
        RotatingSecretCredential.EXPIRING,
        RotatingSecretCredential.REVOKING,
    ]

    others: list = []
    try:
        with transaction.atomic():
            rs = RotatingSecret.objects.select_for_update().get(
                id=rotating_secret.id, deleted_at__isnull=True
            )

            new_cred = _mint_once(rs, actor_kwargs=actor_kwargs, manual=True)

            others = list(
                rs.credentials.filter(status__in=live_statuses).exclude(id=new_cred.id)
            )
            for prior in others:
                _cancel_job(prior.revoke_job_id)

            record_event(
                rs,
                "manual_rotate",
                credential=new_cred,
                metadata={
                    "provider": rs.provider,
                    "provider_credential_id": new_cred.provider_credential_id,
                    "mint_response": new_cred.metadata,
                    "emergency": True,
                    "revoked_count": len(others),
                },
                **actor_kwargs,
            )
            rs.consecutive_failure_count = 0
            rs.save(update_fields=["consecutive_failure_count", "updated_at"])
            _set_health(rs, RotatingSecret.HEALTHY)
            _schedule_next_rotation(rs)

            try:
                env = rs.environment
                env.updated_at = timezone.now()
                env.save(update_fields=["updated_at"])
            except Exception:
                logger.debug(
                    "Failed to bump env updated_at after emergency rotate",
                    exc_info=True,
                )
    except RotatingSecret.DoesNotExist:
        logger.info(
            "Emergency rotate skipped: RotatingSecret %s not found / deleted",
            rotating_secret.id,
        )
        return
    except ProviderError as e:
        # Failure bookkeeping outside the atomic so Redis side-effects in
        # _handle_mint_failure aren't paired with a rolled-back DB.
        try:
            rs = RotatingSecret.objects.get(
                id=rotating_secret.id, deleted_at__isnull=True
            )
        except RotatingSecret.DoesNotExist:
            raise e
        _handle_mint_failure(rs, e)
        raise

    # Revoke outside the row lock so each revoke takes its own per-credential
    # lock and a slow provider call doesn't stall the rotating_secret row.
    for prior in others:
        try:
            revoke_credential(prior.id, immediate=True, actor_kwargs=actor_kwargs)
        except Exception:
            logger.exception(
                "Emergency revoke failed for credential %s; status will reflect REVOKE_FAILED",
                prior.id,
            )


def pause(rotating_secret, *, actor_kwargs: Optional[dict] = None):
    remaining: Optional[timedelta] = None
    if rotating_secret.next_rotation_at:
        remaining = rotating_secret.next_rotation_at - timezone.now()
        if remaining.total_seconds() < 0:
            remaining = timedelta(0)

    rotating_secret.is_active = False
    rotating_secret.paused_remaining = remaining
    rotating_secret.next_rotation_at = None
    rotating_secret.save(
        update_fields=[
            "is_active",
            "paused_remaining",
            "next_rotation_at",
            "updated_at",
        ]
    )
    _cancel_job(rotating_secret.rotation_job_id)
    record_event(rotating_secret, "paused", **(actor_kwargs or {}))


def resume(rotating_secret, *, actor_kwargs: Optional[dict] = None):
    # Resume the timer where pause froze it; fall back to a full interval if
    # the secret was paused before next_rotation_at was ever scheduled.
    delay = rotating_secret.paused_remaining
    rotating_secret.is_active = True
    # Reset the backoff counter so the next mint runs immediately, but
    # leave `health` alone — only a successful mint should emit a
    # `health_recovered` event and flip back to HEALTHY.
    rotating_secret.consecutive_failure_count = 0
    rotating_secret.paused_remaining = None
    rotating_secret.save(
        update_fields=[
            "is_active",
            "consecutive_failure_count",
            "paused_remaining",
            "updated_at",
        ]
    )
    _schedule_next_rotation(rotating_secret, delay=delay)
    record_event(rotating_secret, "resumed", **(actor_kwargs or {}))
