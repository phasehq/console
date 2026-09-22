import json

import pytest

from api.utils.syncing.gcp import secret_manager
from api.utils.syncing.gcp.auth import GCPAuthError
from api.utils.syncing.gcp.secret_manager import (
    list_gcp_secrets,
    sync_gcp_secrets_blob,
    sync_gcp_secrets_individual,
    validate_kms_key_name,
    validate_location,
    validate_prefix,
    validate_project_id,
)

from .conftest import FakeResponse, FakeTokenSource, error_response

SYNC_ID = "5f0c2d4e-1111-4a2b-9c3d-abcdef012345"
OUR_LABELS = {"managed_by": "phase", "phase_sync": SYNC_ID}
CREDENTIALS = {"workload_identity_provider": "projects/1/locations/global/workloadIdentityPools/p/providers/p"}
GLOBAL_KEY = "projects/kms-proj/locations/global/keyRings/ring/cryptoKeys/key"
REGIONAL_KEY = "projects/kms-proj/locations/us-central1/keyRings/ring/cryptoKeys/key"


def run(secrets, location="global", **kwargs):
    return sync_gcp_secrets_individual(
        [(key, value, "") for key, value in secrets],
        CREDENTIALS,
        "my-project",
        location,
        SYNC_ID,
        **kwargs,
    )


def run_blob(secrets, secret_name="app-prod", **kwargs):
    return sync_gcp_secrets_blob(
        [(key, value, "") for key, value in secrets],
        CREDENTIALS,
        "my-project",
        "global",
        SYNC_ID,
        secret_name,
        **kwargs,
    )


# ---- validation ---------------------------------------------------------------


@pytest.mark.parametrize("value", ["global", "us-central1", "eu", "US-Central1", "northamerica-northeast1"])
def test_valid_locations(value):
    assert validate_location(value) == value.lower()


@pytest.mark.parametrize(
    "value", ["", "us-central1.evil.example", "evil.example", "us/central1", "us-central1@x"]
)
def test_locations_that_would_change_the_endpoint_host_are_rejected(value):
    with pytest.raises(ValueError):
        validate_location(value)


@pytest.mark.parametrize("value", ["my-project", "project-123", "123456789012"])
def test_valid_project_ids(value):
    assert validate_project_id(value) == value


@pytest.mark.parametrize("value", ["", "short", "My-Project", "my-project-", "a/b", "../x"])
def test_invalid_project_ids(value):
    with pytest.raises(ValueError):
        validate_project_id(value)


def test_kms_key_location_must_match_the_secret_location():
    assert validate_kms_key_name(GLOBAL_KEY, "global") == GLOBAL_KEY
    assert validate_kms_key_name(REGIONAL_KEY, "us-central1") == REGIONAL_KEY
    with pytest.raises(ValueError, match="need a Cloud KMS key in europe-west4, not us-central1"):
        validate_kms_key_name(REGIONAL_KEY, "europe-west4")
    # Multi-regions are left to Google to check.
    eu_key = "projects/kms-proj/locations/europe/keyRings/ring/cryptoKeys/key"
    assert validate_kms_key_name(eu_key, "eu") == eu_key
    assert validate_kms_key_name("", "global") is None
    with pytest.raises(ValueError, match="'global' location"):
        validate_kms_key_name(REGIONAL_KEY, "global")
    with pytest.raises(ValueError, match="not a global key"):
        validate_kms_key_name(GLOBAL_KEY, "us-central1")
    with pytest.raises(ValueError, match="full Cloud KMS key name"):
        validate_kms_key_name("projects/p/keyRings/r", "global")


def test_prefix_rules():
    assert validate_prefix(" PROD_ ") == "PROD_"
    assert validate_prefix(None) == ""
    for bad in ("PROD.", "a/b", "x" * 65):
        with pytest.raises(ValueError):
            validate_prefix(bad)


# ---- one secret per key -------------------------------------------------------


