from ipaddress import ip_address


def _validate_ip(raw_ip):
    """Validate and return a cleaned IP string, or None if invalid."""
    raw_ip = (raw_ip or "").strip()
    if not raw_ip:
        return None
    try:
        ip_address(raw_ip)
        return raw_ip
    except ValueError:
        return None


def get_client_ip(request):
    """
    Get the client IP address as a single string.

    Checks headers in order: X-Real-IP, X-Forwarded-For (first IP), REMOTE_ADDR.

    Args:
        request: Django request object

    Returns:
        str | None: The client IP address (IPv4 or IPv6)
    """
    # Prefer X-Real-IP (set by nginx)
    ip = _validate_ip(request.META.get("HTTP_X_REAL_IP"))
    if ip:
        return ip

    # Fall back to X-Forwarded-For (first entry is the original client)
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if x_forwarded_for:
        first_ip = x_forwarded_for.split(",")[0]
        ip = _validate_ip(first_ip)
        if ip:
            return ip

    # Fall back to REMOTE_ADDR (always set by WSGI)
    return _validate_ip(request.META.get("REMOTE_ADDR"))
