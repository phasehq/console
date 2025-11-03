import unittest
import json
import base64
import re
from datetime import datetime, timezone
from unittest.mock import MagicMock, Mock


class MockRequest:
    """Mock request object for testing"""
    def __init__(self, body):
        self.body = body


class MockJsonResponse:
    """Mock JsonResponse for testing"""
    def __init__(self, data, status=200):
        self.status_code = status
        self.content = json.dumps(data)
        self.data = data


def aws_iam_auth_logic(request_body, resolve_service_account_func, resolve_attached_identity_func, 
                      mint_service_account_token_func, requests_func, timezone_func):
    """
    Simulates the AWS IAM authentication.
    """
    try:
        payload = json.loads(request_body)
    except Exception:
        return MockJsonResponse({"error": "Invalid JSON"}, status=400)

    account = (payload or {}).get("account", {})
    aws_iam = (payload or {}).get("awsIam", {})
    token_req = (payload or {}).get("tokenRequest", {})

    account_type = (account.get("type") or "service").lower()
    account_id = account.get("id")
    if account_type != "service" or not account_id:
        return MockJsonResponse({"error": "Only service account authentication supported"}, status=400)

    # Decode signed request
    try:
        method = aws_iam.get("httpRequestMethod") or "POST"
        url = base64.b64decode(aws_iam["httpRequestUrl"]).decode("utf-8")
        headers_json = base64.b64decode(aws_iam["httpRequestHeaders"]).decode("utf-8")
        body = base64.b64decode(aws_iam.get("httpRequestBody") or b"").decode("utf-8")
        headers = json.loads(headers_json)
    except Exception:
        return MockJsonResponse({"error": "Invalid awsIam request encoding"}, status=400)

    # Verify signature freshness using X-Amz-Date
    amz_date = headers.get("X-Amz-Date") or headers.get("x-amz-date")
    if not amz_date:
        return MockJsonResponse({"error": "Missing X-Amz-Date header"}, status=400)
    
    try:
        dt = (
            datetime.strptime(amz_date.replace("Z", ""), "%Y%m%dT%H%M%S")
            .replace(tzinfo=timezone.utc)
        )
    except Exception:
        return MockJsonResponse({"error": "Invalid X-Amz-Date"}, status=400)

    # Resolve account and identity
    service_account = resolve_service_account_func(account_id)
    if service_account is None:
        return MockJsonResponse({"error": "Service account not found"}, status=404)
    if not service_account.server_wrapped_keyring:
        return MockJsonResponse({"error": "Server-side key management must be enabled"}, status=403)

    identity = resolve_attached_identity_func(service_account, "aws_iam")
    if not identity:
        return MockJsonResponse({"error": "No AWS IAM identity attached to this account"}, status=404)

    try:
        max_skew = int(identity.config.get("signatureTtlSeconds", 60))
    except Exception:
        max_skew = 60
    
    now = timezone_func()
    if abs((now - dt).total_seconds()) > max_skew:
        return MockJsonResponse({"error": "Signature expired"}, status=401)

    # Enforce that the signed request targets the identity's configured STS endpoint
    try:
        from urllib.parse import urlparse
        configured = identity.config.get("stsEndpoint")
        if not configured.startswith("http"):
            configured = f"https://{configured}"
        request_url = url
        if not request_url.startswith("http"):
            request_url = f"https://{request_url}"

        cfg_host = urlparse(configured).netloc.lower()
        req_host = urlparse(request_url).netloc.lower()
        header_host = (headers.get("Host") or headers.get("host") or "").lower()

        if req_host != cfg_host or (header_host and header_host != cfg_host):
            return MockJsonResponse(
                {
                    "error": "STS endpoint mismatch. Please sign the request for the configured STS endpoint.",
                    "expectedEndpoint": configured,
                    "receivedEndpoint": request_url,
                },
                status=400,
            )
    except Exception:
        return MockJsonResponse({"error": "Invalid STS endpoint configuration"}, status=400)

    # Forward the signed request to AWS STS
    try:
        resp = requests_func(method, url, headers=headers, data=body)
    except Exception:
        return MockJsonResponse({"error": "Failed to contact AWS STS"}, status=502)

    if resp.status_code != 200:
        return MockJsonResponse({"error": "AWS STS validation failed", "status": resp.status_code}, status=401)

    # Parse minimal identity info from XML
    arn = None
    try:
        m = re.search(r"<Arn>([^<]+)</Arn>", resp.text)
        if m:
            arn = m.group(1)
    except Exception:
        pass
    if arn is None:
        return MockJsonResponse({"error": "Unable to parse AWS identity"}, status=500)

    # Trust check
    import fnmatch
    trusted = identity.get_trusted_list()
    if any(p == "*" for p in trusted):
        return MockJsonResponse({"error": "Invalid trusted principal pattern '*' is not allowed"}, status=400)

    def arn_matches_patterns(value: str, patterns: list[str]) -> bool:
        for pattern in patterns:
            if not pattern or pattern == "*":
                continue
            if fnmatch.fnmatch(value, pattern):
                return True
        return False

    if not arn_matches_patterns(arn, trusted):
        return MockJsonResponse({"error": "Untrusted principal"}, status=403)

    # Validate requested TTL
    requested_ttl = int(token_req.get("ttl") or identity.default_ttl_seconds)
    max_ttl = identity.max_ttl_seconds
    
    if requested_ttl > max_ttl:
        return MockJsonResponse({
            "error": f"Requested TTL ({requested_ttl}s) exceeds maximum allowed TTL ({max_ttl}s)"
        }, status=400)

    try:
        auth = mint_service_account_token_func(
            service_account,
            identity,
            requested_ttl,
            token_name_fallback="aws-iam",
        )
    except Exception:
        return MockJsonResponse({"error": "Failed to mint token"}, status=500)

    return MockJsonResponse({"authentication": auth})


