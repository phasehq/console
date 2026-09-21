import pickle

import pytest
from django.db import connections

from backend.utils.aws_iam import base, elasticache


@pytest.fixture(autouse=True)
def fake_aws(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAFAKE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "fake")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-central-1")
    base._rds.cache_clear()
    elasticache._signer.cache_clear()


def test_rds_token_replaces_password():
    host = "db.abc123.eu-central-1.rds.amazonaws.com"
    wrapper = base.DatabaseWrapper(
        {**connections.settings["default"], "HOST": host, "PASSWORD": ""}
    )
    password = wrapper.get_connection_params()["password"]
    assert password.startswith(f"{host}:5432/?Action=connect&DBUser=dummy_user&")
    assert "X-Amz-Signature=" in password


def test_elasticache_token_is_the_password():
    provider = elasticache.ElastiCacheIAMProvider("phase", "my-cache")
    user, token = provider.get_credentials()
    assert user == "phase"
    assert token.startswith("my-cache/?Action=connect&User=phase&")
    assert "X-Amz-Expires=900" in token and "X-Amz-Signature=" in token


def test_elasticache_provider_is_picklable_for_worker_pools():
    provider = pickle.loads(pickle.dumps(elasticache.ElastiCacheIAMProvider("u", "c")))
    assert (provider.user, provider.replication_group_id) == ("u", "c")
