"""
Audit-log routing for rotating-secret reads: synthetic Secret rows
(returned by build_rotating_secret_rows / build_synthetic_secret_for_cred_output)
must produce SecretEvent rows with `secret=NULL` and
`rotating_secret_credential` set, so reads of rotated values appear in the
same audit table as regular-secret reads.
"""

from unittest.mock import MagicMock, patch

from api.models import RotatingSecretCredential, SecretEvent
from api.utils.audit_logging import _resolve_rotating_credential


def _stub_real_secret():
    s = MagicMock()
    s.id = "real-pk"
    s.tags = MagicMock()
    s.tags.all.return_value = []
    return s


def _stub_synthetic_row(cred_id="cred-xyz"):
    s = MagicMock()
    s.id = f"rs:{cred_id}:api_key"
    s._rotating_credential_id = cred_id
    # No .tags M2M — exercising the "real_secrets only" prefetch path.
    return s


@patch("api.utils.audit_logging.django_apps.get_model")
def test_resolve_rotating_credential_returns_none_for_real_secret(mock_get_model):
    # MagicMock auto-creates attrs; spec=[] forces the sentinel attr to be missing
    s = MagicMock(spec=[])
    assert _resolve_rotating_credential(s) is None
    mock_get_model.assert_not_called()


@patch("api.utils.audit_logging.django_apps.get_model")
def test_resolve_rotating_credential_looks_up_when_sentinel_present(mock_get_model):
    cred = MagicMock(spec=RotatingSecretCredential)
    Cred = MagicMock()
    Cred.objects.filter.return_value.first.return_value = cred
    mock_get_model.return_value = Cred

    s = MagicMock(spec=["_rotating_credential_id"])
    s._rotating_credential_id = "cred-1"
    assert _resolve_rotating_credential(s) is cred
    Cred.objects.filter.assert_called_once_with(id="cred-1")
