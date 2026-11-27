from unittest.mock import patch


class TestAppSecretsLink:
    """Email links into an app's secrets grid, narrowed to one environment."""

    def test_links_to_the_env_at_the_root(self):
        from api.emails import _app_secrets_link

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://app.phase.dev"}):
            link = _app_secrets_link("acme", "app-1", "env-1")

        assert link == "https://app.phase.dev/acme/apps/app-1?envs=env-1"

    def test_opens_the_folder(self):
        from api.emails import _app_secrets_link

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://app.phase.dev"}):
            link = _app_secrets_link("acme", "app-1", "env-1", "/backend/api")

        assert link == "https://app.phase.dev/acme/apps/app-1/backend/api?envs=env-1"

    def test_uses_the_first_allowed_origin(self):
        from api.emails import _app_secrets_link

        with patch.dict(
            "os.environ", {"ALLOWED_ORIGINS": "https://a.example.com,http://localhost"}
        ):
            link = _app_secrets_link("acme", "app-1", "env-1", "/")

        assert link == "https://a.example.com/acme/apps/app-1?envs=env-1"

    def test_a_folder_named_like_an_app_page_goes_behind_a_tilde(self):
        from api.emails import _app_secrets_link

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://app.phase.dev"}):
            link = _app_secrets_link("acme", "app-1", "env-1", "/Settings/smtp")
            nested = _app_secrets_link("acme", "app-1", "env-1", "/backend/settings")

        assert link == "https://app.phase.dev/acme/apps/app-1/~/Settings/smtp?envs=env-1"
        assert nested == "https://app.phase.dev/acme/apps/app-1/backend/settings?envs=env-1"

    def test_a_root_folder_named_tilde_is_escaped_too(self):
        from api.emails import _app_secrets_link

        with patch.dict("os.environ", {"ALLOWED_ORIGINS": "https://app.phase.dev"}):
            link = _app_secrets_link("acme", "app-1", "env-1", "/~/keys")

        assert link == "https://app.phase.dev/acme/apps/app-1/~/~/keys?envs=env-1"
