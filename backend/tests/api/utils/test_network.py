from unittest.mock import patch
import socket
import unittest
from django.core.exceptions import ValidationError
from api.utils.network import validate_url_is_safe

class TestNetworkUtils(unittest.TestCase):
    
    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_public_ip(self, mock_gethostbyname):
        # Mock resolving "google.com" to a public IP
        mock_gethostbyname.return_value = ('google.com', [], ['8.8.8.8'])
        
        # Should not raise exception
        validate_url_is_safe("https://google.com")
        validate_url_is_safe("google.com") 

    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_private_ip_rfc1918(self, mock_gethostbyname):
        # Mock resolving "internal.corp" to a private IP (10.0.0.1)
        mock_gethostbyname.return_value = ('internal.corp', [], ['10.0.0.1'])
        
        with self.assertRaises(ValidationError) as cm:
            validate_url_is_safe("https://internal.corp")
        self.assertIn("restricted IP address", str(cm.exception))

    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_localhost(self, mock_gethostbyname):
        # Mock resolving "localhost"
        mock_gethostbyname.return_value = ('localhost', [], ['127.0.0.1'])
        
        with self.assertRaises(ValidationError) as cm:
            validate_url_is_safe("http://localhost:8000")
        self.assertIn("restricted IP address", str(cm.exception))

    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_link_local_imds(self, mock_gethostbyname):
        # Mock resolving a domain to AWS IMDS IP
        mock_gethostbyname.return_value = ('metadata.aws', [], ['169.254.169.254'])
        
        with self.assertRaises(ValidationError) as cm:
            validate_url_is_safe("http://metadata.aws")
        self.assertIn("restricted IP address", str(cm.exception))

    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_carrier_grade_nat(self, mock_gethostbyname):
        # Mock resolving to Carrier Grade NAT (100.64.0.0/10)
        mock_gethostbyname.return_value = ('cgnat.isp', [], ['100.64.0.1'])
        
        with self.assertRaises(ValidationError) as cm:
            validate_url_is_safe("http://cgnat.isp")
        self.assertIn("restricted IP address", str(cm.exception))

    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_dns_rebinding_multiple_ips(self, mock_gethostbyname):
        # Mock a domain resolving to BOTH a public IP and a private IP
        # This simulates a potential DNS rebinding or multi-record setup
        mock_gethostbyname.return_value = ('sketchy.com', [], ['8.8.8.8', '192.168.1.5'])
        
        with self.assertRaises(ValidationError) as cm:
            validate_url_is_safe("https://ssrf-central-hax0r.com")
        self.assertIn("restricted IP address", str(cm.exception))
        self.assertIn("192.168.1.5", str(cm.exception))

    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_invalid_hostname(self, mock_gethostbyname):
        # Simulate DNS resolution failure
        mock_gethostbyname.side_effect = socket.gaierror("Name or service not known")
        
        with self.assertRaises(ValidationError) as cm:
            validate_url_is_safe("https://nonexistent.domain")
        self.assertIn("Could not resolve hostname", str(cm.exception))

    def test_validate_url_is_safe_direct_ip_input(self):
        # Test providing IPs directly without DNS lookup
        
        # Private IP directly
        with self.assertRaises(ValidationError):
            validate_url_is_safe("http://192.168.1.1")
            
        # Loopback IP directly
        with self.assertRaises(ValidationError):
            validate_url_is_safe("http://127.0.0.1")
            
        # Link-local IP directly
        with self.assertRaises(ValidationError):
            validate_url_is_safe("http://169.254.169.254")

    @patch('socket.gethostbyname_ex')
    def test_validate_url_is_safe_ipv6_ignored_by_gethostbyname_ex(self, mock_gethostbyname):
        # NOTE: gethostbyname_ex only returns IPv4. 
        # If the utility is updated to handle IPv6, this test should be updated.
        # For now, we verify standard behavior.
        mock_gethostbyname.return_value = ('ipv4.only', [], ['1.1.1.1'])
        validate_url_is_safe("https://ipv4.only")

    def test_validate_url_is_safe_ipv6_direct_input(self):
        # Test blocking IPv6 addresses directly
        with self.assertRaises(ValidationError):
            validate_url_is_safe("http://[::1]")
            
        with self.assertRaises(ValidationError):
            validate_url_is_safe("http://[fe80::1]")