def test_first_sync_creates_labelled_secrets(fake_sm):
    ok, meta = run([("DB_URL", "postgres://db"), ("API_KEY", "k")])

    assert ok, meta
    assert fake_sm.secret("DB_URL")["labels"] == OUR_LABELS
    assert fake_sm.secret("DB_URL")["replication"] == {"automatic": {}}
    assert fake_sm.payloads("DB_URL") == [b"postgres://db"]
    assert fake_sm.payloads("API_KEY") == [b"k"]
    assert "2 created, 0 updated, 0 unchanged" in meta["message"]
    create = next(c for c in fake_sm.calls if c["params"].get("secretId") == "DB_URL")
    assert create["url"] == "https://secretmanager.googleapis.com/v1/projects/my-project/secrets"
    assert create["headers"] == {"Authorization": "Bearer test-token"}


def test_unchanged_values_make_no_writes(fake_sm):
    run([("A", "1"), ("B", "2")])
    fake_sm.calls.clear()

    ok, meta = run([("A", "1"), ("B", "2")])

    assert ok
    assert fake_sm.writes() == []
    assert "0 created, 0 updated, 2 unchanged" in meta["message"]


def test_changes_keep_the_current_and_previous_versions(fake_sm):
    for value in ("1", "2", "3"):
        ok, _ = run([("A", value)])
        assert ok

    assert fake_sm.states("A") == ["DESTROYED", "ENABLED", "ENABLED"]
    assert fake_sm.payloads("A")[1:] == [b"2", b"3"]


def test_removed_key_is_disabled_once_and_comes_back_when_re_added(fake_sm):
    run([("A", "1"), ("B", "2")])

    ok, meta = run([("A", "1")])
    assert ok
    assert fake_sm.states("B") == ["DISABLED"]
    assert fake_sm.secret("B")["labels"]["phase_removed"] == "true"
    assert "1 disabled" in meta["message"]

    # Marked as removed: later runs don't even read its versions.
    fake_sm.calls.clear()
    ok, meta = run([("A", "1")])
    assert ok
    assert fake_sm.writes() == []
    assert not [c for c in fake_sm.calls if "secrets/B" in c["url"]]
    assert "disabled" not in meta["message"]

    ok, _ = run([("A", "1"), ("B", "2")])
    assert ok
    assert fake_sm.states("B") == ["DISABLED", "ENABLED"]
    assert "phase_removed" not in fake_sm.secret("B")["labels"]

    # And it can be removed again.
    ok, _ = run([("A", "1")])
    assert ok
    assert fake_sm.states("B") == ["DISABLED", "DISABLED"]


def test_empty_values_are_treated_as_removed(fake_sm):
    run([("A", "1")])

    ok, meta = run([("A", ""), ("NEW_EMPTY", "")])

    assert ok
    assert fake_sm.states("A") == ["DISABLED"]
    assert ("global", "NEW_EMPTY") not in fake_sm.secrets
    assert "treated as removed: A, NEW_EMPTY" in meta["message"]


def test_invalid_names_fail_before_any_request(fake_sm):
    ok, meta = run([("spring.datasource.url", "x"), ("OK", "y")])

    assert not ok
    assert fake_sm.calls == []
    assert "spring.datasource.url" in meta["message"]
    assert meta["message"].startswith("Nothing was synced.")


def test_prefix_counts_towards_the_name_limit(fake_sm):
    ok, _ = run([("A", "1")], prefix="PROD_")
    assert ok
    assert fake_sm.payloads("PROD_A") == [b"1"]

    ok, meta = run([("K" * 251, "1")], prefix="PROD_")
    assert not ok
    assert "Rename" in meta["message"]


def test_values_over_64_kib_fail_before_any_request(fake_sm):
    ok, meta = run([("BIG", "x" * (64 * 1024 + 1))])
    assert not ok
    assert fake_sm.calls == []
    assert "Too large: BIG" in meta["message"]

    ok, _ = run([("EXACT", "x" * (64 * 1024))])
    assert ok


