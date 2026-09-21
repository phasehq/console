"""
Settings-level guarantees for AWS IAM auth: every password-based setup resolves exactly as it
did before, and IAM auth only switches on for a passwordless Amazon RDS / ElastiCache endpoint.
"""

import os
import runpy
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
SETTINGS_FILE = BACKEND_DIR / "backend" / "settings.py"

POSTGRES = "django.db.backends.postgresql"
RDS = "db.abc123.eu-central-1.rds.amazonaws.com"
ELASTICACHE = "master.my-cache.abc123.euc1.cache.amazonaws.com"
QUEUES = ("default", "scheduled-jobs", "log-streams")
ORIGINAL_QUEUE_KEYS = {"HOST", "PORT", "USERNAME", "PASSWORD", "SSL", "SSL_OPTIONS", "DB"}

MANAGED_ENV = [
    "DATABASE_HOST", "DATABASE_PASSWORD", "DATABASE_PASSWORD_FILE",
    "REDIS_HOST", "REDIS_USER", "REDIS_PASSWORD", "REDIS_PASSWORD_FILE",
    "REDIS_SSL", "REDIS_SSL_CA_PATH",
]  # fmt: skip


@pytest.fixture
def load_settings(monkeypatch):
    """Evaluate settings.py in isolation under the given env, without touching django.conf.settings."""

    def load(**env):
        for key in MANAGED_ENV:
            monkeypatch.delenv(key, raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        monkeypatch.setattr("logging.config.dictConfig", lambda *_: None)
        return runpy.run_path(str(SETTINGS_FILE))

    return load


def providers(settings):
    """Every credential_provider reachable from the cache and queue config."""
    found = [settings["CACHES"]["default"]["OPTIONS"].get("credential_provider")]
    found += [
        settings["RQ_QUEUES"][q].get("REDIS_CLIENT_KWARGS", {}).get("credential_provider")
        for q in QUEUES
    ]
    return [p for p in found if p is not None]


# --- Password auth must be untouched ---------------------------------------------------------

PASSWORD_SETUPS = {
    "docker-compose self-host": dict(
        DATABASE_HOST="postgres", DATABASE_PASSWORD="pw", REDIS_HOST="redis"
    ),
    "self-host, redis password only": dict(
        DATABASE_HOST="postgres", DATABASE_PASSWORD="pw", REDIS_HOST="redis", REDIS_PASSWORD="pw"
    ),
    "aws, rds password + elasticache user/password": dict(
        DATABASE_HOST=RDS, DATABASE_PASSWORD="pw",
        REDIS_HOST=ELASTICACHE, REDIS_USER="phase", REDIS_PASSWORD="pw", REDIS_SSL="true",
    ),
    "aws, elasticache legacy auth token (no user)": dict(
        DATABASE_HOST=RDS, DATABASE_PASSWORD="pw",
        REDIS_HOST=ELASTICACHE, REDIS_PASSWORD="token", REDIS_SSL="true",
    ),
    "aws, elasticache without any auth": dict(
        DATABASE_HOST=RDS, DATABASE_PASSWORD="pw", REDIS_HOST=ELASTICACHE
    ),
    "non-aws hosts without passwords": dict(
        DATABASE_HOST="localhost", REDIS_HOST="localhost", REDIS_USER="phase"
    ),
    "hosts unset": dict(),
    "look-alike hostnames": dict(
        DATABASE_HOST="db.rds.amazonaws.com.example.com",
        REDIS_HOST="x.y.cache.amazonaws.com.example.com", REDIS_USER="phase",
    ),
}  # fmt: skip


@pytest.mark.parametrize("env", PASSWORD_SETUPS.values(), ids=PASSWORD_SETUPS.keys())
def test_password_setups_resolve_exactly_as_before(load_settings, env):
    settings = load_settings(**env)

    assert settings["DATABASES"]["default"]["ENGINE"] == POSTGRES
    assert providers(settings) == []

    ssl = env.get("REDIS_SSL") == "true"
    ssl_options = {"ssl_cert_reqs": "required", "ssl_ca_certs": None} if ssl else None
    assert settings["CACHES"]["default"]["OPTIONS"] == (ssl_options or {})
    for name in QUEUES:
        assert settings["RQ_QUEUES"][name] == {
            "HOST": env.get("REDIS_HOST"),
            "PORT": 6379,
            "USERNAME": env.get("REDIS_USER"),
            "PASSWORD": env.get("REDIS_PASSWORD"),
            "SSL": ssl,
            "SSL_OPTIONS": ssl_options,
            "DB": 0,
        }


def test_password_in_cache_url_is_kept(load_settings):
    settings = load_settings(
        REDIS_HOST=ELASTICACHE, REDIS_USER="phase", REDIS_PASSWORD="p@ss", REDIS_SSL="true"
    )
    assert settings["CACHES"]["default"]["LOCATION"] == f"rediss://phase:p%40ss@{ELASTICACHE}:6379"


def test_password_file_counts_as_a_password(load_settings, tmp_path):
    secret = tmp_path / "db_password"
    secret.write_text("from-file\n")
    settings = load_settings(DATABASE_HOST=RDS, DATABASE_PASSWORD_FILE=str(secret))
    assert settings["DATABASES"]["default"]["ENGINE"] == POSTGRES
    assert settings["DATABASES"]["default"]["PASSWORD"] == "from-file"


# --- IAM opt-in --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "host",
    [
        RDS,
        "app.cluster-abc123.eu-central-1.rds.amazonaws.com",  # Aurora cluster
        "app.proxy-abc123.eu-central-1.rds.amazonaws.com",  # RDS Proxy
    ],
)
@pytest.mark.parametrize("password", [None, ""], ids=["unset", "empty"])
def test_passwordless_rds_uses_iam(load_settings, host, password):
    env = {"DATABASE_HOST": host, **({} if password is None else {"DATABASE_PASSWORD": password})}
    database = load_settings(**env)["DATABASES"]["default"]
    assert database["ENGINE"] == "backend.utils.aws_iam"
    assert not database["PASSWORD"]  # the token is injected per connection, never stored


