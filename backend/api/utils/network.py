import socket
import ipaddress
from urllib.parse import urlparse
from django.core.exceptions import ValidationError


BLOCKED_NETWORKS = [
    ipaddress.ip_network("100.64.0.0/10"), # Carrier Grade NAT (used by Tailscale, Alibaba Cloud metadata)
    ipaddress.ip_network("192.0.0.0/24"), # IETF Protocol Assignments
    ipaddress.ip_network("198.18.0.0/15"), # Network Benchmark
    ipaddress.ip_network("169.254.0.0/16"),  # Link-Local / Cloud Metadata
    ipaddress.ip_network("127.0.0.0/8"),     # Loopback
    ipaddress.ip_network("0.0.0.0/8"),       # Current network
    ipaddress.ip_network("240.0.0.0/4"),     # Reserved
    ipaddress.ip_network("::1/128"),         # IPv6 Loopback
    ipaddress.ip_network("fe80::/10"),       # IPv6 Link-Local
    ipaddress.ip_network("fc00::/7"),        # IPv6 Unique Local Address
]

def is_ip_private(ip_str):
    try:
        ip = ipaddress.ip_address(ip_str)
        
        # Check standard private properties
        if (
            ip.is_private 
            or ip.is_loopback 
            or ip.is_link_local 
            or ip.is_multicast 
            or ip.is_reserved
        ):
            return True
            
        # Check against additional blocked networks
        for network in BLOCKED_NETWORKS:
            if ip in network:
                return True
                
        return False
    except ValueError:
        return False

def validate_url_is_safe(url):
    """
    Validates that a URL does not point to a private/internal IP address.
    """
    if not url:
        return
    
    # Add scheme if missing to allow urlparse to work correctly
    if "://" not in url:
        parse_url = f"https://{url}"
    else:
        parse_url = url
        
    try:
        parsed = urlparse(parse_url)
        hostname = parsed.hostname
        if not hostname:
             # If no hostname (e.g. just a string), treat it as hostname
             hostname = url.split(":")[0].split("/")[0]

        # Resolve hostname
        try:
            ip_list = socket.gethostbyname_ex(hostname)[2]
        except socket.gaierror:
             raise ValidationError(f"Could not resolve hostname: {hostname}")
             
        for ip in ip_list:
            if is_ip_private(ip):
                 raise ValidationError(f"URL resolves to a restricted IP address: {ip}")
                 
    except Exception as e:
        if isinstance(e, ValidationError):
            raise
        # Log the error if needed, but for now just raise validation error
        raise ValidationError(f"Invalid URL or hostname: {str(e)}")