def test_multibyte_values_are_measured_in_bytes(fake_sm):
    ok, meta = run([("EMOJI", "\U0001F512" * (16 * 1024 + 1))])  # 4 bytes each
    assert not ok
    assert "Too large: EMOJI" in meta["message"]


def test_adopts_an_unlabelled_secret_and_keeps_its_labels(fake_sm):
    fake_sm.seed("A", values=[b"old"], labels={"team": "core"})

    ok, meta = run([("A", "new")])

    assert ok
    assert fake_sm.secret("A")["labels"] == {"team": "core", **OUR_LABELS}
    assert fake_sm.payloads("A") == [b"old", b"new"]
    assert "1 updated" in meta["message"]


def test_secret_owned_by_another_sync_is_left_alone(fake_sm):
    fake_sm.seed("A", values=[b"old"], labels={"managed_by": "phase", "phase_sync": "other"})

    ok, meta = run([("A", "new"), ("B", "b")])

    assert not ok
    assert fake_sm.payloads("A") == [b"old"]
    assert fake_sm.secret("A")["labels"]["phase_sync"] == "other"
    assert fake_sm.payloads("B") == [b"b"]
    assert "A: managed by a different Phase sync" in meta["message"]


def test_secrets_phase_did_not_create_are_never_disabled(fake_sm):
    fake_sm.seed("OTHER", values=[b"x"])
    fake_sm.seed("OTHER_SYNC", values=[b"y"], labels={"managed_by": "phase", "phase_sync": "other"})

    ok, _ = run([("A", "1")])

    assert ok
    assert fake_sm.states("OTHER") == ["ENABLED"]
    assert fake_sm.states("OTHER_SYNC") == ["ENABLED"]


def test_regional_secrets_use_the_regional_endpoint_and_cmek(fake_sm):
    ok, meta = run([("A", "1")], location="us-central1", kms_key_name=REGIONAL_KEY)

    assert ok, meta
    secret = fake_sm.secret("A", location="us-central1")
    assert "replication" not in secret
    assert secret["customerManagedEncryption"] == {"kmsKeyName": REGIONAL_KEY}
    create = next(c for c in fake_sm.calls if c["method"] == "POST")
    assert create["url"] == (
        "https://secretmanager.us-central1.rep.googleapis.com/v1/"
        "projects/my-project/locations/us-central1/secrets"
    )


def test_regional_cmek_key_is_updated_on_existing_secrets(fake_sm):
    fake_sm.seed("A", values=[b"1"], labels=OUR_LABELS, location="us-central1")

    ok, _ = run([("A", "1")], location="us-central1", kms_key_name=REGIONAL_KEY)

    assert ok
    assert fake_sm.secret("A", location="us-central1")["customerManagedEncryption"] == {
        "kmsKeyName": REGIONAL_KEY
    }


def test_global_cmek_is_set_on_create_and_on_existing_secrets(fake_sm):
    fake_sm.seed("EXISTING", values=[b"1"], labels=OUR_LABELS)

    ok, _ = run([("NEW", "1"), ("EXISTING", "1")], kms_key_name=GLOBAL_KEY)

    assert ok
    expected = {"automatic": {"customerManagedEncryption": {"kmsKeyName": GLOBAL_KEY}}}
    assert fake_sm.secret("NEW")["replication"] == expected
    assert fake_sm.secret("EXISTING")["replication"] == expected

    fake_sm.calls.clear()
    run([("NEW", "1"), ("EXISTING", "1")], kms_key_name=GLOBAL_KEY)
    assert fake_sm.writes() == []


