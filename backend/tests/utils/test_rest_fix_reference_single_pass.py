"""A secret's references are read from its own text, once.

What a reference resolves to is put in place and never read again, so text that
only looks like a reference once it has been substituted stays text.
"""

import random

import pytest

from api.models import Secret
from api.utils import secrets as resolver
from api.utils.agent_app_access import AgentSecretsReader
from api.utils.secrets import (
    CROSS_APP_ENV_PATTERN,
    CROSS_ENV_PATTERN,
    LOCAL_REF_PATTERN,
    MAX_REFERENCE_DEPTH,
    SecretReferenceException,
    decrypt_secret_value,
)
from tests.api.agents.app_secrets import (
    SERVER_KEYPAIR,
    app_connection,
    grant_app,
    lab,  # noqa: F401
    put_secret,
    secrets_url,
    sse_app,
    token_client,
)


ALLOW_ALL = {"version": 1, "default": "allow", "rules": []}
NO_PERMISSION = (
    "This Agent doesn't have permission to read secrets in one or more "
    "referenced environments."
)


@pytest.fixture
def world(lab, monkeypatch):
    """Development, Staging and Production of one app, and another app, each
    with a secret of its own."""

    monkeypatch.setattr(
        "api.utils.syncing.secrets.get_server_keypair", lambda: SERVER_KEYPAIR
    )
    lab.billing, [lab.billing_prod] = sse_app(lab, name="billing", environments=["Production"])
    put_secret(lab.dev, "LOCAL", "local-value")
    put_secret(lab.staging, "SHARED", "staging-value")
    put_secret(lab.prod, "SHARED", "prod-value")
    put_secret(lab.billing_prod, "TOKEN", "billing-value")
    return lab


def _resolved(environment, value, **options):
    """What a value written to a new secret of the environment resolves to."""

    secret = put_secret(environment, f"SUBJECT_{Secret.objects.count()}", value)
    return decrypt_secret_value(Secret.objects.get(pk=secret.pk), **options)


def _synced(environment, path="/"):
    from api.utils.syncing.secrets import get_environment_secrets

    return {key: value for key, value, _ in get_environment_secrets(environment, path)}


# --- Text that only becomes a reference by substitution -------------------------


@pytest.mark.django_db
def test_three_writes_no_longer_carry_a_secret_out_of_the_agents_reach(world):
    grant_app(world, app_connection(world, [world.dev], policy=ALLOW_ALL))
    client = token_client(world)
    url = secrets_url(world.app, "Development")

    # None of these holds a reference to Production as it is written.
    for key, value in (
        ("O", "$"),
        ("T", "${O}{Production.SHARED}"),
        ("U", "${orders-service::Development.T}"),
    ):
        response = client.post(
            url, {"secrets": [{"key": key, "value": value}]}, format="json"
        )
        assert response.status_code == 200, response.content

    synced = _synced(world.dev)
    assert synced["T"] == "${Production.SHARED}"
    assert synced["U"] == "${Production.SHARED}"
    assert "prod-value" not in "".join(synced.values())
    read = {item["key"]: item["value"] for item in client.get(url).json()}
    assert read["U"] == "${Production.SHARED}"


ASSEMBLED = {
    "a cross-app result read as a cross-environment reference": (
        [("dev", "O", "$"), ("dev", "T", "${O}{Production.SHARED}")],
        "${orders-service::Development.T}",
        "${Production.SHARED}",
    ),
    "a cross-environment result read as a local reference": (
        [("staging", "O", "$"), ("staging", "T", "${O}{LOCAL}")],
        "${Staging.T}",
        "${LOCAL}",
    ),
    "a result that closes a reference the value opened": (
        [("staging", "END", "ARED}")],
        "${Production.SH${orders-service::Staging.END}",
        "${Production.SHARED}",
    ),
    "a result that opens a reference the value closes": (
        [("staging", "OPEN", "${")],
        "${orders-service::Staging.OPEN}Production.SHARED}",
        "${Production.SHARED}",
    ),
    "a result that repeats a reference the value also holds": (
        [("dev", "O", "$"), ("dev", "T", "${O}{LOCAL}")],
        "${T} ${LOCAL}",
        "${LOCAL} local-value",
    ),
}


@pytest.mark.django_db
@pytest.mark.parametrize("stored,value,expected", ASSEMBLED.values(), ids=ASSEMBLED)
def test_what_a_reference_resolves_to_is_not_read_again(world, stored, value, expected):
    for environment, key, text in stored:
        put_secret(getattr(world, environment), key, text)

    assert _resolved(world.dev, value) == expected
    # A sync resolves the same way, and has nothing left to refuse.
    assert _resolved(world.dev, value, require_resolved_references=True) == expected


