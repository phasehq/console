from datetime import datetime, timedelta

from api.auth import PhaseTokenAuthentication
from api.models import AuditEvent
from api.utils.access.permissions import user_has_permission
from api.utils.database import get_approximate_count
from api.utils.rest import METHOD_TO_ACTION
from api.throttling import PlanBasedRateThrottle
from api.utils.access.middleware import IsIPAllowed

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from djangorestframework_camel_case.render import CamelCaseJSONRenderer
from django.utils import timezone


class PublicAuditLogsView(APIView):
    """Query audit logs for an organisation."""

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

        account = None
        is_sa = False
        if request.auth["auth_type"] == "User":
            account = request.auth["org_member"].user
        elif request.auth["auth_type"] == "ServiceAccount":
            account = request.auth["service_account"]
            is_sa = True

        if account is not None:
            org = self._get_org(request)
            if not user_has_permission(account, "read", "Logs", org, False, is_sa):
                raise PermissionDenied("You don't have permission to view audit logs.")

    def get(self, request, *args, **kwargs):
        org = self._get_org(request)

        # Parse query parameters
        start = request.query_params.get("start")
        end = request.query_params.get("end")
        resource_type = request.query_params.get("resource_type")
        resource_id = request.query_params.get("resource_id")
        event_types = request.query_params.getlist("event_types")
        actor_id = request.query_params.get("actor_id")

        try:
            limit = min(max(1, int(request.query_params.get("limit", 50))), 200)
        except (ValueError, TypeError):
            limit = 50

        try:
            offset = max(0, int(request.query_params.get("offset", 0)))
        except (ValueError, TypeError):
            offset = 0

        # Time range
        now = timezone.now()
        if end:
            try:
                end_dt = datetime.fromtimestamp(int(end) / 1000, tz=timezone.utc)
            except (ValueError, TypeError, OSError):
                end_dt = now
        else:
            end_dt = now

        if start:
            try:
                start_dt = datetime.fromtimestamp(int(start) / 1000, tz=timezone.utc)
            except (ValueError, TypeError, OSError):
                start_dt = end_dt - timedelta(days=30)
        else:
            start_dt = end_dt - timedelta(days=30)

        # Build filter
        filters = {
            "organisation": org,
            "timestamp__gte": start_dt,
            "timestamp__lte": end_dt,
        }
        if resource_type:
            filters["resource_type"] = resource_type
        if resource_id:
            filters["resource_id"] = resource_id
        if event_types:
            filters["event_type__in"] = event_types
        if actor_id:
            filters["actor_id"] = actor_id

        qs = AuditEvent.objects.filter(**filters).order_by("-timestamp")
        count = get_approximate_count(qs)
        events = qs[offset : offset + limit]

        logs = [
            {
                "id": str(e.id),
                "event_type": e.event_type,
                "resource_type": e.resource_type,
                "resource_id": e.resource_id,
                "actor_type": e.actor_type,
                "actor_id": e.actor_id,
                "actor_metadata": e.actor_metadata,
                "resource_metadata": e.resource_metadata,
                "old_values": e.old_values,
                "new_values": e.new_values,
                "description": e.description,
                "ip_address": str(e.ip_address) if e.ip_address else None,
                "user_agent": e.user_agent,
                "timestamp": e.timestamp,
            }
            for e in events
        ]

        return Response(
            {"logs": logs, "count": count},
            status=status.HTTP_200_OK,
        )
