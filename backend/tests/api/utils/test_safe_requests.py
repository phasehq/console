"""On Phase Cloud, requests to customer-supplied hosts re-run the address check
on every hop, so a redirect can't reach an address the first check would refuse.

These run requests' real redirect handling over a fake transport and fake DNS.
"""

from contextlib import contextmanager
from unittest.mock import patch
from urllib.parse import urlsplit

import pytest
import requests
from requests.adapters import HTTPAdapter

from api.utils import safe_requests
from api.utils.safe_requests import SafeSession, UnsafeURLError

DNS = {
    "ghe.example": "93.184.216.34",
    "moved.example": "93.184.216.35",
    "nomad.example": "93.184.216.36",
    "vault.example": "93.184.216.37",
    "internal.example": "10.0.0.5",
}
METADATA = "http://169.254.170.2/v2/metadata"
TO_METADATA = (302, {"Location": METADATA}, b"")
OK = (200, {"Content-Type": "application/json"}, b"{}")


@contextmanager
def fake_network(routes):
    """`routes` maps a host to (status, headers, body). Yields the URLs sent."""
    sent = []

    def send(adapter, request, **kwargs):
        sent.append(request.url)
        status, headers, body = routes[urlsplit(request.url).hostname]
        response = requests.Response()
        response.status_code = status
        response.headers.update(headers)
        response._content = body
        response.url = request.url
        response.request = request
        return response

    def resolve(host):
        return host, [], [DNS.get(host, host)]  # IP literals resolve to themselves

    with patch.object(HTTPAdapter, "send", autospec=True, side_effect=send), patch(
        "api.utils.network.socket.gethostbyname_ex", side_effect=resolve
    ):
        yield sent


def hosts(sent):
    return [urlsplit(url).hostname for url in sent]


@pytest.fixture
def cloud(settings):
    settings.APP_HOST = "cloud"


# ──────────────────────────────────────────────────────────────────────
# SafeSession and the module-level helpers
# ──────────────────────────────────────────────────────────────────────


def test_cloud_blocks_redirect_to_restricted_address(cloud):
    with fake_network({"ghe.example": TO_METADATA, "169.254.170.2": OK}) as sent:
        with pytest.raises(UnsafeURLError, match="restricted IP address"):
            safe_requests.get("http://ghe.example/api/v3/user/repos")

    assert hosts(sent) == ["ghe.example"]


def test_cloud_blocks_redirect_to_host_resolving_to_private_address(cloud):
    routes = {
        "ghe.example": (301, {"Location": "http://internal.example/"}, b""),
        "internal.example": OK,
    }
    with fake_network(routes) as sent:
        with pytest.raises(UnsafeURLError, match="restricted IP address"):
            safe_requests.get("http://ghe.example/")

    assert hosts(sent) == ["ghe.example"]


def test_cloud_checks_every_hop_of_a_redirect_chain(cloud):
    routes = {
        "ghe.example": (302, {"Location": "http://moved.example/"}, b""),
        "moved.example": TO_METADATA,
        "169.254.170.2": OK,
    }
    with fake_network(routes) as sent:
        with pytest.raises(UnsafeURLError):
            safe_requests.get("http://ghe.example/")

    assert hosts(sent) == ["ghe.example", "moved.example"]


@pytest.mark.parametrize("helper", ["put", "delete"])
def test_cloud_blocks_method_preserving_redirects(cloud, helper):
    routes = {
        "ghe.example": (307, {"Location": METADATA}, b""),
        "169.254.170.2": OK,
    }
    with fake_network(routes) as sent:
        with pytest.raises(UnsafeURLError):
            getattr(safe_requests, helper)("http://ghe.example/secret")

    assert hosts(sent) == ["ghe.example"]


def test_cloud_follows_redirect_to_allowed_address(cloud):
    routes = {
        "ghe.example": (301, {"Location": "http://moved.example/repositories/1"}, b""),
        "moved.example": OK,
    }
    with fake_network(routes) as sent:
        response = safe_requests.get("http://ghe.example/repos/acme/old-name")

    assert response.status_code == 200
    assert response.url == "http://moved.example/repositories/1"
    assert hosts(sent) == ["ghe.example", "moved.example"]


