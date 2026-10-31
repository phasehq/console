"""Bench-only settings overlay: persistent DB connections.

Mounted into the container and selected with
DJANGO_SETTINGS_MODULE=bench_settings to measure how much of each request's
Postgres cost is connection setup (CONN_MAX_AGE defaults to 0, so every
request forks a fresh backend that rebuilds its catalog caches).
"""

from backend.settings import *  # noqa: F401,F403
from backend.settings import DATABASES

DATABASES["default"]["CONN_MAX_AGE"] = 60
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True
