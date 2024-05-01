from api.serializers import (
    LockboxSerializer,
)
from api.models import (
    Lockbox,
)

from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from django.db.models import Q

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
        try:
            box = Lockbox.objects.get(
                Q(id=box_id)
                & (Q(expires_at__gte=timezone.now()) | Q(expires_at__isnull=True))
            )
            if box.allowed_views is None or box.views < box.allowed_views:
                serializer = LockboxSerializer(box)
                return Response(serializer.data, status=status.HTTP_200_OK)
            else:
                return HttpResponse(status=status.HTTP_403_FORBIDDEN)

        except Lockbox.DoesNotExist:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)

    def put(self, request, box_id):
        try:
            box = Lockbox.objects.get(id=box_id)
            box.views += 1
            box.save()
            return HttpResponse(status=status.HTTP_200_OK)

        except Lockbox.DoesNotExist:
            return HttpResponse(status=status.HTTP_404_NOT_FOUND)
