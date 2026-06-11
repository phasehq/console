class ProviderError(Exception):
    retryable: bool = False

    def __init__(self, message: str, *, user_message: str | None = None, raw=None):
        super().__init__(message)
        self.user_message = user_message or message
        self.raw = raw


class ProviderTransientError(ProviderError):
    retryable = True


class ProviderAuthError(ProviderError):
    retryable = False


class ProviderConfigError(ProviderError):
    retryable = False


class ProviderQuotaError(ProviderError):
    retryable = False


class ProviderNotFound(ProviderError):
    """404 from provider; treated as idempotent success during revoke."""

    retryable = False


class ProviderNotRegisteredError(Exception):
    pass