@pytest.mark.django_db
def test_resolved_text_that_holds_a_reference_shape_comes_out_untouched(world):
    # A template another environment keeps as text; NAME exists only here.
    put_secret(world.staging, "TEMPLATE", "hello ${NAME} at ${Nowhere.HOST}")
    put_secret(world.dev, "NAME", "dev-name")

    assert _resolved(world.dev, "${Staging.TEMPLATE}!") == (
        "hello ${NAME} at ${Nowhere.HOST}!"
    )


# --- What still resolves ---------------------------------------------------------


@pytest.mark.django_db
def test_a_chain_resolves_each_secret_where_it_lives(world):
    put_secret(world.staging, "VIA", "${DEEPER}/${Production.SHARED}")
    put_secret(world.staging, "DEEPER", "${SHARED}+${billing::Production.TOKEN}")

    assert _resolved(world.dev, "${Staging.VIA}", require_resolved_references=True) == (
        "staging-value+billing-value/prod-value"
    )


@pytest.mark.django_db
def test_every_form_resolves_in_one_value_and_other_text_is_left_alone(world):
    put_secret(world.dev, "DEEP", "deep-value", path="/folder")
    put_secret(world.staging, "DEEP", "staging-deep", path="/folder")
    value = (
        "a=${LOCAL} b=${Staging.SHARED} c=${billing::Production.TOKEN} "
        "d=${/folder/DEEP} e=${staging./folder/DEEP} f=${ORDERS-SERVICE::production.SHARED} "
        "g=${{ RAILWAY }} h=$LOCAL i={LOCAL} j=${} k=${.x} l=${a::b.} ${LOCAL}"
    )

    assert _resolved(world.dev, value, require_resolved_references=True) == (
        "a=local-value b=staging-value c=billing-value "
        "d=deep-value e=staging-deep f=prod-value "
        "g=${{ RAILWAY }} h=$LOCAL i={LOCAL} j=${} k=${.x} l=${a::b.} local-value"
    )


@pytest.mark.django_db
def test_a_reference_that_occurs_twice_is_resolved_once(world, monkeypatch):
    calls = []
    real = resolver.resolve_secret_value

    def counted(environment, path, key_name, **options):
        calls.append((environment.name, path, key_name))
        return real(environment, path, key_name, **options)

    monkeypatch.setattr(resolver, "resolve_secret_value", counted)

    assert _resolved(
        world.dev, "${LOCAL} ${Staging.SHARED} ${LOCAL} ${Staging.SHARED} ${LOCAL}"
    ) == "local-value staging-value local-value staging-value local-value"
    assert sorted(calls) == [("Development", "/", "LOCAL"), ("Staging", "/", "SHARED")]


# --- What does not resolve --------------------------------------------------------


@pytest.mark.django_db
def test_an_unresolvable_reference_is_left_as_written(world):
    value = (
        "${MISSING} ${Nowhere.KEY} ${ghost::Production.X} ${Staging.MISSING} "
        "${billing::Nowhere.X} ok=${LOCAL}"
    )

    assert _resolved(world.dev, value) == value.replace("${LOCAL}", "local-value")


@pytest.mark.django_db
def test_a_sync_is_told_what_did_not_resolve_cross_references_first(world):
    with pytest.raises(SecretReferenceException) as cross:
        _resolved(
            world.dev,
            "${MISSING} ${Nowhere.KEY} ${ghost::Production.X} ${Staging.MISSING} "
            "${Nowhere.KEY}",
            require_resolved_references=True,
        )
    with pytest.raises(SecretReferenceException) as local:
        _resolved(
            world.dev, "${MISSING} ${LOCAL} ${/folder/GONE}", require_resolved_references=True
        )

    # Cross-app, then cross-environment in the order written, once for each
    # time a reference occurs. Local ones are reported only when those resolve.
    assert str(cross.value).split("\n") == [
        "The referenced app 'ghost' does not exist",
        "The referenced environment 'Nowhere' does not exist",
        "The referenced secret does not exist in 'Staging' at the requested path",
        "The referenced environment 'Nowhere' does not exist",
    ]
    assert str(local.value).split("\n") == [
        "The referenced key MISSING does not exist in the Development environment.",
        "The referenced key /folder/GONE does not exist in the Development environment.",
    ]


@pytest.mark.django_db
def test_a_cycle_ends_and_a_sync_refuses_it(world):
    put_secret(world.dev, "A", "${B}")
    put_secret(world.dev, "B", "${Staging.C}")
    put_secret(world.staging, "C", "${Development.A}")

    # Each secret on the cycle comes back as the reference that closes it.
    assert _resolved(world.dev, "x-${A}") == "x-${Development.A}"
    with pytest.raises(SecretReferenceException):
        _resolved(world.dev, "x-${A}", require_resolved_references=True)
    with pytest.raises(SecretReferenceException, match="Circular or too-deeply-nested"):
        secret = Secret.objects.get(environment=world.dev, path="/", key_digest=_digest(world.dev, "A"))
        decrypt_secret_value(
            secret, _visited={(str(world.dev.id), "/", secret.key_digest)}
        )


