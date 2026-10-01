"""Sync Phase secrets to Google Cloud Secret Manager over its REST API (v1)."""

import base64
import json
import random
import re
import time

import graphene
import requests
from graphene import ObjectType

from .auth import INTERACTIVE_REQUEST_TIMEOUT, GCPAuthError, TokenSource

GLOBAL_LOCATION = "global"

SECRET_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,255}$")
SECRET_PREFIX_PATTERN = re.compile(r"^[A-Za-z0-9_-]{0,64}$")
# A project ID (6-30 characters) or a project number.
PROJECT_PATTERN = re.compile(r"^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|\d{1,20})$")
# A region (us-central1) or multi-region (eu). It becomes part of the regional
# endpoint's hostname, so it must never admit dots or slashes.
LOCATION_PATTERN = re.compile(r"^[a-z]{2,20}(?:-[a-z]{2,20}[0-9]{1,2})?$")
KMS_KEY_PATTERN = re.compile(
    r"^projects/[a-z0-9.:-]{1,63}/locations/(?P<location>[a-z0-9-]{1,63})/"
    r"keyRings/[A-Za-z0-9_-]{1,63}/cryptoKeys/[A-Za-z0-9_-]{1,63}$"
)

MAX_PAYLOAD_BYTES = 64 * 1024
MANAGED_BY_LABEL = "managed_by"
MANAGED_BY_VALUE = "phase"
SYNC_LABEL = "phase_sync"
# The organisation the sync belongs to. Sync IDs only mean something to the
# Phase instance that made them, so this is what tells a deleted sync's
# secrets apart from another org's, or another instance's.
ORG_LABEL = "phase_org"
# Set once every version of a secret whose key left Phase is disabled, so
# later runs skip it without reading its versions again.
REMOVED_LABEL = "phase_removed"
REMOVED_VALUE = "true"
# Current + previous, like AWSCURRENT/AWSPREVIOUS. Older versions are
# destroyed because Google bills every version that isn't.
VERSIONS_TO_KEEP = 2
# With CMEK, Secret Manager encrypts through this per-project service agent,
# so the agent needs access to the key, not the caller.
SECRET_MANAGER_SERVICE_AGENT = "service-{}@gcp-sa-secretmanager.iam.gserviceaccount.com"

# Reads and writes each have a 600/min quota per project, shared with
# everything else in the customer's project. Stay well under both.
REQUEST_INTERVAL_SECONDS = 0.15
MAX_ATTEMPTS = 6
MAX_BACKOFF_SECONDS = 32
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
REQUEST_TIMEOUT = (5, 30)
MAX_REPORTED_ITEMS = 10


def validate_project_id(value):
    project_id = (value or "").strip()
    if not PROJECT_PATTERN.fullmatch(project_id):
        raise ValueError(
            "Enter a Google Cloud project ID (6-30 lowercase letters, digits or "
            "hyphens, starting with a letter) or a project number."
        )
    return project_id


def validate_location(value):
    location = (value or "").strip().lower()
    if location != GLOBAL_LOCATION and not LOCATION_PATTERN.fullmatch(location):
        raise ValueError(
            "Choose 'global' or a Secret Manager region such as us-central1."
        )
    return location


def validate_secret_id(value):
    secret_id = (value or "").strip()
    if not SECRET_ID_PATTERN.fullmatch(secret_id):
        raise ValueError(
            "Secret names may only contain letters, numbers, hyphens and "
            "underscores, up to 255 characters."
        )
    return secret_id


def validate_prefix(value):
    prefix = (value or "").strip()
    if not SECRET_PREFIX_PATTERN.fullmatch(prefix):
        raise ValueError(
            "The prefix may only contain letters, numbers, hyphens and "
            "underscores, up to 64 characters."
        )
    return prefix


