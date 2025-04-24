# ip_utils.py
from ipaddress import ip_address, ip_network


def ip_in_range(ip: str, cidr: str) -> bool:
    try:
        return ip_address(ip) in ip_network(cidr, strict=False)
    except ValueError:
        return False


def is_ip_allowed(ip, policies):
    client_ip = ip_address(ip)

    for policy in policies:
        for allowed in policy.get_ip_list():
            try:
                if "/" in allowed:
                    if client_ip in ip_network(allowed, strict=False):
                        return True
                elif client_ip == ip_address(allowed):
                    return True
            except ValueError:
                continue  # skip invalid IPs

    return False