def test_user_managed_replication_keeps_its_keys_with_a_warning(fake_sm):
    replication = {"userManaged": {"replicas": [{"location": "us-east1"}]}}
    fake_sm.seed("A", values=[b"1"], labels=OUR_LABELS, replication=replication)

    ok, meta = run([("A", "1")], kms_key_name=GLOBAL_KEY)

    assert ok
    assert fake_sm.secret("A")["replication"] == replication
    assert "user-managed replication" in meta["message"]


def kms_denied():
    # Google's response when the Secret Manager service agent can't use the key.
    return error_response(
        400,
        "FAILED_PRECONDITION",
        f"Permission denied on Cloud KMS resource [{GLOBAL_KEY}] (or it does not "
        "exist). Please grant cloudkms.cryptoKeyVersions.useToDecrypt and "
        "cloudkms.cryptoKeyVersions.useToEncrypt permissions "
        "(roles/cloudkms.cryptoKeyEncrypterDecrypter) to the Secret Manager service "
        "identity.",
    )


def test_unusable_kms_key_stops_the_sync_and_names_the_service_agent(fake_sm):
    fake_sm.intercept("POST", ":addVersion", kms_denied())

    ok, meta = sync_gcp_secrets_individual(
        [("A", "1", ""), ("B", "2", "")],
        CREDENTIALS,
        "123456789012",
        "global",
        SYNC_ID,
        kms_key_name=GLOBAL_KEY,
    )

    assert not ok
    assert ("global", "B") not in fake_sm.secrets
    message = meta["message"]
    assert "--service=secretmanager.googleapis.com --project=123456789012" in message
    assert f"gcloud kms keys add-iam-policy-binding {GLOBAL_KEY}" in message
    assert (
        '--member="serviceAccount:service-123456789012@gcp-sa-secretmanager.iam.gserviceaccount.com"'
        in message
    )
    assert "--role=roles/cloudkms.cryptoKeyEncrypterDecrypter" in message


def test_kms_grant_looks_up_the_project_number_for_a_project_id(fake_sm):
    fake_sm.intercept("POST", ":addVersion", kms_denied())

    ok, meta = run_blob([("A", "1")], kms_key_name=GLOBAL_KEY)

    assert not ok
    assert (
        "service-$(gcloud projects describe my-project --format='value(projectNumber)')"
        "@gcp-sa-secretmanager.iam.gserviceaccount.com"
    ) in meta["message"]


def test_kms_errors_reading_a_secret_are_not_taken_for_a_disabled_version(fake_sm):
    fake_sm.seed("A", values=[b"1"], labels=OUR_LABELS)
    fake_sm.intercept("GET", r"versions/latest:access", kms_denied())

    ok, meta = run([("A", "1")], kms_key_name=GLOBAL_KEY)

    assert not ok
    assert fake_sm.payloads("A") == [b"1"]
    assert "gcp-sa-secretmanager" in meta["message"]


def test_a_secret_with_its_own_unusable_key_does_not_stop_the_others(fake_sm):
    fake_sm.intercept("POST", r"secrets/A:addVersion", kms_denied())

    ok, meta = run([("A", "1"), ("B", "2")])

    assert not ok
    assert fake_sm.payloads("B") == [b"2"]
    assert "A: Secret Manager can't use the Cloud KMS key." in meta["message"]


def test_versions_already_scheduled_for_destruction_are_not_destroyed_again(fake_sm):
    fake_sm.seed(
        "A",
        values=[b"1", b"2", b"3"],
        labels=OUR_LABELS,
        states=["DISABLED", "ENABLED", "ENABLED"],
        scheduled=(1,),
    )

    ok, _ = run([("A", "4")])

    assert ok
    assert fake_sm.states("A") == ["DISABLED", "DESTROYED", "ENABLED", "ENABLED"]
    destroyed = [c["url"] for c in fake_sm.calls if c["url"].endswith(":destroy")]
    assert [url.rsplit("/", 1)[-1] for url in destroyed] == ["2:destroy"]


