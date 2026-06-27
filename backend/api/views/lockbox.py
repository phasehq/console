from api.serializers import (
    LockboxSerializer,
    LockboxMetadataSerializer,
)
from api.models import (
    Lockbox,
)

from django.db import transaction
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from django.db.models import Q, F

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from djangorestframework_camel_case.parser import CamelCaseJSONParser
from djangorestframework_camel_case.render import (
    CamelCaseJSONRenderer,
)


class LockboxView(APIView):
    permission_classes = [
        AllowAny,
    ]
    parser_classes = [
        CamelCaseJSONParser,
    ]
    renderer_classes = [
        CamelCaseJSONRenderer,
    ]

    @csrf_exempt
    def dispatch(self, request, *args, **kwargs):
        return super(LockboxView, self).dispatch(request, *args, **kwargs)

    def get(self, request, box_id):
        """
        Return non-secret metadata only (expiry, view counts). This NEVER returns
        the payload and NEVER consumes a view, so page loads, link unfurlers and
        email link scanners cannot burn a one-time box or read its contents.
        """
        try:
            box = Lockbox.objects.get(
                Q(id=box_id)
                & (Q(expires_at__gte=timezone.now()) | Q(expires_at__isnull=True))
            )
        except Lockbox.DoesNotExist:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)

        if box.allowed_views is not None and box.views >= box.allowed_views:
            return HttpResponse(status=status.HTTP_403_FORBIDDEN)

        serializer = LockboxMetadataSerializer(box)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request, box_id):
        """
        Reveal the secret. This is the ONLY endpoint that returns the payload and
        the ONLY one that consumes a view — disclosure and consumption happen in a
        single locked transaction, so the view limit cannot be bypassed by simply
        not calling a separate increment endpoint.
        """
        try:
            with transaction.atomic():
                box = Lockbox.objects.select_for_update().get(
                    Q(id=box_id)
                    & (Q(expires_at__gte=timezone.now()) | Q(expires_at__isnull=True))
                )

                if box.allowed_views is not None and box.views >= box.allowed_views:
                    return HttpResponse(status=status.HTTP_403_FORBIDDEN)

                # Atomically consume one view as the payload is disclosed.
                Lockbox.objects.filter(id=box_id).update(views=F("views") + 1)
                # Reflect the just-consumed view in the response (not the stale count).
                box.refresh_from_db()

                serializer = LockboxSerializer(box)
                return Response(serializer.data, status=status.HTTP_200_OK)

        except Lockbox.DoesNotExist:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