def validate_kms_key_name(value, location):
    kms_key_name = (value or "").strip()
    if not kms_key_name:
        return None
    match = KMS_KEY_PATTERN.fullmatch(kms_key_name)
    if not match:
        raise ValueError(
            "Enter the full Cloud KMS key name, e.g. projects/my-project/locations/"
            "global/keyRings/my-ring/cryptoKeys/my-key"
        )
    key_location = match.group("location")
    if location == GLOBAL_LOCATION and key_location != GLOBAL_LOCATION:
        raise ValueError(
            "Global secrets need a Cloud KMS key in the 'global' location."
        )
    if location != GLOBAL_LOCATION and key_location == GLOBAL_LOCATION:
        raise ValueError(
            f"Regional secrets need a Cloud KMS key in {location}, not a global key."
        )
    # A single region (us-central1) needs a key in exactly that region.
    # Multi-regions (us, eu) are left to Google to check.
    if "-" in location and key_location != location:
        raise ValueError(
            f"Secrets in {location} need a Cloud KMS key in {location}, not {key_location}."
        )
    return kms_key_name


def describe_destination(project_id, location):
    return f"projects/{project_id} ({location})"


class SecretManagerError(Exception):
    """A failed Secret Manager call, carrying Google's status and message."""

    def __init__(self, http_status, status, message, activation_url=None):
        super().__init__(message)
        self.http_status = http_status
        self.status = status
        self.message = message
        self.activation_url = activation_url

    @property
    def fatal(self):
        """True when every remaining call would fail the same way."""
        return (
            self.http_status in (0, 401, 403, 429)
            or self.http_status >= 500
            or self.status
            in ("PERMISSION_DENIED", "UNAUTHENTICATED", "RESOURCE_EXHAUSTED")
        )

    @property
    def kms(self):
        """Secret Manager couldn't use a customer-managed (Cloud KMS) key."""
        # Secret IDs have no spaces or slashes, so neither can match one.
        message = self.message.lower()
        return "cloud kms" in message or "/cryptokeys/" in message

    def user_message(self):
        if self.activation_url:
            return (
                "The Secret Manager API is disabled for this project. Enable it at "
                f"{self.activation_url} and sync again."
            )
        if self.kms:
            return f"Secret Manager can't use the Cloud KMS key. {self.message}"
        if self.http_status == 403 or self.status == "PERMISSION_DENIED":
            return (
                f"Permission denied: {self.message} Grant Phase's principal "
                "roles/secretmanager.editor and roles/secretmanager.secretAccessor "
                "on the project."
            )
        if self.http_status == 429 or self.status == "RESOURCE_EXHAUSTED":
            return (
                "Google Cloud kept rate-limiting Secret Manager requests. Try the "
                f"sync again in a few minutes. ({self.message})"
            )
        return f"{self.status or f'HTTP {self.http_status}'}: {self.message}"


def _parse_error(response):
    try:
        body = response.json()
    except ValueError:
        body = None
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return SecretManagerError(
            response.status_code, "", (response.text or response.reason or "")[:300]
        )
    activation_url = None
    for detail in error.get("details") or []:
        if isinstance(detail, dict) and detail.get("reason") == "SERVICE_DISABLED":
            activation_url = (detail.get("metadata") or {}).get("activationUrl")
    return SecretManagerError(
        response.status_code,
        error.get("status") or "",
        error.get("message") or "",
        activation_url,
    )


def _secret_id(secret):
    return secret["name"].rsplit("/secrets/", 1)[-1]


def _version_number(version):
    try:
        return int(version["name"].rsplit("/", 1)[-1])
    except (KeyError, ValueError):
        return 0