def _digest(environment, key):
    from api.utils.secrets import compute_key_digest

    return compute_key_digest(key, environment.id)


def _chain(environment, length):
    """LINK_0 refers to LINK_1 and so on; the last holds plain text."""

    for index in range(length - 1):
        put_secret(environment, f"LINK_{index}", f"${{LINK_{index + 1}}}")
    put_secret(environment, f"LINK_{length - 1}", "the-end")
    return Secret.objects.get(
        environment=environment, path="/", key_digest=_digest(environment, "LINK_0")
    )


@pytest.mark.django_db
def test_a_chain_as_deep_as_the_limit_resolves_and_a_deeper_one_does_not(world):
    assert decrypt_secret_value(
        _chain(world.dev, MAX_REFERENCE_DEPTH), require_resolved_references=True
    ) == "the-end"

    too_deep = _chain(world.staging, MAX_REFERENCE_DEPTH + 1)

    with pytest.raises(SecretReferenceException):
        decrypt_secret_value(too_deep, require_resolved_references=True)
    # Without the demand to resolve, it stops at the link past the limit.
    assert decrypt_secret_value(too_deep) == f"${{LINK_{MAX_REFERENCE_DEPTH}}}"


# --- An account that may not read a referenced environment -------------------------


@pytest.fixture
def reader(world):
    """An Agent Workflow that reads Development and Staging only."""

    grant_app(world, app_connection(world, [world.dev, world.staging]))
    return lambda: AgentSecretsReader(world.workflow)


@pytest.mark.django_db
def test_resolving_stops_at_the_first_environment_the_account_cannot_read(world, reader):
    put_secret(world.staging, "OTHER", "other-value")
    value = (
        "a=${Staging.SHARED} b=${Production.SHARED} c=${Staging.OTHER} "
        "d=${LOCAL} e=${Staging.SHARED}"
    )

    # Up to that reference it is resolved; from it on, as written.
    assert _resolved(world.dev, value, account=reader()) == (
        "a=staging-value b=${Production.SHARED} c=${Staging.OTHER} "
        "d=${LOCAL} e=staging-value"
    )
    with pytest.raises(SecretReferenceException) as refused:
        _resolved(world.dev, value, account=reader(), require_resolved_references=True)
    assert str(refused.value) == NO_PERMISSION


@pytest.mark.django_db
def test_cross_app_references_are_checked_before_any_other(world, reader):
    value = "a=${Staging.SHARED} b=${billing::Production.TOKEN} c=${LOCAL}"

    assert _resolved(world.dev, value, account=reader()) == value


@pytest.mark.django_db
def test_an_account_is_checked_at_every_step_of_a_chain(world, reader):
    put_secret(world.staging, "VIA", "via-${Production.SHARED}")

    # The step it may not take is left as written inside what it may read.
    assert _resolved(world.dev, "${Staging.VIA}", account=reader()) == (
        "via-${Production.SHARED}"
    )


# --- The three patterns and the one scan agree -------------------------------------


def _by_patterns(value):
    return (
        CROSS_APP_ENV_PATTERN.findall(value),
        CROSS_ENV_PATTERN.findall(value),
        LOCAL_REF_PATTERN.findall(value),
    )


def _by_scan(value):
    found = {"app": [], "env": [], "local": []}
    for body in resolver._REFERENCE_BODY_PATTERN.findall(value):
        reference = resolver._classify_reference(body)
        if reference is not None:
            names = reference[1:]
            found[reference[0]].append(names if len(names) > 1 else names[0])
    return found["app"], found["env"], found["local"]


def test_the_scan_reads_names_and_keys_as_the_patterns_do_on_known_shapes():
    for value in [
        "",
        "plain",
        "${KEY}",
        "${/folder/KEY}",
        "${prod.KEY}",
        "${prod./folder/KEY}",
        "${prod.KEY.with.dots}",
        "${app::prod.KEY}",
        "${my.app::prod.folder/KEY.x}",
        "a ${one} b ${dev.TWO} c ${other::prod.THREE.x} ${one}",
        "${{KEY}}",
        "${.KEY}",
        "${env.}",
        "${::env.KEY}",
        "${app::.KEY}",
        "${app::env.}",
        "${a::b::c.d}",
        "${a.b::c.d}",
        "${a::b}",
        "${a::b.c.d::e}",
        "${a:::b.c}",
        "${a::..b}",
        "${",
        "${}",
        "${a.b",
        "${a${b.c}",
        "$${a}",
    ]:
        assert _by_scan(value) == _by_patterns(value), value


def test_the_scan_reads_names_and_keys_as_the_patterns_do_on_random_values():
    rng = random.Random(11)
    alphabet = ["$", "{", "}", ".", ":", "::", "a", "B", "/", " ", "${", "_"]
    for _ in range(20000):
        value = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 24)))
        assert _by_scan(value) == _by_patterns(value), value
