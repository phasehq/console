"""redis-py credential provider that logs in to Amazon ElastiCache with a short-lived IAM token."""

from functools import cache

import boto3
from botocore.model import ServiceId
from botocore.signers import RequestSigner
from redis import CredentialProvider


@cache
def _signer():
    # Region and credentials come from the standard AWS chain (e.g. the ECS task role).
    session = boto3.Session()
    return RequestSigner(
        ServiceId("elasticache"),
        session.region_name,
        "elasticache",
        "v4",
        session.get_credentials(),
        session.events,
    )


class ElastiCacheIAMProvider(CredentialProvider):
    def __init__(self, user, replication_group_id):
        self.user = user
        self.replication_group_id = replication_group_id

    def get_credentials(self):
        # Signed locally (no network call). Valid for 15 minutes, checked only when a connection opens.
        url = _signer().generate_presigned_url(
            {
                "method": "GET",
                "url": f"http://{self.replication_group_id}/?Action=connect&User={self.user}",
                "body": {},
                "headers": {},
                "context": {},
            },
            operation_name="connect",
            expires_in=900,
        )
        return self.user, url.removeprefix("http://")
