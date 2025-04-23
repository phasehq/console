# ip_utils.py
from ipaddress import ip_address, ip_network


def ip_in_range(ip: str, cidr: str) -> bool:
    try:
        return ip_address(ip) in ip_network(cidr, strict=False)
    except ValueError:
        return False


def is_ip_allowed(ip: str, policies) -> bool:
    for policy in policies:
        for cidr in policy.get_ip_list():
            if ip_in_range(ip, cidr):
                return True
    return False