class SecretManagerClient:
    """A thin REST client for one project and location.

    Global secrets use secretmanager.googleapis.com; regional secrets use the
    location's regional endpoint.
    """

    def __init__(
        self,
        token_source,
        project_id,
        location,
        request_interval=None,
        interactive=False,
    ):
        self._tokens = token_source
        self._interval = (
            REQUEST_INTERVAL_SECONDS if request_interval is None else request_interval
        )
        # While a user waits on a web request, try once and briefly, so
        # Google's error comes back well inside the server's request timeout.
        self._max_attempts = 1 if interactive else MAX_ATTEMPTS
        self._timeout = INTERACTIVE_REQUEST_TIMEOUT if interactive else REQUEST_TIMEOUT
        self._next_request_at = 0.0
        self._session = requests.Session()
        self.project_id = project_id
        self.location = location
        if location == GLOBAL_LOCATION:
            self._base_url = "https://secretmanager.googleapis.com/v1"
            self.parent = f"projects/{project_id}"
        else:
            self._base_url = f"https://secretmanager.{location}.rep.googleapis.com/v1"
            self.parent = f"projects/{project_id}/locations/{location}"

    def _pace(self):
        wait = self._next_request_at - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._next_request_at = time.monotonic() + self._interval

    def _backoff(self, attempt, retry_after=None):
        delay = min(2**attempt + random.random(), MAX_BACKOFF_SECONDS)
        try:
            delay = max(delay, min(float(retry_after), 2 * MAX_BACKOFF_SECONDS))
        except (TypeError, ValueError):
            pass
        time.sleep(delay)

    def _request(self, method, path, params=None, body=None, paced=True):
        url = f"{self._base_url}/{path}"
        token_refreshed = False
        attempt = 0
        while True:
            attempt += 1
            if paced:
                self._pace()
            try:
                response = self._session.request(
                    method,
                    url,
                    params=params,
                    json=body,
                    headers={"Authorization": f"Bearer {self._tokens.token()}"},
                    timeout=self._timeout,
                )
            except requests.RequestException:
                if attempt < self._max_attempts:
                    self._backoff(attempt)
                    continue
                raise SecretManagerError(
                    0, "UNAVAILABLE", "Could not reach Google Cloud Secret Manager."
                )

            if response.status_code == 401 and not token_refreshed:
                self._tokens.invalidate()
                token_refreshed = True
                continue
            if (
                response.status_code in RETRYABLE_STATUS_CODES
                and attempt < self._max_attempts
            ):
                self._backoff(attempt, response.headers.get("Retry-After"))
                continue
            if response.status_code >= 400:
                raise _parse_error(response)
            return response.json() if response.content else {}

    def secret_path(self, secret_id):
        return f"{self.parent}/secrets/{secret_id}"

    def list_secrets(self):
        secrets = []
        params = {"pageSize": 25000}
        while True:
            body = self._request("GET", f"{self.parent}/secrets", params=params)
            secrets.extend(body.get("secrets", []))
            if not body.get("nextPageToken"):
                return secrets
            params = {"pageSize": 25000, "pageToken": body["nextPageToken"]}

    def get_secret(self, secret_id):
        try:
            return self._request("GET", self.secret_path(secret_id))
        except SecretManagerError as e:
            if e.http_status == 404:
                return None
            raise

    def create_secret(self, secret_id, labels, kms_key_name=None):
        body = {"labels": labels}
        if self.location == GLOBAL_LOCATION:
            automatic = {}
            if kms_key_name:
                automatic["customerManagedEncryption"] = {"kmsKeyName": kms_key_name}
            body["replication"] = {"automatic": automatic}
        elif kms_key_name:
            body["customerManagedEncryption"] = {"kmsKeyName": kms_key_name}
        return self._request(
            "POST",
            f"{self.parent}/secrets",
            params={"secretId": secret_id},
            body=body,
        )

    def patch_secret(self, secret_id, fields, update_mask, etag=None):
        body = dict(fields)
        if etag:
            body["etag"] = etag
        return self._request(
            "PATCH",
            self.secret_path(secret_id),
            params={"updateMask": update_mask},
            body=body,
        )

    def add_version(self, secret_id, data):
        return self._request(
            "POST",
            f"{self.secret_path(secret_id)}:addVersion",
            body={"payload": {"data": base64.b64encode(data).decode()}},
        )

    def access_latest(self, secret_id):
        """The newest version's payload, or None when it can't be read."""
        try:
            # Access has its own 90,000/min quota, so it isn't paced.
            body = self._request(
                "GET",
                f"{self.secret_path(secret_id)}/versions/latest:access",
                paced=False,
            )
        except SecretManagerError as e:
            # 404: no versions yet. FAILED_PRECONDITION: the newest version is
            # disabled or destroyed ("latest" never skips to an older one).
            if e.http_status == 404 or (e.status == "FAILED_PRECONDITION" and not e.kms):
                return None
            raise
        return base64.b64decode((body.get("payload") or {}).get("data") or "")

    def access_version(self, version_name):
        """A version's payload, or None when it can't be read (disabled)."""
        try:
            body = self._request("GET", f"{version_name}:access", paced=False)
        except SecretManagerError as e:
            if e.http_status == 404 or (e.status == "FAILED_PRECONDITION" and not e.kms):
                return None
            raise
        return base64.b64decode((body.get("payload") or {}).get("data") or "")

    def list_versions(self, secret_id, state_filter):
        versions = []
        params = {"pageSize": 25000, "filter": state_filter}
        while True:
            body = self._request(
                "GET", f"{self.secret_path(secret_id)}/versions", params=params
            )
            versions.extend(body.get("versions", []))
            if not body.get("nextPageToken"):
                return versions
            params = {
                "pageSize": 25000,
                "filter": state_filter,
                "pageToken": body["nextPageToken"],
            }

    def disable_version(self, version_name):
        return self._request("POST", f"{version_name}:disable", body={})

    def destroy_version(self, version_name):
        return self._request("POST", f"{version_name}:destroy", body={})


