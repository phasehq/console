from allauth.socialaccount.providers.github.provider import GitHubProvider


class GitHubEnterpriseProvider(GitHubProvider):
    id = "github-enterprise"
    name = "GitHub Enterprise"
