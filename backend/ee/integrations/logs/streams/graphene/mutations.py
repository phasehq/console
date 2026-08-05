import graphene
from django.utils import timezone
from graphql import GraphQLError

from api.models import (
    AuditEvent,
    LogStream,
    LogStreamDeliveryEvent,
    Organisation,
    ProviderCredentials,
)
from api.utils.access.permissions import user_has_permission
from api.utils.audit_logging import get_actor_info_from_graphql, log_audit_event
from api.utils.rest import get_resolver_request_meta
from backend.quotas import can_use_log_streams

from .. import engine
from ..adapters import get_adapter
from ..sources import get_source
from .queries import user_has_global_access
from .types import LogStreamType

PLAN_ERROR = "Log Streams require an Enterprise plan."


def _check_plan(org):
    if not can_use_log_streams(org):
        raise GraphQLError(PLAN_ERROR)


def _check_permission(info, action, org):
    if not user_has_permission(info.context.user, action, "LogStreams", org):
        raise GraphQLError("You don't have permission to manage Log Streams")
    # Streams export org-wide activity — a scoped custom role holding
    # LogStreams permissions must not configure org-wide egress.
    if not user_has_global_access(info.context.user, org):
        raise GraphQLError("Managing Log Streams requires a role with global access")


def _validate_stream_input(org, provider, credential_id, sources, max_attempts):
    try:
        adapter = get_adapter(provider)
    except ValueError as ex:
        raise GraphQLError(str(ex))

    if not sources:
        raise GraphQLError("Select at least one event source to stream")
    for source_id in sources:
        try:
            get_source(source_id)
        except ValueError as ex:
            raise GraphQLError(str(ex))

    try:
        credential = ProviderCredentials.objects.get(
            id=credential_id, deleted_at=None
        )
    except ProviderCredentials.DoesNotExist:
        raise GraphQLError("The selected credentials don't exist")
    if credential.organisation_id != org.id:
        raise GraphQLError("The selected credentials don't exist")
    if credential.provider != adapter.credentials_provider:
        raise GraphQLError(
            f"{adapter.name} log streams require {adapter.credentials_provider} credentials"
        )

    max_attempts = max(1, min(int(max_attempts or 5), engine.MAX_ATTEMPTS_CAP))

    return adapter, credential, max_attempts


def _build_options(adapter, service, tags, gzip):
    return adapter.validate_options(
        {"service": service, "tags": tags, "gzip": True if gzip is None else gzip}
    )


def _stream_values(stream):
    return {
        "name": stream.name,
        "provider": stream.provider,
        "credential_id": str(stream.authentication_id),
        "sources": list(stream.sources or []),
        "options": stream.options or {},
        "max_attempts": stream.max_attempts,
    }