def _format_names(names):
    shown = ", ".join(names[:MAX_REPORTED_ITEMS])
    if len(names) > MAX_REPORTED_ITEMS:
        shown += f" and {len(names) - MAX_REPORTED_ITEMS} more"
    return shown


class _SyncRun:
    """Pushes secrets into one project/location and records what happened."""

    def __init__(
        self, client, sync_id, organisation_id, kms_key_name, owner_is_active=None
    ):
        self.client = client
        self.sync_label = str(sync_id).lower()
        self.org_label = str(organisation_id).lower()
        self.labels = {
            MANAGED_BY_LABEL: MANAGED_BY_VALUE,
            SYNC_LABEL: self.sync_label,
            ORG_LABEL: self.org_label,
        }
        self.kms_key_name = kms_key_name
        # Called with another sync's label value; False means that sync was
        # deleted, so its secrets can be taken over (recreating a sync is the
        # only way to change its options).
        self._owner_is_active = owner_is_active
        self._owner_cache = {}
        self.created = 0
        self.updated = 0
        self.unchanged = 0
        self.disabled = 0
        self.errors = []
        self.warnings = []

    def is_own_key_error(self, error):
        """A Cloud KMS error about the sync's key, which every write would hit.
        One naming another key belongs to that secret alone."""
        return bool(
            self.kms_key_name and error.kms and self.kms_key_name in error.message
        )

    def owns(self, secret):
        return (secret.get("labels") or {}).get(SYNC_LABEL) == self.sync_label

    def _owned_elsewhere(self, labels):
        """Whether a secret another sync wrote still belongs to someone else.

        Only a deleted sync of this organisation gives its secrets up. Syncs
        are deleted outright, so an unknown sync ID alone can't tell a deleted
        sync from another instance's: the org label has to match too.
        """
        if labels.get(ORG_LABEL) != self.org_label or self._owner_is_active is None:
            return True
        owner = labels[SYNC_LABEL]
        if owner not in self._owner_cache:
            self._owner_cache[owner] = bool(self._owner_is_active(owner))
        return self._owner_cache[owner]

    def push(self, secret_id, data, existing, same_value=None):
        """Create or update one secret. `existing` is its metadata, or None."""
        if existing is None:
            existing = self._create(secret_id, data)
            if existing is None:
                return

        current_labels = existing.get("labels") or {}
        owner = current_labels.get(SYNC_LABEL)
        if owner and owner != self.sync_label and self._owned_elsewhere(current_labels):
            self.errors.append(
                f"{secret_id}: managed by a different Phase sync, left unchanged"
            )
            return
        # Each replica needs a key in its own region and the sync's key is in
        # global, so a write here would land under a key other than the sync's.
        if self.kms_key_name and "userManaged" in (existing.get("replication") or {}):
            self.errors.append(
                f"{secret_id}: uses user-managed replication, so it can't be "
                "encrypted with the sync's key; left unchanged"
            )
            return
        # Adopts a secret created outside Phase or by a deleted sync, and
        # clears the removed marker from a key that's back in Phase.
        labels = {**current_labels, **self.labels}
        labels.pop(REMOVED_LABEL, None)
        if labels != current_labels:
            existing = self.client.patch_secret(
                secret_id, {"labels": labels}, "labels", existing.get("etag")
            )
        # Google only encrypts versions added after a key change, so a secret
        # just moved onto the sync's key gets a new version even when its value
        # is unchanged.
        if not self._align_encryption(secret_id, existing):
            current = self.client.access_latest(secret_id)
            if current is not None and (
                same_value(current, data) if same_value else current == data
            ):
                self.unchanged += 1
                return
        version = self.client.add_version(secret_id, data)
        self.updated += 1
        self._prune(secret_id, data, version)

    def _create(self, secret_id, data):
        """Create and populate a secret. Returns None, or the secret's metadata
        when it turned out to exist already."""
        try:
            self.client.create_secret(secret_id, self.labels, self.kms_key_name)
        except SecretManagerError as e:
            if e.http_status != 409:
                raise
            existing = self.client.get_secret(secret_id)
            if existing is None:
                raise
            return existing
        self.client.add_version(secret_id, data)
        self.created += 1
        return None

    def _align_encryption(self, secret_id, secret):
        """Point an existing secret at the sync's CMEK key, and return whether
        it changed. Google applies the key to versions added from then on."""
        if not self.kms_key_name:
            return False
        if self.client.location == GLOBAL_LOCATION:
            replication = secret.get("replication") or {}
            current = (
                (replication.get("automatic") or {}).get("customerManagedEncryption")
                or {}
            ).get("kmsKeyName")
            if current != self.kms_key_name:
                self.client.patch_secret(
                    secret_id,
                    {
                        "replication": {
                            "automatic": {
                                "customerManagedEncryption": {
                                    "kmsKeyName": self.kms_key_name
                                }
                            }
                        }
                    },
                    "replication",
                    secret.get("etag"),
                )
                return True
            return False
        current = (secret.get("customerManagedEncryption") or {}).get("kmsKeyName")
        if current != self.kms_key_name:
            self.client.patch_secret(
                secret_id,
                {"customerManagedEncryption": {"kmsKeyName": self.kms_key_name}},
                "customer_managed_encryption",
                secret.get("etag"),
            )
            return True
        return False

    def _prune(self, secret_id, data, new_version):
        """Keep the newest version and the newest older one holding a
        different value, and destroy the rest.

        Comparing values means a duplicate write (a retried request, or two
        overlapping runs) can't push the real previous value out. A disabled
        version can't be read, so it's only kept when no older version can be.
        """
        if _version_number(new_version) <= VERSIONS_TO_KEEP:
            return
        try:
            versions = self.client.list_versions(
                secret_id, "state:(ENABLED OR DISABLED)"
            )
            live = sorted(
                (
                    version
                    for version in versions
                    # Already scheduled for destruction by the secret's own
                    # delayed-destroy setting.
                    if not version.get("scheduledDestroyTime")
                ),
                key=_version_number,
                reverse=True,
            )
            if not live:
                return
            newest_value = (
                data
                if live[0]["name"] == new_version.get("name")
                else self.client.access_version(live[0]["name"])
            )
            kept_previous = False
            newest_disabled = None
            doomed = []
            for version in live[1:]:
                value = self.client.access_version(version["name"])
                if not kept_previous and value is not None and value != newest_value:
                    kept_previous = True
                    continue
                if value is None and newest_disabled is None:
                    newest_disabled = version
                doomed.append(version)
            # Every older version is disabled, as when a key left Phase and
            # came back: keep the newest one rather than nothing.
            if not kept_previous and newest_disabled is not None:
                doomed.remove(newest_disabled)
            for version in doomed:
                self._destroy(version["name"])
        except SecretManagerError as e:
            if e.fatal and e.status != "PERMISSION_DENIED":
                raise
            self.warnings.append(
                f"{secret_id}: old versions weren't destroyed ({e.status or e.http_status}: {e.message})"
            )

    def _destroy(self, version_name):
        try:
            self.client.destroy_version(version_name)
        except SecretManagerError as e:
            # Already destroyed, e.g. by an overlapping run.
            if e.status != "FAILED_PRECONDITION":
                raise

    def disable(self, secret_id, secret):
        """Disable every enabled version of a secret whose key left Phase."""
        labels = secret.get("labels") or {}
        if labels.get(REMOVED_LABEL) == REMOVED_VALUE:
            return
        versions = self.client.list_versions(secret_id, "state:ENABLED")
        # Oldest first: an interrupted run leaves the newest version enabled,
        # so the next run sees the secret as live and finishes the job.
        for version in sorted(versions, key=_version_number):
            self.client.disable_version(version["name"])
        self.client.patch_secret(
            secret_id,
            {"labels": {**labels, REMOVED_LABEL: REMOVED_VALUE}},
            "labels",
            secret.get("etag"),
        )
        if versions:
            self.disabled += 1

    def summary(self, destination):
        counts = [
            f"{self.created} created",
            f"{self.updated} updated",
            f"{self.unchanged} unchanged",
        ]
        if self.disabled:
            counts.append(f"{self.disabled} disabled")
        return f"{destination}: {', '.join(counts)}."

    def result(self, destination, notes=()):
        lines = [self.summary(destination), *notes]
        if self.warnings:
            lines.append("Warnings:")
            lines.extend(f"- {warning}" for warning in self.warnings[:MAX_REPORTED_ITEMS])
            if len(self.warnings) > MAX_REPORTED_ITEMS:
                lines.append(f"- and {len(self.warnings) - MAX_REPORTED_ITEMS} more")
        if self.errors:
            lines.append(f"{len(self.errors)} secret(s) failed:")
            lines.extend(f"- {error}" for error in self.errors[:MAX_REPORTED_ITEMS])
            if len(self.errors) > MAX_REPORTED_ITEMS:
                lines.append(f"- and {len(self.errors) - MAX_REPORTED_ITEMS} more")
        return not self.errors, {"message": "\n".join(lines)}


