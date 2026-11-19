"""What the packaged manifests and presets say about variables and classes."""

from api.utils.agent_config import REGISTRY
from api.utils.agent_config.access_policy import classify_http_call
from api.utils.agent_config.presets import PRESETS


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


# Slack


def test_slack_allocating_an_upload_url_is_a_write():
    classes = PRESETS["slack"]["definition"]["operationClasses"]

    def classed(method, path):
        return classify_http_call(classes, method, path)

    assert classed("POST", "/api/files.getUploadURLExternal") == "create"
    assert classed("GET", "/api/files.getUploadURLExternal") == "create"
    assert classed("POST", "/api/files.completeUploadExternal") == "update"
    # Other "get" methods still read.
    assert classed("POST", "/api/users.getPresence") == "read"
    assert classed("GET", "/api/team.getProfile") == "read"
