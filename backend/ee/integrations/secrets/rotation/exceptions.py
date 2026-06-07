class RotationProviderError(Exception):
    retryable: bool = False

    def __init__(self, message: str, *, user_message: str | None = None, raw=None):
        super().__init__(message)
        self.user_message = user_message or message
        self.raw = raw


class RotationProviderTransientError(RotationProviderError):
    retryable = True


class RotationProviderAuthError(RotationProviderError):
    retryable = False


class RotationProviderConfigError(RotationProviderError):
    retryable = False


class RotationProviderQuotaError(RotationProviderError):
    retryable = False


class RotationProviderNotFound(RotationProviderError):
    """404 from provider; treated as idempotent success during revoke."""

    retryable = False


class ProviderNotRegisteredError(Exception):
    pass
