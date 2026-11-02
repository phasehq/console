import os
from urllib.parse import urlparse

GITHUB_CLOUD_URLS = ("https://github.com", "https://api.github.com")


def ghes_host_url():
    """The configured GitHub Enterprise Server URL (scheme://host[:port]), or None."""
    parsed = urlparse(os.getenv("GITHUB_ENTERPRISE_INTEGRATION_HOST_URL", "").strip())
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _is_on_origin(url, origin):
    # The origin must end at "/" or the string's end, so no parser reads another host.
    head, rest = url[: len(origin)], url[len(origin) :]
    return head.lower() == origin.lower() and rest[:1] in ("", "/")


def github_url_is_allowed(url, ghes_url):
    """True if url is on github.com or the configured GHES host."""
    origins = (*GITHUB_CLOUD_URLS, ghes_url)
    return any(_is_on_origin(url, origin) for origin in origins if origin)