def _audit(info, org, event_type, stream, old_values=None, new_values=None, description=""):
    try:
        actor_type, actor_id, actor_metadata = get_actor_info_from_graphql(info, org)
        ip_address, user_agent = get_resolver_request_meta(info.context)
        log_audit_event(
            organisation=org,
            event_type=event_type,
            resource_type=AuditEvent.LOG_STREAM,
            resource_id=stream.id,
            actor_type=actor_type,
            actor_id=actor_id,
            actor_metadata=actor_metadata,
            resource_metadata={"name": stream.name, "provider": stream.provider},
            old_values=old_values,
            new_values=new_values,
            description=description,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    except Exception:
        pass


class CreateLogStreamMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        provider = graphene.String(required=True)
        credential_id = graphene.ID(required=True)
        sources = graphene.List(graphene.NonNull(graphene.String), required=True)
        service = graphene.String(required=False)
        tags = graphene.String(required=False)
        gzip = graphene.Boolean(required=False)
        max_attempts = graphene.Int(required=False)

    log_stream = graphene.Field(LogStreamType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        name,
        provider,
        credential_id,
        sources,
        service=None,
        tags=None,
        gzip=None,
        max_attempts=None,
    ):
        org = Organisation.objects.get(id=organisation_id)
        _check_permission(info, "create", org)
        _check_plan(org)

        adapter, credential, max_attempts = _validate_stream_input(
            org, provider, credential_id, sources, max_attempts
        )

        name = name.strip()
        if not name:
            raise GraphQLError("Please enter a name for this Log Stream")

        stream = LogStream.objects.create(
            organisation=org,
            name=name[:64],
            provider=adapter.id,
            authentication=credential,
            sources=list(dict.fromkeys(sources)),
            options=_build_options(adapter, service, tags, gzip),
            max_attempts=max_attempts,
        )

        _audit(
            info,
            org,
            AuditEvent.CREATE,
            stream,
            new_values=_stream_values(stream),
            description=f"Created log stream {stream.name}",
        )

        return CreateLogStreamMutation(log_stream=stream)


class UpdateLogStreamMutation(graphene.Mutation):
    class Arguments:
        stream_id = graphene.ID(required=True)
        name = graphene.String(required=True)
        credential_id = graphene.ID(required=True)
        sources = graphene.List(graphene.NonNull(graphene.String), required=True)
        service = graphene.String(required=False)
        tags = graphene.String(required=False)
        gzip = graphene.Boolean(required=False)
        max_attempts = graphene.Int(required=False)

    log_stream = graphene.Field(LogStreamType)

    @classmethod
    def mutate(
        cls,
        root,
        info,
        stream_id,
        name,
        credential_id,
        sources,
        service=None,
        tags=None,
        gzip=None,
        max_attempts=None,
    ):
        stream = LogStream.objects.get(id=stream_id, deleted_at=None)
        # Organisation is always derived from the stream, never client input.
        org = stream.organisation
        _check_permission(info, "update", org)
        _check_plan(org)

        adapter, credential, max_attempts = _validate_stream_input(
            org, stream.provider, credential_id, sources, max_attempts
        )

        name = name.strip()
        if not name:
            raise GraphQLError("Please enter a name for this Log Stream")

        old_values = _stream_values(stream)

        stream.name = name[:64]
        stream.authentication = credential
        stream.sources = list(dict.fromkeys(sources))
        stream.options = _build_options(adapter, service, tags, gzip)
        stream.max_attempts = max_attempts
        # Config fields only — a full save would write cursors/health/activity
        # from this (possibly stale) row and clobber concurrent worker state.
        stream.save(
            update_fields=[
                "name",
                "authentication",
                "sources",
                "options",
                "max_attempts",
                "updated_at",
            ]
        )

        _audit(
            info,
            org,
            AuditEvent.UPDATE,
            stream,
            old_values=old_values,
            new_values=_stream_values(stream),
            description=f"Updated log stream {stream.name}",
        )

        return UpdateLogStreamMutation(log_stream=stream)


class ToggleLogStreamMutation(graphene.Mutation):
    class Arguments:
        stream_id = graphene.ID(required=True)

    log_stream = graphene.Field(LogStreamType)

    @classmethod
    def mutate(cls, root, info, stream_id):
        stream = LogStream.objects.get(id=stream_id, deleted_at=None)
        org = stream.organisation
        _check_permission(info, "update", org)
        _check_plan(org)

        if stream.is_active:
            engine.pause(stream)
            description = f"Paused log stream {stream.name}"
        else:
            if not stream.authentication_id:
                raise GraphQLError(
                    "This stream has no credentials — select new credentials before resuming"
                )
            engine.resume(stream)
            description = f"Resumed log stream {stream.name}"

        _audit(info, org, AuditEvent.UPDATE, stream, description=description)

        return ToggleLogStreamMutation(log_stream=stream)


class DeleteLogStreamMutation(graphene.Mutation):
    class Arguments:
        stream_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, stream_id):
        stream = LogStream.objects.get(id=stream_id, deleted_at=None)
        org = stream.organisation
        _check_permission(info, "delete", org)

        stream.delete()

        _audit(
            info,
            org,
            AuditEvent.DELETE,
            stream,
            old_values=_stream_values(stream),
            description=f"Deleted log stream {stream.name}",
        )

        return DeleteLogStreamMutation(ok=True)


