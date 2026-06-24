import pytest
from unittest.mock import MagicMock
from api.utils.access.ip import get_client_ip, _validate_ip


class TestValidateIp:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("1.2.3.4", "1.2.3.4"),
            ("  1.2.3.4  ", "1.2.3.4"),
            ("::1", "::1"),
            ("2001:db8::1", "2001:db8::1"),
            ("", None),
            ("   ", None),
            (None, None),
            ("not-an-ip", None),
            ("999.999.999.999", None),
            ("1.2.3.4/24", None),
        ],
    )
    def test_validate_ip(self, raw, expected):
        assert _validate_ip(raw) == expected


def _make_request(**meta):
    req = MagicMock()
    req.META = meta
    return req


class TestGetClientIp:
    def test_x_real_ip_preferred(self):
        req = _make_request(
            HTTP_X_REAL_IP="10.0.0.1",
            HTTP_X_FORWARDED_FOR="10.0.0.2, 10.0.0.3",
            REMOTE_ADDR="10.0.0.4",
        )
        assert get_client_ip(req) == "10.0.0.1"

    def test_falls_back_to_x_forwarded_for(self):
        req = _make_request(
            HTTP_X_FORWARDED_FOR="203.0.113.50, 70.41.3.18",
            REMOTE_ADDR="127.0.0.1",
        )
        assert get_client_ip(req) == "203.0.113.50"

    def test_x_forwarded_for_single_entry(self):
        req = _make_request(HTTP_X_FORWARDED_FOR="203.0.113.50")
        assert get_client_ip(req) == "203.0.113.50"

    def test_falls_back_to_remote_addr(self):
        req = _make_request(REMOTE_ADDR="192.168.1.1")
        assert get_client_ip(req) == "192.168.1.1"

    def test_no_headers_returns_none(self):
        req = _make_request()
        assert get_client_ip(req) is None

    def test_invalid_x_real_ip_falls_through(self):
        req = _make_request(
            HTTP_X_REAL_IP="garbage",
            REMOTE_ADDR="10.0.0.1",
        )
        assert get_client_ip(req) == "10.0.0.1"

    def test_invalid_x_forwarded_for_falls_through(self):
        req = _make_request(
            HTTP_X_FORWARDED_FOR="garbage, 10.0.0.2",
            REMOTE_ADDR="10.0.0.1",
        )
        # First entry is invalid, so falls through to REMOTE_ADDR
        assert get_client_ip(req) == "10.0.0.1"

    def test_ipv6_x_real_ip(self):
        req = _make_request(HTTP_X_REAL_IP="2001:db8::1")
        assert get_client_ip(req) == "2001:db8::1"

    def test_empty_x_real_ip_falls_through(self):
        req = _make_request(
            HTTP_X_REAL_IP="",
            REMOTE_ADDR="10.0.0.1",
        )
        assert get_client_ip(req) == "10.0.0.1"

    def test_whitespace_only_x_real_ip_falls_through(self):
        req = _make_request(
            HTTP_X_REAL_IP="   ",
            HTTP_X_FORWARDED_FOR="203.0.113.50",
        )
        assert get_client_ip(req) == "203.0.113.50"
