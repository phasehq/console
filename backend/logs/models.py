from django.db import models
from uuid import uuid4

class KMSDBLog(models.Model):
    """
    DB model for Logs
    """
    id = models.CharField(default=uuid4, primary_key=True,
                          editable=False)
    timestamp = models.BigIntegerField(null=False, blank=False)
    app_id = models.TextField(null=False, blank=False)
    phase_node = models.TextField(null=False, blank=False)
    event_type = models.TextField(null=False, blank=False)
    ip_address = models.GenericIPAddressField(null=False, blank=False)
    ph_size = models.BigIntegerField(null=False, blank=False)
    asn = models.BigIntegerField(null=True)
    isp = models.TextField(null=True)
    edge_location = models.TextField(null=True)
    country = models.CharField(max_length=2, null=True)
    city = models.TextField(null=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=5, null=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=5, null=True)

    list_display = ('id', 'app_id', 'timestamp', 'event_type')

    def __str__(self):
        return self.id