@pytest.mark.parametrize(
    "host, replication_group_id",
    [
        ("master.my-cache.abc123.euc1.cache.amazonaws.com", "my-cache"),
        ("replica.my-cache.abc123.euc1.cache.amazonaws.com", "my-cache"),
        ("my-cache-001.my-cache.abc123.euc1.cache.amazonaws.com", "my-cache"),
        ("clustercfg.my-cache.abc123.euc1.cache.amazonaws.com", "my-cache"),
    ],
)
def test_passwordless_elasticache_uses_iam(load_settings, host, replication_group_id):
    settings = load_settings(REDIS_HOST=host, REDIS_USER="phase", REDIS_SSL="true")

    found = providers(settings)
    assert len(found) == 4 and len({id(p) for p in found}) == 1  # one provider, shared
    assert (found[0].user, found[0].replication_group_id) == ("phase", replication_group_id)

    assert settings["CACHES"]["default"]["LOCATION"] == f"rediss://{host}:6379"
    for name in QUEUES:
        queue = settings["RQ_QUEUES"][name]
        # redis-py refuses a username/password alongside a credential provider
        assert queue["USERNAME"] is None and queue["PASSWORD"] is None
        assert set(queue) == ORIGINAL_QUEUE_KEYS | {"REDIS_CLIENT_KWARGS"}


def test_elasticache_iam_without_tls_does_not_crash_settings(load_settings):
    settings = load_settings(REDIS_HOST=ELASTICACHE, REDIS_USER="phase")
    assert len(providers(settings)) == 4


def test_postgres_and_valkey_opt_in_independently(load_settings):
    only_db = load_settings(
        DATABASE_HOST=RDS, REDIS_HOST=ELASTICACHE, REDIS_USER="phase", REDIS_PASSWORD="pw"
    )
    assert only_db["DATABASES"]["default"]["ENGINE"] == "backend.utils.aws_iam"
    assert providers(only_db) == []

    only_redis = load_settings(
        DATABASE_HOST=RDS, DATABASE_PASSWORD="pw", REDIS_HOST=ELASTICACHE, REDIS_USER="phase"
    )
    assert only_redis["DATABASES"]["default"]["ENGINE"] == POSTGRES
    assert len(providers(only_redis)) == 4


def test_iam_code_is_never_imported_for_password_setups():
    """A full Django boot with passwords must not load any of the AWS IAM modules."""
    env = {k: v for k, v in os.environ.items() if k not in MANAGED_ENV}
    env.update(DATABASE_HOST=RDS, DATABASE_PASSWORD="pw", REDIS_HOST=ELASTICACHE, REDIS_PASSWORD="pw")
    script = (
        "import django, sys; django.setup();"
        "from django.db import connection; from django.core.cache import cache; import django_rq;"
        "connection.get_connection_params(); cache._cache; django_rq.get_connection('default');"
        "print(sorted(m for m in sys.modules if m.startswith('backend.utils.aws_iam')))"
    )
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=BACKEND_DIR, env=env, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "[]"
