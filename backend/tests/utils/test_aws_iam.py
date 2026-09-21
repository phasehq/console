"""Token generation for AWS IAM auth, and how the tokens reach psycopg, redis-py, Django and RQ."""

import pickle
from unittest.mock import MagicMock, patch

import boto3
import pytest
import redis
from botocore.credentials import ReadOnlyCredentials
from botocore.exceptions import NoCredentialsError, NoRegionError
from botocore.hooks import HierarchicalEmitter
from django.core.cache.backends.redis import RedisCache
from django.db import connections
from django_rq.queues import get_redis_connection
from rq.connections import parse_connection

from backend.utils.aws_iam import base, elasticache

RDS = "db.abc123.eu-central-1.rds.amazonaws.com"
ELASTICACHE = "master.my-cache.abc123.euc1.cache.amazonaws.com"


@pytest.fixture(autouse=True)
def aws_env(monkeypatch, tmp_path):
    """Temporary (task-role style) credentials, isolated from the developer's own AWS config."""
    for key in ("AWS_PROFILE", "AWS_REGION", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
                "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_WEB_IDENTITY_TOKEN_FILE"):  # fmt: skip
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "no-config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "no-credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "ASIAFAKE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "fake")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "fake-session-token")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-central-1")
    monkeypatch.setattr(boto3, "DEFAULT_SESSION", None)  # boto3 caches credentials on it
    base._rds.cache_clear()
    elasticache._signer.cache_clear()
    yield
    base._rds.cache_clear()
    elasticache._signer.cache_clear()


def database_wrapper(**overrides):
    return base.DatabaseWrapper(
        {**connections.settings["default"], "HOST": RDS, "PASSWORD": "", **overrides}
    )


def provider():
    return elasticache.ElastiCacheIAMProvider("phase", "my-cache")


# --- Tokens ------------------------------------------------------------------------------------


def test_rds_token_replaces_password():
    password = database_wrapper().get_connection_params()["password"]
    assert password.startswith(f"{RDS}:5432/?Action=connect&DBUser=dummy_user&")
    assert "%2Feu-central-1%2Frds-db%2Faws4_request" in password  # region + service it is valid for
    assert "X-Amz-Expires=900" in password and "X-Amz-Signature=" in password
    assert "X-Amz-Security-Token=fake-session-token" in password  # role credentials are temporary


def test_rds_token_follows_the_configured_host_port_and_user():
    wrapper = database_wrapper(HOST="other.xyz.eu-central-1.rds.amazonaws.com", PORT=6543, USER="app")
    password = wrapper.get_connection_params()["password"]
    assert password.startswith("other.xyz.eu-central-1.rds.amazonaws.com:6543/?Action=connect&DBUser=app&")


def test_rds_token_is_generated_for_every_new_connection():
    wrapper = database_wrapper()
    with patch.object(base, "_rds") as rds:
        rds.return_value.generate_db_auth_token.side_effect = ["token-1", "token-2"]
        first = wrapper.get_connection_params()["password"]
        second = wrapper.get_connection_params()["password"]
    assert (first, second) == ("token-1", "token-2")
    rds.return_value.generate_db_auth_token.assert_called_with(
        DBHostname=RDS, Port=5432, DBUsername="dummy_user"
    )


def test_rds_client_is_built_once_per_process():
    assert base._rds() is base._rds()


def test_elasticache_token_is_the_password():
    user, token = provider().get_credentials()
    assert user == "phase"
    assert token.startswith("my-cache/?Action=connect&User=phase&")  # no http:// prefix
    assert "%2Feu-central-1%2Felasticache%2Faws4_request" in token
    assert "X-Amz-Expires=900" in token and "X-Amz-Signature=" in token
    assert "X-Amz-Security-Token=fake-session-token" in token


def test_elasticache_signer_picks_up_rotated_role_credentials():
    """The signer is cached per process; the role credentials behind it must not be."""

    class RotatingCredentials:
        keys = iter(["ASIAFIRST", "ASIASECOND"])

        def get_frozen_credentials(self):
            return ReadOnlyCredentials(next(self.keys), "secret", "session-token")

    session = MagicMock(region_name="eu-central-1", events=HierarchicalEmitter())
    session.get_credentials.return_value = RotatingCredentials()
    with patch.object(elasticache.boto3, "Session", return_value=session) as session_class:
        first = provider().get_credentials()[1]
        second = provider().get_credentials()[1]
    assert "ASIAFIRST" in first and "ASIASECOND" in second
    session_class.assert_called_once()


# --- Failing loudly ----------------------------------------------------------------------------


def test_missing_region_fails_loudly(monkeypatch):
    monkeypatch.delenv("AWS_DEFAULT_REGION")
    with pytest.raises(NoRegionError):
        database_wrapper().get_connection_params()
    with pytest.raises(NoRegionError):
        provider().get_credentials()


def test_missing_credentials_fail_loudly(monkeypatch):
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        monkeypatch.delenv(key)
    with pytest.raises(NoCredentialsError):
        database_wrapper().get_connection_params()
    with pytest.raises(NoCredentialsError):
        provider().get_credentials()


# --- Wiring into redis-py, Django's cache and RQ -------------------------------------------------


def test_redis_sends_a_fresh_token_on_every_connect():
    """ElastiCache drops IAM connections after 12 hours; each reconnect must sign a new token."""
    tokens = provider()
    connection = redis.Connection(host=ELASTICACHE, credential_provider=tokens)
    with patch.object(tokens, "get_credentials", side_effect=[("phase", "t1"), ("phase", "t2")]), \
         patch.object(connection, "send_command") as send, \
         patch.object(connection, "read_response", return_value=b"OK"):  # fmt: skip
        connection.on_connect()
        connection.on_connect()
    auth = [call.args for call in send.call_args_list if call.args[0] == "AUTH"]
    assert auth == [("AUTH", "phase", "t1"), ("AUTH", "phase", "t2")]


def iam_queue_config(tokens, **overrides):
    return {
        "HOST": ELASTICACHE, "PORT": 6379, "DB": 0, "SSL": True, "USERNAME": None, "PASSWORD": None,
        "REDIS_CLIENT_KWARGS": {"credential_provider": tokens}, **overrides,
    }  # fmt: skip


def test_rq_connection_uses_the_provider():
    tokens = provider()
    pool = get_redis_connection(iam_queue_config(tokens)).connection_pool
    assert pool.connection_kwargs["credential_provider"] is tokens
    assert pool.make_connection().credential_provider is tokens


def test_rq_username_must_be_cleared_alongside_a_provider():
    pool = get_redis_connection(iam_queue_config(provider(), USERNAME="phase")).connection_pool
    with pytest.raises(redis.DataError):
        pool.make_connection()


def test_rq_worker_pool_can_hand_the_connection_to_child_processes():
    connection = get_redis_connection(iam_queue_config(provider()))
    _, _, pool_kwargs = parse_connection(connection)
    restored = pickle.loads(pickle.dumps(pool_kwargs))["credential_provider"]
    assert (restored.user, restored.replication_group_id) == ("phase", "my-cache")


def test_django_cache_uses_the_provider():
    tokens = provider()
    options = {"ssl_cert_reqs": "required", "ssl_ca_certs": None, "credential_provider": tokens}
    cache = RedisCache(f"rediss://{ELASTICACHE}:6379", {"OPTIONS": options})
    pool = cache._cache._get_connection_pool(write=True)
    assert pool.connection_kwargs["credential_provider"] is tokens
    assert "username" not in pool.connection_kwargs and "password" not in pool.connection_kwargs