def test_cloud_blocks_restricted_first_request(cloud):
    with fake_network({"internal.example": OK}) as sent:
        with pytest.raises(UnsafeURLError, match="restricted IP address"):
            safe_requests.get("http://internal.example/")

    assert sent == []


def test_cloud_blocks_url_that_parsers_read_differently(cloud):
    """urllib.parse reads this host as the metadata address, urllib3 as ghe.example."""
    request = requests.Request("GET", "http://ghe.example/").prepare()
    request.url = "http://ghe.example\\@169.254.170.2/"

    with fake_network({"ghe.example": OK, "169.254.170.2": OK}) as sent:
        with pytest.raises(UnsafeURLError):
            SafeSession().send(request)

    assert sent == []


def test_blocked_request_is_a_requests_exception():
    """Providers already handle requests.RequestException."""
    assert issubclass(UnsafeURLError, requests.RequestException)


@pytest.mark.parametrize("app_host", [None, "self"])
def test_self_hosted_follows_redirects_unchecked(settings, app_host):
    """Self-hosted deployments may legitimately point at internal hosts."""
    settings.APP_HOST = app_host

    with fake_network({"ghe.example": TO_METADATA, "169.254.170.2": OK}) as sent:
        response = safe_requests.get("http://ghe.example/")

    assert response.status_code == 200
    assert hosts(sent) == ["ghe.example", "169.254.170.2"]


# ──────────────────────────────────────────────────────────────────────
# Providers that reach a customer-supplied host
# ──────────────────────────────────────────────────────────────────────

SECRETS = [("API_KEY", "value", "")]


def test_github_actions_sync_does_not_follow_redirect_to_restricted_address(cloud):
    from api.utils.syncing.github.actions import sync_github_secrets

    with fake_network({"ghe.example": TO_METADATA, "169.254.170.2": OK}) as sent:
        ok, result = sync_github_secrets(
            SECRETS, "token", "repo", "owner", api_host="http://ghe.example"
        )

    assert ok is False
    assert "Request blocked" in result["message"]
    assert set(hosts(sent)) == {"ghe.example"}


def test_github_dependabot_sync_does_not_follow_redirect_to_restricted_address(cloud):
    from api.utils.syncing.github.dependabot import sync_github_dependabot_secrets

    with fake_network({"ghe.example": TO_METADATA, "169.254.170.2": OK}) as sent:
        ok, result = sync_github_dependabot_secrets(
            SECRETS, "token", "repo", "owner", api_host="http://ghe.example"
        )

    assert ok is False
    assert "Request blocked" in result["message"]
    assert set(hosts(sent)) == {"ghe.example"}


NOMAD = "api.utils.syncing.nomad.main"
NOMAD_CREDENTIALS = {
    "nomad_addr": "http://nomad.example",
    "nomad_token_secret": "token",
}


def test_nomad_does_not_follow_redirect_to_restricted_address(cloud):
    from api.utils.syncing.nomad.main import get_nomad_token_info, sync_nomad_secrets

    with patch(f"{NOMAD}.get_credentials", return_value=NOMAD_CREDENTIALS):
        with fake_network({"nomad.example": TO_METADATA, "169.254.170.2": OK}) as sent:
            with pytest.raises(UnsafeURLError):
                get_nomad_token_info("credential-id")
            ok, result = sync_nomad_secrets(SECRETS, "credential-id", "app/prod")

    assert ok is False
    assert "Request blocked" in result["error"]
    assert set(hosts(sent)) == {"nomad.example"}


VAULT = "api.utils.syncing.vault.main"
VAULT_CREDENTIALS = {
    "vault_addr": "http://vault.example",
    "vault_role_id": "role",
    "vault_secret_id": "secret",
}


def test_vault_does_not_follow_redirect_to_restricted_address(cloud):
    from api.utils.syncing.vault.main import (
        authenticate_vault_client,
        sync_vault_secrets,
    )

    with patch(f"{VAULT}.get_credentials", return_value=VAULT_CREDENTIALS):
        with fake_network({"vault.example": TO_METADATA, "169.254.170.2": OK}) as sent:
            with pytest.raises(UnsafeURLError):
                authenticate_vault_client("credential-id")
            ok, result = sync_vault_secrets(SECRETS, "credential-id", "kv", "app")

    assert ok is False
    assert "Request blocked" in result["error"]
    assert set(hosts(sent)) == {"vault.example"}
