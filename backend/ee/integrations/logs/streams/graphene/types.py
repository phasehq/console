import graphene
from django.utils import timezone
from graphene import ObjectType
from graphene_django import DjangoObjectType

from api.models import LogStream, LogStreamDeliveryEvent
from api.services import Providers
from backend.graphene.types import ProviderType

from ..adapters import get_adapter
from ..engine import STATUS_COMPLETED, STATUS_FAILED, STATUS_SKIPPED, lag_for
from ..sources import SOURCES


class LogStreamProviderType(ObjectType):
    id = graphene.String(required=True)
    name = graphene.String(required=True)
    credentials_provider = graphene.Field(ProviderType)
    max_event_age_hours = graphene.Float()


class LogStreamSourceType(ObjectType):
    id = graphene.String(required=True)
    name = graphene.String(required=True)
    description = graphene.String(required=True)


class LogStreamSourceLagType(ObjectType):
    source = graphene.String(required=True)
    name = graphene.String(required=True)
    lag_seconds = graphene.Int(required=True)


class LogStreamDeliverySummaryType(ObjectType):
    """Delivery counts over the last 24 hours."""

    completed = graphene.Int(required=True)
    failed = graphene.Int(required=True)


class LogStreamDeliveryEventType(DjangoObjectType):
    class Meta:
        model = LogStreamDeliveryEvent
        fields = (
            "id",
            "source",
            "status",
            "event_count",
            "payload_bytes",
            "attempts",
            "cursor_from",
            "cursor_to",
            "retried_from",
            "resolved_at",
            "meta",
            "created_at",
            "completed_at",
        )


class LogStreamDeliveryHistoryType(ObjectType):
    events = graphene.List(LogStreamDeliveryEventType)
    count = graphene.Int()


class LogStreamType(DjangoObjectType):
    provider_info = graphene.Field(LogStreamProviderType)
    sources = graphene.List(graphene.NonNull(graphene.String), required=True)
    source_lags = graphene.List(graphene.NonNull(LogStreamSourceLagType), required=True)
    unresolved_failures = graphene.Int(required=True)
    delivery_summary = graphene.Field(LogStreamDeliverySummaryType)
    destination_url = graphene.String()

    class Meta:
        model = LogStream
        # `cursors` and `ship_job_id` are engine-internal — never exposed.
        fields = (
            "id",
            "name",
            "provider",
            "authentication",
            "sources",
            "options",
            "max_attempts",
            "is_active",
            "health",
            "paused_reason",
            "last_shipped_at",
            "last_failure_at",
            "last_failure_reason",
            "created_at",
            "updated_at",
        )

    def resolve_provider_info(self, info):
        try:
            adapter = get_adapter(self.provider)
        except ValueError:
            return None
        return {
            "id": adapter.id,
            "name": adapter.name,
            "credentials_provider": Providers.get_provider_config(
                adapter.credentials_provider
            ),
            "max_event_age_hours": (
                adapter.max_event_age.total_seconds() / 3600
                if adapter.max_event_age
                else None
            ),
        }

    def resolve_sources(self, info):
        return self.sources or []

    def resolve_destination_url(self, info):
        # Never exposes credential values — only the adapter-derived link.
        if not self.authentication_id:
            return None
        try:
            from api.utils.syncing.auth import get_credentials

            adapter = get_adapter(self.provider)
            return adapter.destination_url(
                get_credentials(self.authentication_id), self.options or {}
            )
        except Exception:
            return None

    def resolve_source_lags(self, info):
        return [
            {
                "source": source_id,
                "name": SOURCES[source_id].name if source_id in SOURCES else source_id,
                "lag_seconds": lag_for(self, source_id),
            }
            for source_id in (self.sources or [])
        ]

    def resolve_unresolved_failures(self, info):
        return self.delivery_events.filter(
            status__in=[STATUS_FAILED, STATUS_SKIPPED], resolved_at__isnull=True
        ).count()

    def resolve_delivery_summary(self, info):
        since = timezone.now() - timezone.timedelta(hours=24)
        recent = self.delivery_events.filter(created_at__gte=since)
        return {
            "completed": recent.filter(status=STATUS_COMPLETED).count(),
            "failed": recent.filter(status=STATUS_FAILED).count(),
        }
