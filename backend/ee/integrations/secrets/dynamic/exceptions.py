class DynamicSecretError(Exception):
    """Base exception for dynamic secret operations"""

    pass


class PlanRestrictionError(DynamicSecretError):
    """Raised when operation is restricted by organization plan"""

    pass


class LeaseRenewalError(DynamicSecretError):
    """Raised when lease renewal fails due to business logic constraints"""

    pass


class LeaseExpiredError(DynamicSecretError):
    """Raised when attempting to renew an expired lease"""

    pass


class TTLExceededError(DynamicSecretError):
    """Raised when TTL exceeds maximum allowed values"""

    pass


class LeaseAlreadyRevokedError(DynamicSecretError):
    """Raised when attempting to operate on an already revoked lease"""

    pass