def _plan_individual(secrets, prefix):
    """Map Phase keys to secret IDs and payloads, and catch everything Google
    would reject before any call is made."""
    desired = {}
    empty, invalid, too_large = [], [], []
    for key, value, _comment in secrets:
        secret_id = f"{prefix}{key}"
        if not SECRET_ID_PATTERN.fullmatch(secret_id):
            invalid.append(key)
        elif not value:
            # Google rejects empty payloads; treat the key as absent.
            empty.append(key)
        elif len(value.encode("utf-8")) > MAX_PAYLOAD_BYTES:
            too_large.append(key)
        else:
            desired[secret_id] = value.encode("utf-8")
    return desired, empty, invalid, too_large


def _preflight_message(invalid, too_large):
    lines = ["Nothing was synced."]
    if invalid:
        lines.append(
            "GCP secret names may only contain letters, numbers, hyphens and "
            "underscores, up to 255 characters including the prefix. Rename: "
            f"{_format_names(invalid)}"
        )
    if too_large:
        lines.append(
            f"Google Cloud caps a secret value at 64 KiB. Too large: {_format_names(too_large)}"
        )
    return "\n".join(lines)


def _kms_grant_message(project_id, kms_key_name):
    """How to let a project's Secret Manager service agent use a CMEK key."""
    number = (
        project_id
        if project_id.isdigit()
        else f"$(gcloud projects describe {project_id} --format='value(projectNumber)')"
    )
    agent = SECRET_MANAGER_SERVICE_AGENT.format(number)
    return (
        "Secret Manager can't use the Cloud KMS key. With CMEK, Google encrypts "
        "through the project's Secret Manager service agent, so that agent needs "
        "the Cloud KMS CryptoKey Encrypter/Decrypter role on the key. Phase "
        "doesn't need access to the key. To grant it, run this where gcloud can "
        "manage the key, then sync again:\n"
        "gcloud beta services identity create --service=secretmanager.googleapis.com "
        f"--project={project_id}\n"
        f"gcloud kms keys add-iam-policy-binding {kms_key_name} \\\n"
        f'  --member="serviceAccount:{agent}" \\\n'
        "  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter --condition=None"
    )


