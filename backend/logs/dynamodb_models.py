from pynamodb.models import Model
from pynamodb.indexes import GlobalSecondaryIndex, AllProjection
from pynamodb.attributes import (
    UnicodeAttribute,
    NumberAttribute,
)
from django.conf import settings

class TimestampIndex(GlobalSecondaryIndex):
    class Meta:
        index_name = settings.DYNAMODB['INDEX']
        projection = AllProjection()
    app_id = UnicodeAttribute(hash_key=True, null=False)
    timestamp = NumberAttribute(range_key=True, null=False)

class KMSLog(Model):
    class Meta:
        table_name = settings.DYNAMODB['TABLE']
        region = settings.DYNAMODB['REGION']
    
    id = UnicodeAttribute(hash_key=True,null=False)
    timestamp = NumberAttribute(null=False)
    app_id = UnicodeAttribute(null=False)
    phase_node = UnicodeAttribute(null=False)
    event_type = UnicodeAttribute(null=False)
    ip_address = UnicodeAttribute()
    ph_size = NumberAttribute()
    asn = NumberAttribute()
    isp = UnicodeAttribute()
    edge_location = UnicodeAttribute()
    country = UnicodeAttribute()
    city = UnicodeAttribute()
    latitude = NumberAttribute()
    longitude = NumberAttribute()
    timestamp_index = TimestampIndex()