def test_rate_limits_are_retried_with_backoff(fake_sm):
    fake_sm.intercept(
        "POST",
        ":addVersion",
        error_response(429, "RESOURCE_EXHAUSTED", "Quota exceeded"),
        times=2,
    )

    ok, _ = run([("A", "1")])

    assert ok
    assert fake_sm.payloads("A") == [b"1"]
    assert len(fake_sm.sleeps) == 2
    assert fake_sm.sleeps[0] < fake_sm.sleeps[1]


def test_retry_after_is_honoured(fake_sm):
    fake_sm.intercept(
        "GET",
        r"/secrets$",
        FakeResponse(503, None, headers={"Retry-After": "7"}),
    )

    ok, _ = run([("A", "1")])

    assert ok
    assert fake_sm.sleeps == [7.0]


def test_network_errors_are_retried(fake_sm, connection_error):
    fake_sm.intercept("GET", r"/secrets$", connection_error)

    ok, _ = run([("A", "1")])

    assert ok
    assert len(fake_sm.sleeps) == 1


def test_persistent_rate_limit_fails_with_advice(fake_sm):
    fake_sm.intercept(
        "GET", r"/secrets$", error_response(429, "RESOURCE_EXHAUSTED", "Quota exceeded"), times=10
    )

    ok, meta = run([("A", "1")])

    assert not ok
    assert len(fake_sm.sleeps) == secret_manager.MAX_ATTEMPTS - 1
    assert "rate-limiting" in meta["message"]


def test_expired_token_is_refreshed_once(fake_sm):
    fake_sm.intercept("GET", r"/secrets$", error_response(401, "UNAUTHENTICATED", "expired"))

    ok, _ = run([("A", "1")])

    assert ok
    assert FakeTokenSource.instances[-1].invalidations == 1


def test_disabled_api_reports_the_activation_link(fake_sm):
    url = "https://console.developers.google.com/apis/api/secretmanager.googleapis.com/overview?project=123"
    fake_sm.intercept(
        "GET",
        r"/secrets$",
        error_response(
            403,
            "PERMISSION_DENIED",
            "Secret Manager API has not been used in project 123 before or it is disabled.",
            details=[
                {
                    "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                    "reason": "SERVICE_DISABLED",
                    "metadata": {"activationUrl": url},
                }
            ],
        ),
    )

    ok, meta = run([("A", "1")])

    assert not ok
    assert url in meta["message"]


def test_permission_denied_stops_the_sync(fake_sm):
    fake_sm.intercept(
        "POST",
        ":addVersion",
        error_response(403, "PERMISSION_DENIED", "Permission 'secretmanager.versions.add' denied."),
    )

    ok, meta = run([("A", "1"), ("B", "2")])

    assert not ok
    assert "roles/secretmanager.editor" in meta["message"]
    assert ("global", "B") not in fake_sm.secrets


def test_partial_progress_is_reported_when_a_sync_stops(fake_sm):
    fake_sm.intercept(
        "POST",
        r"secrets/B:addVersion",
        error_response(403, "PERMISSION_DENIED", "denied"),
    )

    ok, meta = run([("A", "1"), ("B", "2")])

    assert not ok
    assert "Stopped part-way" in meta["message"]
    assert "1 created" in meta["message"]


def test_one_bad_secret_does_not_stop_the_others(fake_sm):
    fake_sm.intercept(
        "POST",
        r"secrets/A:addVersion",
        error_response(400, "INVALID_ARGUMENT", "bad payload"),
    )

    ok, meta = run([("A", "1"), ("B", "2")])

    assert not ok
    assert fake_sm.payloads("B") == [b"2"]
    assert "A: INVALID_ARGUMENT: bad payload" in meta["message"]

    # The empty secret left behind is filled in on the next sync.
    ok, _ = run([("A", "1"), ("B", "2")])
    assert ok
    assert fake_sm.payloads("A") == [b"1"]