def _fatal_message(destination, error, run):
    if run and run.is_own_key_error(error) and "permission" in error.message.lower():
        # The sync's own key: say exactly which agent needs it.
        reason = _kms_grant_message(run.client.project_id, run.kms_key_name)
    else:
        reason = error.user_message()
    message = f"{destination}: {reason}"
    if run and (run.created or run.updated or run.unchanged or run.disabled):
        message += f"\nStopped part-way. Before that, {run.summary('this sync')}"
    return message


def sync_gcp_secrets_individual(
    secrets,
    credentials,
    project_id,
    location,
    sync_id,
    prefix="",
    kms_key_name=None,
    *,
    organisation_id,
    owner_is_active=None,
):
    """One Secret Manager secret per Phase key.

    Secrets this sync manages, whether it created them or took them over,
    have their versions disabled once their keys are no longer in Phase. They
    aren't deleted, so they can come back without losing their IAM bindings.
    """
    try:
        project_id = validate_project_id(project_id)
        location = validate_location(location)
        prefix = validate_prefix(prefix)
        kms_key_name = validate_kms_key_name(kms_key_name, location)
    except ValueError as e:
        return False, {"message": str(e)}

    destination = describe_destination(project_id, location)
    desired, empty, invalid, too_large = _plan_individual(secrets, prefix)
    if invalid or too_large:
        return False, {"message": _preflight_message(invalid, too_large)}

    run = None
    try:
        client = SecretManagerClient(TokenSource(credentials), project_id, location)
        run = _SyncRun(
            client, sync_id, organisation_id, kms_key_name, owner_is_active
        )
        existing = {_secret_id(secret): secret for secret in client.list_secrets()}

        for secret_id, data in desired.items():
            try:
                run.push(secret_id, data, existing.get(secret_id))
            except SecretManagerError as e:
                # Every secret is encrypted with the sync's key, so if it
                # can't be used, nothing can be written.
                if e.fatal or run.is_own_key_error(e):
                    raise
                run.errors.append(f"{secret_id}: {e.user_message()}")

        for secret_id, secret in existing.items():
            if secret_id in desired or not run.owns(secret):
                continue
            try:
                run.disable(secret_id, secret)
            except SecretManagerError as e:
                if e.fatal:
                    raise
                run.errors.append(f"{secret_id}: {e.user_message()}")
    except GCPAuthError as e:
        return False, {"message": str(e)}
    except SecretManagerError as e:
        return False, {"message": _fatal_message(destination, e, run)}

    notes = []
    if empty:
        notes.append(
            "Google Cloud doesn't allow empty values, so these keys were treated "
            f"as removed: {_format_names(empty)}"
        )
    return run.result(destination, notes)


