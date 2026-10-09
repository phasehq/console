"""PostgreSQL backend that logs in to Amazon RDS with a short-lived IAM token instead of a password."""

from functools import cache

import boto3
from django.db.backends.postgresql import base


@cache
def _rds():
    # Region and credentials come from the standard AWS chain (e.g. the ECS task role).
    return boto3.client("rds")


class DatabaseWrapper(base.DatabaseWrapper):
    def get_connection_params(self):
        params = super().get_connection_params()
        # Signed locally (no network call). Valid for 15 minutes, checked only when a connection opens.
        params["password"] = _rds().generate_db_auth_token(
            DBHostname=params["host"], Port=params["port"], DBUsername=params["user"]
        )
        return params