def test_auth_failures_are_reported(fake_sm, monkeypatch):
    class FailingTokenSource(FakeTokenSource):
        def token(self):
            raise GCPAuthError("Google Cloud rejected Phase's Workload Identity token")

    monkeypatch.setattr(secret_manager, "TokenSource", FailingTokenSource)

    ok, meta = run([("A", "1")])

    assert not ok
    assert "rejected Phase's Workload Identity token" in meta["message"]


def test_a_secret_created_concurrently_is_adopted(fake_sm):
    def create_then_conflict():
        fake_sm.seed("A", values=[b"theirs"])
        return error_response(409, "ALREADY_EXISTS", "Secret [A] already exists.")

    fake_sm.intercept("POST", r"secretId|/secrets$", create_then_conflict)

    ok, _ = run([("A", "ours")])

    assert ok
    assert fake_sm.secret("A")["labels"] == OUR_LABELS
    assert fake_sm.payloads("A") == [b"theirs", b"ours"]


def test_listing_follows_pagination(fake_sm):
    fake_sm.page_size = 1
    run([("A", "1"), ("B", "2"), ("C", "3")])
    fake_sm.calls.clear()

    ok, meta = run([("A", "1"), ("B", "2")])

    assert ok
    assert "1 disabled" in meta["message"]
    assert fake_sm.states("C") == ["DISABLED"]


# ---- one JSON secret --------------------------------------------------------------


def test_blob_creates_one_sorted_json_secret(fake_sm):
    ok, meta = run_blob([("B", "2"), ("A", "1"), ("EMPTY", "")])

    assert ok, meta
    assert fake_sm.payloads("app-prod") == [b'{"A": "1", "B": "2", "EMPTY": ""}']
    assert fake_sm.secret("app-prod")["labels"] == OUR_LABELS
    assert "secret app-prod: 1 created" in meta["message"]


def test_blob_with_the_same_values_is_not_rewritten(fake_sm):
    fake_sm.seed("app-prod", values=[b'{"B":"2","A":"1"}'], labels=OUR_LABELS)

    ok, meta = run_blob([("A", "1"), ("B", "2")])

    assert ok
    assert fake_sm.writes() == []
    assert "1 unchanged" in meta["message"]


def test_blob_changes_keep_two_versions(fake_sm):
    for value in ("1", "2", "3"):
        ok, _ = run_blob([("A", value)])
        assert ok

    assert fake_sm.states("app-prod") == ["DESTROYED", "ENABLED", "ENABLED"]
    assert json.loads(fake_sm.payloads("app-prod")[-1]) == {"A": "3"}


def test_blob_over_64_kib_fails_before_any_request(fake_sm):
    ok, meta = run_blob([("BIG", "x" * (64 * 1024))])

    assert not ok
    assert fake_sm.calls == []
    assert "64 KiB" in meta["message"]


def test_blob_owned_by_another_sync_is_left_alone(fake_sm):
    fake_sm.seed("app-prod", values=[b"{}"], labels={"managed_by": "phase", "phase_sync": "other"})

    ok, meta = run_blob([("A", "1")])

    assert not ok
    assert fake_sm.payloads("app-prod") == [b"{}"]
    assert "managed by a different Phase sync" in meta["message"]


def test_blob_rejects_an_invalid_secret_name(fake_sm):
    ok, meta = run_blob([("A", "1")], secret_name="app.prod")

    assert not ok
    assert fake_sm.calls == []
    assert "Secret names may only contain" in meta["message"]


# ---- listing for the setup picker ------------------------------------------------


def test_list_marks_secrets_managed_by_phase(fake_sm):
    fake_sm.page_size = 1
    fake_sm.seed("MINE", labels=OUR_LABELS)
    fake_sm.seed("THEIRS")

    secrets = list_gcp_secrets(CREDENTIALS, "my-project", "global")

    assert secrets == [
        {"name": "MINE", "managed_by_phase": True},
        {"name": "THEIRS", "managed_by_phase": False},
    ]


