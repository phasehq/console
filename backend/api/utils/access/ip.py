from ipaddress import ip_address


def get_client_ip(request):
    """
    Get the client IP address as a single string.

    Args:
        request: Django request object

    Returns:
        str | None: The client IP address (IPv4 or IPv6)
    """
    raw_ip = (request.META.get("HTTP_X_REAL_IP") or request.META.get("X_REAL_IP") or "").split(",")[0].strip()
    if not raw_ip:
        return None
    try:
        ip_address(raw_ip)
    except ValueError:
        return None
    return raw_ip
