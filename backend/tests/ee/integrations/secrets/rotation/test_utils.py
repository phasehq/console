from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError

from ee.integrations.secrets.rotation.utils import validate_key_map


class _Env:
    def __init__(self):
        self.id = "env-1"


@patch("ee.integrations.secrets.rotation.utils.check_for_duplicates_blind", return_value=False)
@patch("ee.integrations.secrets.rotation.utils.get_environment_keys", return_value=("pub", "priv"))
@patch("ee.integrations.secrets.rotation.utils.decrypt_asymmetric")
@patch("ee.integrations.secrets.rotation.utils.compute_key_digest")
def test_validate_key_map_rejects_duplicate_digests(
    mock_digest, mock_decrypt, _mock_env_keys, _mock_dupes
):
    # Two outputs map to the same plaintext name (and therefore digest).
    # Without the explicit guard, the DB-blind check collapses them and the
    # create would succeed with two synthetic rows at the same env/path/key.
    mock_decrypt.side_effect = lambda val, *_: val
    mock_digest.return_value = "same-digest"

    with pytest.raises(ValidationError, match="same secret key"):
        validate_key_map(
            [
                {"id": "api_key", "key_name": "ENC_NAME_A"},
                {"id": "key_id", "key_name": "ENC_NAME_B"},
            ],
            provider_id="litellm",
            environment=_Env(),
            path="/",
        )


@patch("ee.integrations.secrets.rotation.utils.check_for_duplicates_blind", return_value=False)
@patch("ee.integrations.secrets.rotation.utils.get_environment_keys", return_value=("pub", "priv"))
@patch("ee.integrations.secrets.rotation.utils.decrypt_asymmetric")
@patch("ee.integrations.secrets.rotation.utils.compute_key_digest")
def test_validate_key_map_passes_distinct_digests(
    mock_digest, mock_decrypt, _mock_env_keys, _mock_dupes
):
    mock_decrypt.side_effect = lambda val, *_: val
    mock_digest.side_effect = lambda name, _env: f"digest:{name}"

    result = validate_key_map(
        [
            {"id": "api_key", "key_name": "ENC_NAME_A"},
            {"id": "key_id", "key_name": "ENC_NAME_B"},
        ],
        provider_id="litellm",
        environment=_Env(),
        path="/",
    )
    assert {e["id"] for e in result} == {"api_key", "key_id"}