class TestLogStreamConnectionMutation(graphene.Mutation):
    class Arguments:
        organisation_id = graphene.ID(required=True)
        provider = graphene.String(required=True)
        credential_id = graphene.ID(required=True)
        service = graphene.String(required=False)
        tags = graphene.String(required=False)
        gzip = graphene.Boolean(required=False)

    ok = graphene.Boolean()
    message = graphene.String()

    @classmethod
    def mutate(
        cls,
        root,
        info,
        organisation_id,
        provider,
        credential_id,
        service=None,
        tags=None,
        gzip=None,
    ):
        org = Organisation.objects.get(id=organisation_id)
        if not (
            user_has_permission(info.context.user, "create", "LogStreams", org)
            or user_has_permission(info.context.user, "update", "LogStreams", org)
        ):
            raise GraphQLError("You don't have permission to manage Log Streams")
        if not user_has_global_access(info.context.user, org):
            raise GraphQLError(
                "Managing Log Streams requires a role with global access"
            )
        _check_plan(org)

        try:
            adapter = get_adapter(provider)
        except ValueError as ex:
            raise GraphQLError(str(ex))

        try:
            credential = ProviderCredentials.objects.get(
                id=credential_id, deleted_at=None
            )
        except ProviderCredentials.DoesNotExist:
            raise GraphQLError("The selected credentials don't exist")
        if credential.organisation_id != org.id:
            raise GraphQLError("The selected credentials don't exist")
        # Same provider check as create/update — without it, another
        # provider's api_key would be decrypted and sent to this adapter's
        # destination as part of the test request.
        if credential.provider != adapter.credentials_provider:
            raise GraphQLError(
                f"{adapter.name} log streams require {adapter.credentials_provider} credentials"
            )

        ok, message = engine.test_adapter_connection(
            adapter.id,
            credential.id,
            {"service": service, "tags": tags, "gzip": True if gzip is None else gzip},
            org,
        )

        return TestLogStreamConnectionMutation(ok=ok, message=message)


class RetryLogStreamDeliveryMutation(graphene.Mutation):
    class Arguments:
        delivery_event_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, delivery_event_id):
        delivery_event = LogStreamDeliveryEvent.objects.select_related(
            "stream", "stream__organisation"
        ).get(id=delivery_event_id)
        stream = delivery_event.stream
        org = stream.organisation
        _check_permission(info, "update", org)
        _check_plan(org)

        if stream.deleted_at is not None:
            raise GraphQLError("This log stream has been deleted")
        if not stream.is_active:
            raise GraphQLError(
                "This stream is paused — resume it before retrying deliveries"
            )
        if delivery_event.status not in (
            engine.STATUS_FAILED,
            engine.STATUS_SKIPPED,
        ):
            raise GraphQLError("Only failed or skipped deliveries can be retried")
        if delivery_event.resolved_at is not None:
            raise GraphQLError("This delivery has already been resolved")
        if delivery_event.cursor_from is None or delivery_event.cursor_to is None:
            raise GraphQLError("This delivery has no event range to re-ship")

        try:
            adapter = get_adapter(stream.provider)
        except ValueError as ex:
            raise GraphQLError(str(ex))
        # The destination silently discards events older than its ingestion
        # window — re-shipping an expired range would falsely mark it
        # recovered. (The engine re-checks; this is the user-facing error.)
        if adapter.max_event_age and delivery_event.cursor_to < (
            timezone.now() - adapter.max_event_age + engine.SKIP_AHEAD_MARGIN
        ):
            raise GraphQLError(
                "This range is older than the destination's ingestion window — "
                "retried events would be silently discarded. "
                + engine._manual_export_hint(delivery_event.source)
            )

        # The job holds an authoritative per-delivery Redis claim; this
        # pre-check just gives double-clicks a friendly error instead of a
        # silently discarded duplicate job.
        try:
            if engine._redis().exists(f"log_streams:retry:{delivery_event.id}"):
                raise GraphQLError(
                    "A retry for this delivery is already running. If a worker "
                    "crashed mid-retry, the claim clears automatically within "
                    "about 30 minutes."
                )
        except GraphQLError:
            raise
        except Exception:
            pass

        engine.retry_delivery.delay(delivery_event.id)

        _audit(
            info,
            org,
            AuditEvent.UPDATE,
            stream,
            description=f"Requested delivery retry for log stream {stream.name}",
        )

        return RetryLogStreamDeliveryMutation(ok=True)