def sync_gcp_secrets_blob(
    secrets,
    credentials,
    project_id,
    location,
    sync_id,
    secret_name,
    kms_key_name=None,
    *,
    organisation_id,
    owner_is_active=None,
):
    """All Phase keys as one JSON object in a single Secret Manager secret."""
    try:
        project_id = validate_project_id(project_id)
        location = validate_location(location)
        secret_name = validate_secret_id(secret_name)
        kms_key_name = validate_kms_key_name(kms_key_name, location)
    except ValueError as e:
        return False, {"message": str(e)}

    destination = describe_destination(project_id, location)
    values = {key: value for key, value, _comment in secrets}
    # Sorted so an unchanged environment always serializes to the same bytes.
    data = json.dumps(values, sort_keys=True).encode("utf-8")
    if len(data) > MAX_PAYLOAD_BYTES:
        return False, {
            "message": (
                f"Nothing was synced. The JSON is {len(data) / 1024:.1f} KiB, but "
                "Google Cloud caps a secret at 64 KiB. Sync one secret per key "
                "instead, or split these secrets across paths."
            )
        }

    def same_json(current, _data):
        try:
            return json.loads(current) == values
        except ValueError:
            return False

    run = None
    try:
        client = SecretManagerClient(TokenSource(credentials), project_id, location)
        run = _SyncRun(
            client, sync_id, organisation_id, kms_key_name, owner_is_active
        )
        run.push(secret_name, data, client.get_secret(secret_name), same_json)
    except GCPAuthError as e:
        return False, {"message": str(e)}
    except SecretManagerError as e:
        return False, {"message": _fatal_message(destination, e, run)}

    return run.result(f"{destination}, secret {secret_name}")


class GCPSecretType(ObjectType):
    name = graphene.String()
    managed_by_phase = graphene.Boolean()


def list_gcp_secrets(credentials, project_id, location):
    """Secret names in a project/location, for the sync setup picker."""
    project_id = validate_project_id(project_id)
    location = validate_location(location)
    client = SecretManagerClient(
        TokenSource(credentials, interactive=True),
        project_id,
        location,
        request_interval=0,
        interactive=True,
    )
    return [
        {
            "name": _secret_id(secret),
            "managed_by_phase": (secret.get("labels") or {}).get(MANAGED_BY_LABEL)
            == MANAGED_BY_VALUE,
        }
        for secret in client.list_secrets()
    ]
