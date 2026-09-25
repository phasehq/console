"""An in-memory Secret Manager REST API, so the sync tests exercise the real
client: URLs, regional endpoints, request bodies, retries and version state."""

import base64
import json
import re
from unittest.mock import MagicMock
from urllib.parse import urlparse

import pytest
import requests

from api.utils.syncing.gcp import secret_manager

PROJECT_NUMBER = "123456789012"

_ROUTE = re.compile(
    r"^projects/(?P<project>[^/]+)(?:/locations/(?P<location>[^/]+))?/secrets"
    r"(?:/(?P<secret>[^/:]+))?"
    r"(?P<rest>:addVersion|/versions"
    r"|/versions/(?P<version>\d+|latest):(?P<action>access|disable|destroy))?$"
)


class FakeResponse:
    def __init__(self, status_code, body=None, headers=None):
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}
        self.content = b"" if body is None else json.dumps(body).encode()
        self.text = self.content.decode()
        self.reason = ""

    def json(self):
        if self._body is None:
            raise ValueError("No JSON body")
        return self._body


def error_response(code, status, message, details=None):
    error = {"code": code, "status": status, "message": message}
    if details:
        error["details"] = details
    return FakeResponse(code, {"error": error})


class FakeSecretManager:
    def __init__(self):
        self.secrets = {}  # (location, secret_id) -> metadata
        self.versions = {}  # (location, secret_id) -> [version dicts]
        self.calls = []
        self.page_size = None
        self._interceptors = []
        self._etag = 0

    # ---- test helpers -------------------------------------------------------

    def _name(self, location, secret_id):
        if location == "global":
            return f"projects/{PROJECT_NUMBER}/secrets/{secret_id}"
        return f"projects/{PROJECT_NUMBER}/locations/{location}/secrets/{secret_id}"

    def _next_etag(self):
        self._etag += 1
        return f'"{self._etag}"'

    def seed(
        self,
        secret_id,
        values=(),
        labels=None,
        location="global",
        replication=None,
        cmek=None,
        states=None,
        scheduled=(),
    ):
        secret = {
            "name": self._name(location, secret_id),
            "labels": dict(labels or {}),
            "etag": self._next_etag(),
        }
        if location == "global":
            secret["replication"] = replication or {"automatic": {}}
        elif cmek:
            secret["customerManagedEncryption"] = {"kmsKeyName": cmek}
        self.secrets[(location, secret_id)] = secret
        self.versions[(location, secret_id)] = []
        for index, value in enumerate(values):
            version = self._append_version(location, secret_id, value)
            if states:
                version["state"] = states[index]
            if index + 1 in scheduled:
                version["scheduledDestroyTime"] = "2026-10-01T00:00:00Z"
        return secret

    def secret(self, secret_id, location="global"):
        return self.secrets[(location, secret_id)]

    def payloads(self, secret_id, location="global"):
        return [v.get("data") for v in self.versions[(location, secret_id)]]

    def states(self, secret_id, location="global"):
        return [v["state"] for v in self.versions[(location, secret_id)]]

    def writes(self):
        return [call for call in self.calls if call["method"] != "GET"]

    def intercept(self, method, pattern, response, times=1):
        """Answer the next matching request(s) with `response`: a FakeResponse,
        an exception to raise, or a callable returning either."""
        self._interceptors.append(
            {"method": method, "pattern": pattern, "response": response, "times": times}
        )

    # ---- request handling -----------------------------------------------------

    def request(self, method, url, params=None, json=None, headers=None, timeout=None):
        params = dict(params or {})
        self.calls.append(
            {
                "method": method,
                "url": url,
                "params": params,
                "json": json,
                "headers": headers,
            }
        )
        for interceptor in self._interceptors:
            if (
                interceptor["times"]
                and interceptor["method"] == method
                and re.search(interceptor["pattern"], url)
            ):
                interceptor["times"] -= 1
                response = interceptor["response"]
                if callable(response) and not isinstance(response, FakeResponse):
                    response = response()
                if isinstance(response, Exception):
                    raise response
                return response

        parsed = urlparse(url)
        if parsed.netloc == "secretmanager.googleapis.com":
            host_location = "global"
        else:
            match = re.fullmatch(r"secretmanager\.([a-z0-9-]+)\.rep\.googleapis\.com", parsed.netloc)
            assert match, f"unexpected host {parsed.netloc}"
            host_location = match.group(1)

        route = _ROUTE.match(parsed.path.removeprefix("/v1/"))
        assert route, f"unexpected path {parsed.path}"
        location = route.group("location") or "global"
        assert location == host_location, "resource location doesn't match endpoint"
        secret_id = route.group("secret")
        rest = route.group("rest")

        if secret_id is None:
            if method == "GET":
                return self._list(location, params)
            if method == "POST":
                return self._create(location, params["secretId"], json)
        key = (location, secret_id)
        if key not in self.secrets:
            return error_response(404, "NOT_FOUND", f"Secret [{secret_id}] not found.")
        if rest is None and method == "GET":
            return FakeResponse(200, self.secrets[key])
        if rest is None and method == "PATCH":
            return self._patch(key, params["updateMask"], json)
        if rest == ":addVersion":
            data = base64.b64decode(json["payload"]["data"])
            if not data:
                return error_response(400, "INVALID_ARGUMENT", "Field [payload] is required.")
            version = self._append_version(location, secret_id, data)
            return FakeResponse(200, self._public(version))
        if rest == "/versions":
            return self._list_versions(key, params)
        if route.group("action") == "access":
            return self._access(key, route.group("version"))
        if route.group("action"):
            return self._change_state(key, int(route.group("version")), route.group("action"))
        raise AssertionError(f"unhandled {method} {url}")

    def _list(self, location, params):
        secrets = [s for (loc, _), s in self.secrets.items() if loc == location]
        start = int(params.get("pageToken") or 0)
        size = self.page_size or len(secrets) or 1
        page = secrets[start : start + size]
        body = {"secrets": page} if page else {}
        if start + size < len(secrets):
            body["nextPageToken"] = str(start + size)
        return FakeResponse(200, body)

    def _create(self, location, secret_id, body):
        if (location, secret_id) in self.secrets:
            return error_response(409, "ALREADY_EXISTS", f"Secret [{secret_id}] already exists.")
        if location == "global":
            assert "replication" in body, "global secrets need a replication policy"
        else:
            assert "replication" not in body, "regional secrets have no replication policy"
        secret = {
            "name": self._name(location, secret_id),
            "labels": body.get("labels", {}),
            "etag": self._next_etag(),
        }
        for field in ("replication", "customerManagedEncryption"):
            if field in body:
                secret[field] = body[field]
        self.secrets[(location, secret_id)] = secret
        self.versions[(location, secret_id)] = []
        return FakeResponse(200, secret)

    def _patch(self, key, update_mask, body):
        secret = self.secrets[key]
        if body.get("etag") and body["etag"] != secret["etag"]:
            return error_response(400, "FAILED_PRECONDITION", "etag mismatch")
        for path in update_mask.split(","):
            if path == "labels":
                secret["labels"] = body["labels"]
            elif path == "replication":
                if set(body["replication"]) != set(secret["replication"]):
                    return error_response(400, "INVALID_ARGUMENT", "replication type is immutable")
                secret["replication"] = body["replication"]
            elif path == "customer_managed_encryption":
                secret["customerManagedEncryption"] = body["customerManagedEncryption"]
            else:
                raise AssertionError(f"unexpected update mask {path}")
        secret["etag"] = self._next_etag()
        return FakeResponse(200, secret)

    def _append_version(self, location, secret_id, data):
        versions = self.versions[(location, secret_id)]
        version = {
            "name": f"{self._name(location, secret_id)}/versions/{len(versions) + 1}",
            "state": "ENABLED",
            "data": data if isinstance(data, bytes) else data.encode(),
        }
        versions.append(version)
        return version

    @staticmethod
    def _public(version):
        return {k: v for k, v in version.items() if k != "data"}

    def _access(self, key, version):
        versions = self.versions[key]
        if not versions:
            return error_response(404, "NOT_FOUND", "Secret not found or has no versions.")
        if version == "latest":
            target = versions[-1]
        elif int(version) <= len(versions):
            target = versions[int(version) - 1]
        else:
            return error_response(404, "NOT_FOUND", "Secret Version not found.")
        if target["state"] != "ENABLED":
            return error_response(
                400, "FAILED_PRECONDITION", f"Secret Version is in {target['state']} state."
            )
        return FakeResponse(
            200,
            {
                "name": target["name"],
                "payload": {"data": base64.b64encode(target["data"]).decode()},
            },
        )

    def _list_versions(self, key, params):
        states = set(re.findall(r"ENABLED|DISABLED|DESTROYED", params.get("filter", "")))
        matching = [
            self._public(v)
            for v in reversed(self.versions[key])
            if not states or v["state"] in states
        ]
        return FakeResponse(200, {"versions": matching} if matching else {})

    def _change_state(self, key, number, action):
        version = self.versions[key][number - 1]
        if version["state"] == "DESTROYED":
            return error_response(
                400, "FAILED_PRECONDITION", "SecretVersion.state is already DESTROYED."
            )
        if action == "disable":
            version["state"] = "DISABLED"
        else:
            version["state"] = "DESTROYED"
            version.pop("data", None)
        return FakeResponse(200, self._public(version))


class FakeTokenSource:
    instances = []

    def __init__(self, credentials, interactive=False):
        self.credentials = credentials
        self.interactive = interactive
        self.invalidations = 0
        self.error = None
        FakeTokenSource.instances.append(self)

    def token(self):
        if self.error:
            raise self.error
        return "test-token"

    def invalidate(self):
        self.invalidations += 1


@pytest.fixture
def fake_sm(monkeypatch):
    fake = FakeSecretManager()
    session = MagicMock()
    session.request.side_effect = fake.request
    monkeypatch.setattr(secret_manager.requests, "Session", lambda: session)
    FakeTokenSource.instances = []
    monkeypatch.setattr(secret_manager, "TokenSource", FakeTokenSource)
    monkeypatch.setattr(secret_manager, "REQUEST_INTERVAL_SECONDS", 0)
    fake.sleeps = []
    monkeypatch.setattr(secret_manager.time, "sleep", fake.sleeps.append)
    return fake


@pytest.fixture
def connection_error():
    return requests.ConnectionError("connection reset")
