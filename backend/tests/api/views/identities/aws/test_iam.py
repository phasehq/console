import unittest
import json
import base64
from unittest.mock import patch, MagicMock, Mock
from datetime import datetime, timezone
from django.test import TestCase
from django.http import JsonResponse
from rest_framework.test import APIRequestFactory
from api.views.identities.aws.iam import aws_iam_auth


class TestAwsIamAuth(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.service_account_id = "2115a1fc-0a78-4a7b-ad8c-6fa6cc15f489"
        
        # Valid AWS STS response XML
        self.valid_aws_response = """
        <GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
          <GetCallerIdentityResult>
            <Arn>arn:aws:iam::499502749186:user/testing-phase-cli-tessaract-auth-mode</Arn>
            <UserId>AIDAXITFPCYBFEX7357DX</UserId>
            <Account>499502749186</Account>
          </GetCallerIdentityResult>
          <ResponseMetadata>
            <RequestId>38cb043b-e164-4c96-842a-f264208507cf</RequestId>
          </ResponseMetadata>
        </GetCallerIdentityResponse>

        """

        # Valid request payload
        self.valid_payload = {
            "account": {
                "type": "service",
                "id": self.service_account_id
            },
            "awsIam": {
                "httpRequestMethod": "POST",
                "httpRequestUrl": "aHR0cHM6Ly9zdHMuYXAtc291dGgtMS5hbWF6b25hd3MuY29t",
                "httpRequestHeaders": "eyJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkOyBjaGFyc2V0PXV0Zi04IiwgIlgtQW16LURhdGUiOiAiMjAyNTA4MjdUMDgwNzE5WiIsICJBdXRob3JpemF0aW9uIjogIkFXUzQtSE1BQy1TSEEyNTYgQ3JlZGVudGlhbD1BS0lBWElURlBDWUJFTEtBNk41Vi8yMDI1MDgyNy9hcC1zb3V0aC0xL3N0cy9hd3M0X3JlcXVlc3QsIFNpZ25lZEhlYWRlcnM9Y29udGVudC10eXBlO2hvc3Q7eC1hbXotZGF0ZSwgU2lnbmF0dXJlPWFkZjdhNzM0MDFlNjNhODRkNWJhNzA3MTQ4MjU3ZGFjMjcyNzhiM2Y3MDEzNWRmMDMyZTBlMDczMzIwNTIwMzgiLCAiQ29udGVudC1MZW5ndGgiOiAiNDMifQ==",
                "httpRequestBody": "QWN0aW9uPUdldENhbGxlcklkZW50aXR5JlZlcnNpb249MjAxMS0wNi0xNQ=="
            },
            "tokenRequest": {
                "ttl": 60
            }
        }

        # Decoded headers for verification
        self.decoded_headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "X-Amz-Date": "20250827T080719Z",
            "Authorization": "AWS4-HMAC-SHA256 Credential=AKIAXITFPCYBELKA6N5V/20250827/ap-south-1/sts/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=adf7a73401e63a84d5ba70714825dabc27278b3f70135df032e0e073320520338",
            "Content-Length": "43"
        }

    def test_valid_authentication_success(self):
        """Test successful AWS IAM authentication with valid request"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )

        # Mock service account
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"

        # Mock identity
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        mock_identity.default_ttl_seconds = 3600
        mock_identity.max_ttl_seconds = 86400
        mock_identity.get_trusted_list.return_value = [
            "arn:aws:iam::499502749186:user/testing-phase-cli-*"
        ]

        # Mock AWS response
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response

        # Mock token minting
        mock_auth_token = {
            "tokenType": "ServiceAccount",
            "token": "pss_service:v2:token123:pubkey:share:wrapkey",
            "bearerToken": "ServiceAccount token123",
            "TTL": 60,
            "maxTTL": 86400
        }

        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.mint_service_account_token', return_value=mock_auth_token), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            # Mock current time to be close to X-Amz-Date
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now

            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 200)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["authentication"], mock_auth_token)

    def test_invalid_json_payload(self):
        """Test handling of malformed JSON payload"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data="invalid json",
            content_type='application/json'
        )
        
        response = aws_iam_auth(request)
        
        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.content)
        self.assertEqual(response_data["error"], "Invalid JSON")

    def test_missing_account_id(self):
        """Test handling of missing service account ID"""
        payload = self.valid_payload.copy()
        payload["account"]["id"] = None
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        response = aws_iam_auth(request)
        
        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.content)
        self.assertEqual(response_data["error"], "Only service account authentication supported")

    def test_invalid_account_type(self):
        """Test handling of invalid account type"""
        payload = self.valid_payload.copy()
        payload["account"]["type"] = "user"
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        response = aws_iam_auth(request)
        
        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.content)
        self.assertEqual(response_data["error"], "Only service account authentication supported")

    def test_invalid_base64_encoding(self):
        """Test handling of invalid base64 encoding in AWS IAM data"""
        payload = self.valid_payload.copy()
        payload["awsIam"]["httpRequestUrl"] = "invalid_base64!!!"
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        response = aws_iam_auth(request)
        
        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.content)
        self.assertEqual(response_data["error"], "Invalid awsIam request encoding")

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
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        response = aws_iam_auth(request)
        
        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.content)
        self.assertEqual(response_data["error"], "Missing X-Amz-Date header")

    def test_invalid_amz_date_format(self):
        """Test handling of invalid X-Amz-Date format"""
        headers_invalid_date = self.decoded_headers.copy()
        headers_invalid_date["X-Amz-Date"] = "invalid-date-format"
        encoded_headers = base64.b64encode(json.dumps(headers_invalid_date).encode()).decode()
        
        payload = self.valid_payload.copy()
        payload["awsIam"]["httpRequestHeaders"] = encoded_headers
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        response = aws_iam_auth(request)
        
        self.assertEqual(response.status_code, 400)
        response_data = json.loads(response.content)
        self.assertEqual(response_data["error"], "Invalid X-Amz-Date")

    def test_service_account_not_found(self):
        """Test handling of non-existent service account"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=None):
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 404)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Service account not found")

    def test_server_side_key_management_required(self):
        """Test requirement for server-side key management"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = None  # No server-side keyring
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account):
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 403)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Server-side key management must be enabled")

    def test_no_aws_iam_identity_attached(self):
        """Test handling of service account without AWS IAM identity"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=None):
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 404)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "No AWS IAM identity attached to this account")

    def test_signature_expired(self):
        """Test handling of expired signature"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {"signatureTtlSeconds": 60}
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            # Mock current time to be way after X-Amz-Date (signature expired)
            mock_now = datetime(2025, 8, 27, 10, 0, 0, tzinfo=timezone.utc)  # 2 hours later
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 401)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Signature expired")

    def test_sts_endpoint_mismatch(self):
        """Test handling of STS endpoint mismatch"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        # Configure identity with different STS endpoint
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.us-east-1.amazonaws.com"  # Different from request
        }
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 400)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "STS endpoint mismatch. Please sign the request for the configured STS endpoint.")
            self.assertIn("expectedEndpoint", response_data)
            self.assertIn("receivedEndpoint", response_data)

    def test_aws_sts_request_failure(self):
        """Test handling of AWS STS request failure"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', side_effect=Exception("Connection failed")), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 502)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Failed to contact AWS STS")

    def test_aws_sts_validation_failed(self):
        """Test handling of AWS STS validation failure"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        
        # Mock AWS response with error
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 403
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 401)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "AWS STS validation failed")
            self.assertEqual(response_data["status"], 403)

    def test_unable_to_parse_aws_identity(self):
        """Test handling of malformed AWS STS response"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        
        # Mock AWS response without ARN
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = "<GetCallerIdentityResponse>Invalid</GetCallerIdentityResponse>"
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 500)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Unable to parse AWS identity")

    def test_wildcard_trusted_principal_rejected(self):
        """Test rejection of wildcard trusted principal patterns"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        mock_identity.get_trusted_list.return_value = ["*"]  # Wildcard not allowed
        
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 400)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Invalid trusted principal pattern '*' is not allowed")

    def test_untrusted_principal(self):
        """Test rejection of untrusted AWS principal"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        # Principal in response doesn't match trusted patterns
        mock_identity.get_trusted_list.return_value = [
            "arn:aws:iam::111111111111:user/allowed-user"
        ]
        
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 403)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Untrusted principal")

    def test_ttl_exceeds_maximum(self):
        """Test handling of TTL request exceeding maximum allowed"""
        payload = self.valid_payload.copy()
        payload["tokenRequest"]["ttl"] = 100000  # Exceeds max TTL
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        mock_identity.default_ttl_seconds = 3600
        mock_identity.max_ttl_seconds = 86400  # 24 hours max
        mock_identity.get_trusted_list.return_value = [
            "arn:aws:iam::499502749186:user/testing-phase-cli-*"
        ]
        
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 400)
            response_data = json.loads(response.content)
            self.assertIn("Requested TTL", response_data["error"])
            self.assertIn("exceeds maximum allowed TTL", response_data["error"])

    def test_token_minting_failure(self):
        """Test handling of token minting failure"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        mock_identity.default_ttl_seconds = 3600
        mock_identity.max_ttl_seconds = 86400
        mock_identity.get_trusted_list.return_value = [
            "arn:aws:iam::499502749186:user/testing-phase-cli-*"
        ]
        
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.mint_service_account_token', side_effect=Exception("Token mint failed")), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 500)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["error"], "Failed to mint token")

    def test_default_signature_ttl_when_not_configured(self):
        """Test default signature TTL when not configured in identity"""
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(self.valid_payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        # Identity without signatureTtlSeconds config
        mock_identity = MagicMock()
        mock_identity.config = {
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
            # No signatureTtlSeconds - should default to 60
        }
        mock_identity.default_ttl_seconds = 3600
        mock_identity.max_ttl_seconds = 86400
        mock_identity.get_trusted_list.return_value = [
            "arn:aws:iam::499502749186:user/testing-phase-cli-*"
        ]
        
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response
        
        mock_auth_token = {
            "tokenType": "ServiceAccount",
            "token": "pss_service:v2:token123:pubkey:share:wrapkey",
            "bearerToken": "ServiceAccount token123",
            "TTL": 60,
            "maxTTL": 86400
        }
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.mint_service_account_token', return_value=mock_auth_token), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 200)
            response_data = json.loads(response.content)
            self.assertEqual(response_data["authentication"], mock_auth_token)

    def test_default_ttl_when_not_requested(self):
        """Test using default TTL when not specified in request"""
        payload = self.valid_payload.copy()
        del payload["tokenRequest"]  # No TTL requested
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        mock_identity.default_ttl_seconds = 3600  # Should use this
        mock_identity.max_ttl_seconds = 86400
        mock_identity.get_trusted_list.return_value = [
            "arn:aws:iam::499502749186:user/testing-phase-cli-*"
        ]
        
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response
        
        mock_auth_token = {
            "tokenType": "ServiceAccount",
            "token": "pss_service:v2:token123:pubkey:share:wrapkey",
            "bearerToken": "ServiceAccount token123",
            "TTL": 3600,  # Should match default_ttl_seconds
            "maxTTL": 86400
        }
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response), \
             patch('api.views.identities.aws.iam.mint_service_account_token', return_value=mock_auth_token) as mock_mint, \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 200)
            # Verify that mint_service_account_token was called with default TTL
            mock_mint.assert_called_once()
            call_args = mock_mint.call_args[0]
            requested_ttl = call_args[2]  # Third argument is requested_ttl
            self.assertEqual(requested_ttl, 3600)  # Should be default_ttl_seconds

    def test_case_insensitive_header_matching(self):
        """Test case-insensitive matching for X-Amz-Date header"""
        headers_lowercase = {
            "content-type": "application/x-www-form-urlencoded; charset=utf-8",
            "x-amz-date": "20250827T080719Z",  # lowercase
            "authorization": "AWS4-HMAC-SHA256 Credential=...",
            "content-length": "43"
        }
        encoded_headers = base64.b64encode(json.dumps(headers_lowercase).encode()).decode()
        
        payload = self.valid_payload.copy()
        payload["awsIam"]["httpRequestHeaders"] = encoded_headers
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            # Should not fail on missing X-Amz-Date since it finds x-amz-date
            response = aws_iam_auth(request)
            
            # Should pass the header validation and continue to next steps
            self.assertNotEqual(response.status_code, 400)

    def test_get_method_support(self):
        """Test support for GET method in addition to POST"""
        payload = self.valid_payload.copy()
        payload["awsIam"]["httpRequestMethod"] = "GET"
        
        request = self.factory.post(
            '/identity/v1/aws/iam/auth',
            data=json.dumps(payload),
            content_type='application/json'
        )
        
        mock_service_account = MagicMock()
        mock_service_account.server_wrapped_keyring = "encrypted_keyring_data"
        
        mock_identity = MagicMock()
        mock_identity.config = {
            "signatureTtlSeconds": 300,
            "stsEndpoint": "https://sts.ap-south-1.amazonaws.com"
        }
        mock_identity.default_ttl_seconds = 3600
        mock_identity.max_ttl_seconds = 86400
        mock_identity.get_trusted_list.return_value = [
            "arn:aws:iam::499502749186:user/testing-phase-cli-*"
        ]
        
        mock_aws_response = MagicMock()
        mock_aws_response.status_code = 200
        mock_aws_response.text = self.valid_aws_response
        
        mock_auth_token = {
            "tokenType": "ServiceAccount",
            "token": "pss_service:v2:token123:pubkey:share:wrapkey",
            "bearerToken": "ServiceAccount token123",
            "TTL": 60,
            "maxTTL": 86400
        }
        
        with patch('api.views.identities.aws.iam.resolve_service_account', return_value=mock_service_account), \
             patch('api.views.identities.aws.iam.resolve_attached_identity', return_value=mock_identity), \
             patch('api.views.identities.aws.iam.requests.request', return_value=mock_aws_response) as mock_request, \
             patch('api.views.identities.aws.iam.mint_service_account_token', return_value=mock_auth_token), \
             patch('api.views.identities.aws.iam.timezone') as mock_timezone:
            
            mock_now = datetime(2025, 8, 27, 8, 7, 30, tzinfo=timezone.utc)
            mock_timezone.now.return_value = mock_now
            
            response = aws_iam_auth(request)
            
            self.assertEqual(response.status_code, 200)
            # Verify that GET method was used in the AWS request
            mock_request.assert_called_once()
            call_args = mock_request.call_args[0]
            method = call_args[0]
            self.assertEqual(method, "GET")


if __name__ == '__main__':
    unittest.main()
