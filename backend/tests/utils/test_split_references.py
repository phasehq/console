import random
import time

from api.utils.secrets import (
    CROSS_APP_ENV_PATTERN,
    CROSS_ENV_PATTERN,
    LOCAL_REF_PATTERN,
    split_references,
)


def _by_pattern(value):
    return (
        [(app, env) for app, env, _ in CROSS_APP_ENV_PATTERN.findall(value)],
        [env for env, _ in CROSS_ENV_PATTERN.findall(value)],
        bool(LOCAL_REF_PATTERN.search(value)),
    )


def test_matches_the_resolver_patterns_on_known_shapes():
    for value in [
        "",
        "plain",
        "${KEY}",
        "${prod.KEY}",
        "${app::prod.KEY}",
        "a ${one} b ${dev.TWO} c ${other::prod.THREE.x}",
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
    ]:
        assert split_references(value) == _by_pattern(value), value


def test_matches_the_resolver_patterns_on_random_values():
    rng = random.Random(7)
    alphabet = ["$", "{", "}", ".", ":", "::", "a", "B", " ", "${", "_"]
    for _ in range(20000):
        value = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 24)))
        assert split_references(value) == _by_pattern(value), value


def test_stays_fast_on_values_built_to_backtrack():
    for value in ["${" * 200000, "${" + "a::" * 200000, "${" + "a" * 400000]:
        started = time.perf_counter()
        split_references(value)
        assert time.perf_counter() - started < 2
