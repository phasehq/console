"""What the packaged manifests say about variables."""

from api.utils.agent_config import REGISTRY


# GitHub Enterprise Server


def test_github_binds_every_variable_its_cli_reads_a_token_from():
    github = REGISTRY.get_service("github")
    bound = {binding["name"]: binding for binding in github["environment_bindings"]}

    # gh reads the Enterprise names for any host other than github.com.
    assert set(bound) == {
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "GITHUB_ENTERPRISE_TOKEN",
    }
    assert set(bound) == set(github["credential_environment"])
    for name, binding in bound.items():
        assert (
            binding["action"],
            binding["source"],
            binding["source_field"],
            binding["sensitive"],
        ) == ("set", "decoy", "token", True), name
        assert name in github["context_template"]

