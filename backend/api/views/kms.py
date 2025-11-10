from datetime import datetime
from api.utils.access.ip import get_client_ip
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from django.http import JsonResponse, HttpResponse

from logs.models import KMSDBLog
from api.models import (
    App,
)


@api_view(["GET"])
@permission_classes([AllowAny])
def kms(request, app_id):
    auth_token = request.headers["authorization"]
    event_type = request.headers["eventtype"]
    phase_node = request.headers["phasenode"]
    ph_size = request.headers["phsize"]
    ip_address = get_client_ip(request)
    app_token = auth_token.split("Bearer ")[1]

    if not app_token:
        return HttpResponse(status=404)
    try:
        app = App.objects.get(app_token=app_token)
        try:
            timestamp = datetime.now().timestamp() * 1000
            KMSDBLog.objects.create(
                app_id=app_id,
                event_type=event_type,
                phase_node=phase_node,
                ph_size=float(ph_size),
                ip_address=ip_address,
                timestamp=timestamp,
            )
        except:
            pass
        return JsonResponse({"wrappedKeyShare": app.wrapped_key_share})
    except:
        return HttpResponse(status=404)
