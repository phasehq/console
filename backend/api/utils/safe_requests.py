"""`requests` for hosts a customer supplies, e.g. a self-hosted GitHub, Vault or Nomad."""

from urllib.parse import urlsplit

import requests
from django.conf import settings
from django.core.exceptions import ValidationError
from urllib3.util import parse_url

from api.utils.network import validate_url_is_safe


class UnsafeURLError(requests.RequestException):
    """A request, or a redirect it followed, targeted a restricted address."""


def _check_url(url):
    try:
        # requests must connect to the host that validate_url_is_safe checks
        if (urlsplit(url).hostname or "") != (parse_url(url).host or "").strip("[]"):
            raise ValidationError("Invalid URL")
        validate_url_is_safe(url)
    except ValidationError as e:
        raise UnsafeURLError(f"Request blocked: {'; '.join(e.messages)}") from None
    except ValueError:
        raise UnsafeURLError("Request blocked: Invalid URL") from None


class SafeSession(requests.Session):
    """On Phase Cloud every request is checked with validate_url_is_safe, redirects
    included, so a redirect can't reach an address the first check would refuse."""

    def send(self, request, **kwargs):
        if settings.APP_HOST == "cloud":
            _check_url(request.url)
        return super().send(request, **kwargs)


def request(method, url, **kwargs):
    with SafeSession() as session:
        return session.request(method, url, **kwargs)


def get(url, **kwargs):
    return request("GET", url, **kwargs)


def put(url, **kwargs):
    return request("PUT", url, **kwargs)


def delete(url, **kwargs):
    return request("DELETE", url, **kwargs)
