from graphql import GraphQLError

from api.models import LogStream, Organisation
from api.services import Providers
from api.utils.access.permissions import user_has_global_access, user_has_permission
from api.utils.database import get_approximate_count

from ..adapters import all_adapters
from ..engine import STATUS_COMPLETED, STATUS_FAILED, STATUS_SKIPPED
from ..sources import all_sources
from .types import LogStreamDeliveryHistoryType

DELIVERY_STATUS_FILTERS = (STATUS_COMPLETED, STATUS_FAILED, STATUS_SKIPPED, "unresolved")


# Log streams export the ENTIRE organisation's activity — both sources query
# org-wide, including apps the caller may not be a member of. Custom roles
# can hold LogStreams permissions without global access; such scoped roles
# must not view or configure org-wide egress (mirrors the audit REST
# endpoint's guard). `user_has_global_access` is imported above and re-used
# by the mutations module.


def resolve_log_stream_providers(root, info):
    return [
        {
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
        for adapter in all_adapters()
    ]


def resolve_log_stream_sources(root, info):
    return [
        {"id": source.id, "name": source.name, "description": source.description}
        for source in all_sources()
    ]


def resolve_log_streams(root, info, organisation_id):
    org = Organisation.objects.get(id=organisation_id)

    if not user_has_permission(info.context.user, "read", "LogStreams", org):
        return []
    if not user_has_global_access(info.context.user, org):
        return []

    return LogStream.objects.filter(organisation=org, deleted_at=None).order_by(
        "-created_at"
    )


def resolve_log_stream_deliveries(
    root, info, stream_id, limit=25, offset=0, status=None
):
    stream = LogStream.objects.get(id=stream_id, deleted_at=None)

    if not user_has_permission(
        info.context.user, "read", "LogStreams", stream.organisation
    ):
        raise GraphQLError("You don't have permission to view log stream deliveries")
    if not user_has_global_access(info.context.user, stream.organisation):
        raise GraphQLError("You don't have permission to view log stream deliveries")

    queryset = stream.delivery_events.all()
    if status:
        if status not in DELIVERY_STATUS_FILTERS:
            raise GraphQLError(f"Invalid delivery status filter '{status}'")
        if status == "unresolved":
            queryset = queryset.filter(
                status__in=[STATUS_FAILED, STATUS_SKIPPED], resolved_at__isnull=True
            )
        else:
            queryset = queryset.filter(status=status)

    limit = min(max(1, limit), 100)
    offset = max(0, offset)

    count = get_approximate_count(queryset)
    events = list(queryset[offset : offset + limit])

    return LogStreamDeliveryHistoryType(events=events, count=count)