class TestAwsIamAuthLogic(unittest.TestCase):
    def setUp(self):
        self.service_account_id = "12345678-1234-1234-1234-123456789abc"
        
        # Valid AWS STS response XML (anonymized)
        self.valid_aws_response = """<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <Arn>arn:aws:iam::123456789012:user/test-user</Arn>
    <UserId>AIDACKCEVSQ6C2EXAMPLE</UserId>
    <Account>123456789012</Account>
  </GetCallerIdentityResult>
  <ResponseMetadata>
    <RequestId>01234567-89ab-cdef-0123-456789abcdef</RequestId>
  </ResponseMetadata>
</GetCallerIdentityResponse>"""

        # Valid request payload (anonymized)
        self.valid_payload = {
            "account": {
                "type": "service",
                "id": self.service_account_id
            },
            "awsIam": {
                "httpRequestMethod": "POST",
                "httpRequestUrl": "aHR0cHM6Ly9zdHMuYXAtc291dGgtMS5hbWF6b25hd3MuY29t",  # https://sts.ap-south-1.amazonaws.com
                "httpRequestHeaders": "eyJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkOyBjaGFyc2V0PXV0Zi04IiwgIlgtQW16LURhdGUiOiAiMjAyNTA4MjdUMDgwNzE5WiIsICJBdXRob3JpemF0aW9uIjogIkFXUzQtSE1BQy1TSEEyNTYgQ3JlZGVudGlhbD1BS0lBRVhBTVBMRTEyMzQ1LzIwMjUwODI3L2FwLXNvdXRoLTEvc3RzL2F3czRfcmVxdWVzdCwgU2lnbmVkSGVhZGVycz1jb250ZW50LXR5cGU7aG9zdDt4LWFtei1kYXRlLCBTaWduYXR1cmU9ZXhhbXBsZXNpZ25hdHVyZTEyMzQ1Njc4OTBhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eiIsICJDb250ZW50LUxlbmd0aCI6ICI0MyJ9",
                "httpRequestBody": "QWN0aW9uPUdldENhbGxlcklkZW50aXR5JlZlcnNpb249MjAxMS0wNi0xNQ=="  # Action=GetCallerIdentity&Version=2011-06-15
            },
            "tokenRequest": {
                "ttl": 60
            }
        }

        # Decoded headers for verification (anonymized)
        self.decoded_headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "X-Amz-Date": "20250827T080719Z",
            "Authorization": "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE12345/20250827/ap-south-1/sts/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=examplesignature1234567890abcdefghijklmnopqrstuvwxyz",
            "Content-Length": "43"
        }

    def test_invalid_json_payload(self):
        """Test handling of malformed JSON payload"""
        response = aws_iam_auth_logic(
            b"invalid json",
            None, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid JSON", response.content)

    def test_missing_account_id(self):
        """Test handling of missing service account ID"""
        payload = self.valid_payload.copy()
        payload["account"]["id"] = None
        
        response = aws_iam_auth_logic(
            json.dumps(payload).encode(),
            None, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Only service account authentication supported", response.content)

    def test_invalid_account_type(self):
        """Test handling of invalid account type"""
        payload = self.valid_payload.copy()
        payload["account"]["type"] = "user"
        
        response = aws_iam_auth_logic(
            json.dumps(payload).encode(),
            None, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Only service account authentication supported", response.content)

    def test_invalid_base64_encoding(self):
        """Test handling of invalid base64 encoding in AWS IAM data"""
        payload = self.valid_payload.copy()
        payload["awsIam"]["httpRequestUrl"] = "invalid_base64!!!"
        
        response = aws_iam_auth_logic(
            json.dumps(payload).encode(),
            None, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid awsIam request encoding", response.content)

    def test_missing_amz_date_header(self):
        """Test handling of missing X-Amz-Date header"""
        headers_without_date = {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "Authorization": "AWS4-HMAC-SHA256 Credential=...",
            "Content-Length": "43"
        }
        encoded_headers = base64.b64encode(json.dumps(headers_without_date).encode()).decode()
        
        payload = self.valid_payload.copy()
        payload["awsIam"]["httpRequestHeaders"] = encoded_headers
        
        response = aws_iam_auth_logic(
            json.dumps(payload).encode(),
            None, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing X-Amz-Date header", response.content)

    def test_invalid_amz_date_format(self):
        """Test handling of invalid X-Amz-Date format"""
        headers_invalid_date = self.decoded_headers.copy()
        headers_invalid_date["X-Amz-Date"] = "invalid-date-format"
        encoded_headers = base64.b64encode(json.dumps(headers_invalid_date).encode()).decode()
        
        payload = self.valid_payload.copy()
        payload["awsIam"]["httpRequestHeaders"] = encoded_headers
        
        response = aws_iam_auth_logic(
            json.dumps(payload).encode(),
            None, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid X-Amz-Date", response.content)

    def test_service_account_not_found(self):
        """Test handling of non-existent service account"""
        def mock_resolve_service_account(account_id):
            return None
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 404)
        self.assertIn("Service account not found", response.content)

    def test_server_side_key_management_required(self):
        """Test requirement for server-side key management"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = None  # No server-side keyring
            return mock_service_account
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, None, None, None, None
        )
        
        self.assertEqual(response.status_code, 403)
        self.assertIn("Server-side key management must be enabled", response.content)

    def test_no_aws_iam_identity_attached(self):
        """Test handling of service account without AWS IAM identity"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            return None
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, None, None
        )
        
        self.assertEqual(response.status_code, 404)
        self.assertIn("No AWS IAM identity attached to this account", response.content)

    def test_signature_expired(self):
        """Test handling of expired signature"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {"signatureTtlSeconds": 60}
            return mock_identity
        
        def mock_timezone_now():
            # Mock current time to be way after X-Amz-Date (signature expired)
            return datetime(2025, 8, 27, 10, 0, 0, tzinfo=timezone.utc)  # 2 hours later
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, None, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 401)
        self.assertIn("Signature expired", response.content)

    def test_sts_endpoint_mismatch(self):
        """Test handling of STS endpoint mismatch"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.us-east-1.amazonaws.com"  # Different from request
            }
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, None, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("STS endpoint mismatch", response.content)

    def test_aws_sts_request_failure(self):
        """Test handling of AWS STS request failure"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            raise Exception("Connection failed")
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 502)
        self.assertIn("Failed to contact AWS STS", response.content)

    def test_aws_sts_validation_failed(self):
        """Test handling of AWS STS validation failure"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            mock_response = MagicMock()
            mock_response.status_code = 403
            return mock_response
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 401)
        self.assertIn("AWS STS validation failed", response.content)

    def test_unable_to_parse_aws_identity(self):
        """Test handling of malformed AWS STS response"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = "<GetCallerIdentityResponse>Invalid</GetCallerIdentityResponse>"
            return mock_response
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 500)
        self.assertIn("Unable to parse AWS identity", response.content)

    def test_wildcard_trusted_principal_rejected(self):
        """Test rejection of wildcard trusted principal patterns"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            mock_identity.get_trusted_list.return_value = ["*"]  # Wildcard not allowed
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = self.valid_aws_response
            return mock_response
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid trusted principal pattern '*' is not allowed", response.content)

    def test_untrusted_principal(self):
        """Test rejection of untrusted AWS principal"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            # Principal in response doesn't match trusted patterns
            mock_identity.get_trusted_list.return_value = [
                "arn:aws:iam::111111111111:user/allowed-user"
            ]
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = self.valid_aws_response
            return mock_response
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 403)
        self.assertIn("Untrusted principal", response.content)

    def test_ttl_exceeds_maximum(self):
        """Test handling of TTL request exceeding maximum allowed"""
        payload = self.valid_payload.copy()
        payload["tokenRequest"]["ttl"] = 100000  # Exceeds max TTL
        
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            mock_identity.default_ttl_seconds = 3600
            mock_identity.max_ttl_seconds = 86400  # 24 hours max
            mock_identity.get_trusted_list.return_value = [
                "arn:aws:iam::123456789012:user/test-*"
            ]
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = self.valid_aws_response
            return mock_response
        
        response = aws_iam_auth_logic(
            json.dumps(payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, None, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("Requested TTL", response.content)
        self.assertIn("exceeds maximum allowed TTL", response.content)

    def test_token_minting_failure(self):
        """Test handling of token minting failure"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            mock_identity.default_ttl_seconds = 3600
            mock_identity.max_ttl_seconds = 86400
            mock_identity.get_trusted_list.return_value = [
                "arn:aws:iam::123456789012:user/test-*"
            ]
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = self.valid_aws_response
            return mock_response
        
        def mock_mint_token(service_account, identity, requested_ttl, token_name_fallback):
            raise Exception("Token mint failed")
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, mock_mint_token, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 500)
        self.assertIn("Failed to mint token", response.content)

    def test_valid_authentication_success(self):
        """Test successful AWS IAM authentication with valid request"""
        def mock_resolve_service_account(account_id):
            mock_service_account = MagicMock()
            mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
            return mock_service_account
        
        def mock_resolve_attached_identity(service_account, provider):
            mock_identity = MagicMock()
            mock_identity.config = {
                "signatureTtlSeconds": 300,
                "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            }
            mock_identity.default_ttl_seconds = 3600
            mock_identity.max_ttl_seconds = 86400
            mock_identity.get_trusted_list.return_value = [
                "arn:aws:iam::123456789012:user/test-*"
            ]
            return mock_identity
        
        def mock_timezone_now():
            return datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
        
        def mock_requests(method, url, headers=None, data=None):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.text = self.valid_aws_response
            return mock_response
        
        def mock_mint_token(service_account, identity, requested_ttl, token_name_fallback):
            return {
                "tokenType": "ServiceAccount",
                "token": "pss_service:v2:token123:pubkey:share:wrapkey",
                "bearerToken": "ServiceAccount token123",
                "TTL": 60,
                "maxTTL": 86400
            }
        
        response = aws_iam_auth_logic(
            json.dumps(self.valid_payload).encode(),
            mock_resolve_service_account, mock_resolve_attached_identity, mock_mint_token, mock_requests, mock_timezone_now
        )
        
        self.assertEqual(response.status_code, 200)
        response_data = json.loads(response.content)
        self.assertIn("authentication", response_data)
        self.assertEqual(response_data["authentication"]["tokenType"], "ServiceAccount")


if __name__ == '__main__':
    unittest.main()
