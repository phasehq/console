def get_client_ip(request):
    """
    Get the client IP address as a single string.

    Args:
        request: Django request object

    Returns:
        str | None: The client IP address (IPv4 or IPv6)
    """
    print("IP -->", request.META.get("REMOTE_ADDR"))
    return request.META.get("REMOTE_ADDR")
