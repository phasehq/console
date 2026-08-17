"""Typed errors raised by log stream adapters.

The engine maps each class to a distinct delivery behaviour:

- AdapterAuthError        -> pause the stream (retrying is pointless)
- AdapterRateLimitedError -> sleep (Retry-After if given) and retry
- AdapterTransientError   -> exponential backoff and retry
- AdapterPermanentError   -> fail the chunk immediately, no retry
"""


class AdapterError(Exception):
    def __init__(self, message, *, user_message=None, status_code=None):
        super().__init__(message)
        self.user_message = user_message or message
        self.status_code = status_code


class AdapterAuthError(AdapterError):
    """The destination rejected our credentials (401/403)."""


class AdapterRateLimitedError(AdapterError):
    """The destination is throttling us (408/429)."""

    def __init__(self, message, *, retry_after=None, **kwargs):
        super().__init__(message, **kwargs)
        self.retry_after = retry_after


class AdapterTransientError(AdapterError):
    """A retryable failure: 5xx, timeout, connection error."""


class AdapterPermanentError(AdapterError):
    """A non-retryable failure: malformed payload, unknown site, 400/413."""
