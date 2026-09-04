"""Tests for SCIM startIndex/count parsing on the list endpoints.

startIndex and count come straight from the client, so a malformed value has to
come back as a SCIM 400 rather than a 500.
"""

from unittest.mock import MagicMock

import pytest

from ee.authentication.scim.constants import SCIM_DEFAULT_COUNT
from ee.authentication.scim.utils import parse_pagination_params


def _request(**params):
    request = MagicMock()
    request.GET = params
    return request


def test_defaults_when_absent():
    start_index, count, error = parse_pagination_params(_request())
    assert error is None
    assert start_index == 1
    assert count == SCIM_DEFAULT_COUNT


def test_valid_values_are_used():
    start_index, count, error = parse_pagination_params(
        _request(startIndex="5", count="20")
    )
    assert error is None
    assert (start_index, count) == (5, 20)


@pytest.mark.parametrize("bad", ["abc", "", "1.5", "null", "1,000"])
def test_non_integer_start_index_is_a_400(bad):
    start_index, count, error = parse_pagination_params(_request(startIndex=bad))
    assert (start_index, count) == (None, None)
    assert error.status_code == 400


@pytest.mark.parametrize("bad", ["abc", "", "1.5"])
def test_non_integer_count_is_a_400(bad):
    start_index, count, error = parse_pagination_params(_request(count=bad))
    assert (start_index, count) == (None, None)
    assert error.status_code == 400


def test_start_index_is_clamped_to_one():
    # RFC 7644 3.4.2.4: a value less than 1 is interpreted as 1.
    start_index, _, error = parse_pagination_params(_request(startIndex="-3"))
    assert error is None
    assert start_index == 1


def test_negative_count_becomes_zero():
    # Left negative this would reach the queryset as qs[0:-5], and Django raises
    # ValueError("Negative indexing is not supported.").
    _, count, error = parse_pagination_params(_request(count="-5"))
    assert error is None
    assert count == 0


def test_count_is_capped_at_the_default():
    _, count, error = parse_pagination_params(_request(count="100000"))
    assert error is None
    assert count == SCIM_DEFAULT_COUNT