def test_list_rejects_a_location_that_would_change_the_host(fake_sm):
    with pytest.raises(ValueError):
        list_gcp_secrets(CREDENTIALS, "my-project", "evil.example")
    assert fake_sm.calls == []


# ---- review fixes -------------------------------------------------------------------


def test_an_interrupted_disable_is_finished_on_the_next_run(fake_sm):
    fake_sm.seed("A", values=[b"1", b"2"], labels=OUR_LABELS)
    fake_sm.intercept(
        "POST", r"versions/2:disable", error_response(400, "INVALID_ARGUMENT", "blip")
    )

    ok, _ = run([])
    assert not ok
    # Oldest first, so the newest version is still live and the secret isn't
    # marked as removed.
    assert fake_sm.states("A") == ["DISABLED", "ENABLED"]
    assert "phase_removed" not in fake_sm.secret("A")["labels"]

    ok, _ = run([])
    assert ok
    assert fake_sm.states("A") == ["DISABLED", "DISABLED"]


def test_older_versions_are_disabled_even_when_the_newest_already_is(fake_sm):
    fake_sm.seed("A", values=[b"1", b"2"], labels=OUR_LABELS, states=["ENABLED", "DISABLED"])

    ok, _ = run([])

    assert ok
    assert fake_sm.states("A") == ["DISABLED", "DISABLED"]


def test_a_duplicate_write_does_not_destroy_the_real_previous_value(fake_sm, connection_error):
    fake_sm.seed("A", values=[b"1", b"2"], labels=OUR_LABELS)

    def commit_then_time_out():
        fake_sm._append_version("global", "A", b"3")
        return connection_error

    fake_sm.intercept("POST", r"secrets/A:addVersion", commit_then_time_out)

    ok, _ = run([("A", "3")])

    assert ok
    # The retry wrote a second "3"; the duplicate goes, the real previous
    # value ("2") stays.
    assert fake_sm.states("A") == ["DESTROYED", "ENABLED", "DESTROYED", "ENABLED"]
    assert fake_sm.payloads("A")[1] == b"2"


def test_versions_another_run_already_destroyed_are_ignored(fake_sm):
    fake_sm.seed("A", values=[b"1", b"2"], labels=OUR_LABELS)
    fake_sm.intercept(
        "POST",
        r"versions/1:destroy",
        error_response(400, "FAILED_PRECONDITION", "SecretVersion.state is already DESTROYED."),
    )

    ok, meta = run([("A", "3")])

    assert ok
    assert "Warnings" not in meta["message"]


def test_secrets_of_a_deleted_sync_are_taken_over(fake_sm):
    fake_sm.seed("A", values=[b"old"], labels={"managed_by": "phase", "phase_sync": "deleted"})
    fake_sm.seed("B", values=[b"b"], labels={"managed_by": "phase", "phase_sync": "live"})
    checked = []

    def owner_is_active(sync_id):
        checked.append(sync_id)
        return sync_id == "live"

    ok, meta = run([("A", "new"), ("B", "b2")], owner_is_active=owner_is_active)

    assert not ok
    assert fake_sm.secret("A")["labels"]["phase_sync"] == SYNC_ID
    assert fake_sm.payloads("A") == [b"old", b"new"]
    assert fake_sm.payloads("B") == [b"b"]
    assert "B: managed by a different Phase sync" in meta["message"]
    assert sorted(checked) == ["deleted", "live"]


def test_warnings_are_capped_like_errors(fake_sm):
    replication = {"userManaged": {"replicas": [{"location": "us-east1"}]}}
    keys = [f"K{i:02d}" for i in range(12)]
    for key in keys:
        fake_sm.seed(key, values=[b"1"], labels=OUR_LABELS, replication=replication)

    ok, meta = run([(key, "1") for key in keys], kms_key_name=GLOBAL_KEY)

    assert ok
    assert meta["message"].count("user-managed replication") == 10
    assert "- and 2 more" in meta["message"]
