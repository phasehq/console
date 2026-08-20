"""Tests for the two-step account email-change ceremony:
RequestEmailChangeMutation (send code) and ConfirmEmailChangeMutation
(verify code + atomic switch + all-org keyring re-wrap)."""

import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from graphql import GraphQLError


def _make_user(email="old@example.com", has_password=True):
    user = MagicMock()
    user.userId = "uuid-user-1"
    user.pk = "uuid-user-1"
    user.email = email
    user.username = email
    user.full_name = "Alice"
    user.has_usable_password.return_value = has_password
    return user


def _make_info(user, session=None):
    info = MagicMock()
    info.context.user = user
    info.context.session = session if session is not None else {}
    return info


def _member(org_id, identity_key="ik", role="Developer"):
    m = MagicMock()
    m.id = f"member-{org_id}"
    m.organisation_id = org_id
    m.organisation = MagicMock()
    m.organisation.id = org_id
    m.identity_key = identity_key
    m.role.name = role
    return m


def _keyring_input(org_id, identity_key="ik"):
    return SimpleNamespace(
        org_id=org_id,
        identity_key=identity_key,
        wrapped_keyring=f"wk-{org_id}",
        wrapped_recovery=f"wr-{org_id}",
    )


# ---------------------------------------------------------------------------
# RequestEmailChangeMutation
# ---------------------------------------------------------------------------


@patch("backend.graphene.mutations.account.SCIMUser")
@patch("backend.graphene.mutations.account.require_fresh_session_graphql")
class TestRequestEmailChange:
    def _mutate(self, info, new_email):
        from backend.graphene.mutations.account import RequestEmailChangeMutation

        return RequestEmailChangeMutation.mutate(None, info, new_email)

    def test_stale_session_rejected(self, mock_fresh, mock_scim):
        mock_fresh.side_effect = GraphQLError("reauth_required")
        with pytest.raises(GraphQLError, match="reauth_required"):
            self._mutate(_make_info(_make_user()), "new@example.com")

    def test_scim_managed_rejected(self, mock_fresh, mock_scim):
        mock_scim.objects.filter.return_value.exists.return_value = True
        with pytest.raises(GraphQLError, match="identity provider"):
            self._mutate(_make_info(_make_user()), "new@example.com")

    def test_invalid_email_rejected(self, mock_fresh, mock_scim):
        mock_scim.objects.filter.return_value.exists.return_value = False
        with pytest.raises(GraphQLError, match="Invalid email"):
            self._mutate(_make_info(_make_user()), "notanemail")

    def test_same_as_current_rejected(self, mock_fresh, mock_scim):
        mock_scim.objects.filter.return_value.exists.return_value = False
        with pytest.raises(GraphQLError, match="already your account email"):
            self._mutate(_make_info(_make_user(email="a@b.com")), "a@b.com")

    @patch("api.views.auth_password._check_email_domain_allowed", return_value=False)
    def test_domain_not_allowed(self, mock_domain, mock_fresh, mock_scim):
        mock_scim.objects.filter.return_value.exists.return_value = False
        with pytest.raises(GraphQLError, match="domain is not allowed"):
            self._mutate(_make_info(_make_user()), "new@blocked.com")

    @patch("api.views.auth_password._check_email_domain_allowed", return_value=True)
    @patch("django.contrib.auth.get_user_model")
    def test_email_taken_rejected(
        self, mock_get_user, mock_domain, mock_fresh, mock_scim
    ):
        mock_scim.objects.filter.return_value.exists.return_value = False
        User = MagicMock()
        User.objects.filter.return_value.exclude.return_value.exists.return_value = True
        mock_get_user.return_value = User
        with pytest.raises(GraphQLError, match="already exists"):
            self._mutate(_make_info(_make_user()), "taken@example.com")

    @patch("api.views.auth_password._smtp_configured", return_value=True)
    @patch("api.views.auth_password._skip_email_verification", return_value=False)
    @patch("api.emails.send_email_change_code")
    @patch("api.views.auth_password._check_email_domain_allowed", return_value=True)
    @patch("django.contrib.auth.get_user_model")
    def test_happy_path_stores_pending_and_sends_code(
        self, mock_get_user, mock_domain, mock_email, mock_skip, mock_smtp,
        mock_fresh, mock_scim
    ):
        mock_scim.objects.filter.return_value.exists.return_value = False
        User = MagicMock()
        User.objects.filter.return_value.exclude.return_value.exists.return_value = False
        mock_get_user.return_value = User

        session = {}
        info = _make_info(_make_user(), session=session)
        result = self._mutate(info, "New@Example.com")

        assert result.ok is True
        assert result.verification_required is True
        assert session["email_change_new_email"] == "new@example.com"
        assert "email_change_code_hash" in session
        assert isinstance(session["email_change_at"], int)
        mock_email.assert_called_once()
        # The plaintext code is sent, never stored in the session
        sent_code = mock_email.call_args.args[3]
        assert session["email_change_code_hash"] != sent_code

    @patch("api.views.auth_password._smtp_configured", return_value=False)
    @patch("api.views.auth_password._skip_email_verification", return_value=False)
    @patch("api.emails.send_email_change_code")
    @patch("api.views.auth_password._check_email_domain_allowed", return_value=True)
    @patch("django.contrib.auth.get_user_model")
    def test_no_smtp_skips_verification(
        self, mock_get_user, mock_domain, mock_email, mock_skip, mock_smtp,
        mock_fresh, mock_scim
    ):
        """Same convention as password signup: without SMTP the code could
        never arrive, so verification is skipped rather than dead-ending."""
        mock_scim.objects.filter.return_value.exists.return_value = False
        User = MagicMock()
        User.objects.filter.return_value.exclude.return_value.exists.return_value = False
        mock_get_user.return_value = User

        session = {}
        info = _make_info(_make_user(), session=session)
        result = self._mutate(info, "new@example.com")

        assert result.ok is True
        assert result.verification_required is False
        assert session["email_change_new_email"] == "new@example.com"
        assert "email_change_code_hash" not in session
        mock_email.assert_not_called()


# ---------------------------------------------------------------------------
# ConfirmEmailChangeMutation
# ---------------------------------------------------------------------------


@patch("api.emails.send_email_changed_alert")
@patch("backend.graphene.mutations.account.stamp_auth_time")
@patch("backend.graphene.mutations.account.login")
@patch("backend.graphene.mutations.account.transaction")
@patch("backend.graphene.mutations.account.OrganisationMember")
@patch("backend.graphene.mutations.account.check_password")
@patch("backend.graphene.mutations.account._user_is_scim_managed", return_value=False)
@patch("backend.graphene.mutations.account._email_change_locked_out", return_value=False)
@patch("backend.graphene.mutations.account.require_fresh_session_graphql")
class TestConfirmEmailChange:
    def _valid_session(self):
        return {
            "email_change_new_email": "new@example.com",
            "email_change_code_hash": "hashed-code",
            "email_change_at": int(time.time()),
        }

    def _mutate(self, info, **kwargs):
        from backend.graphene.mutations.account import ConfirmEmailChangeMutation

        defaults = dict(
            code="ABC12345",
            new_email="new@example.com",
            keyrings=[],
            current_auth_hash=None,
            new_auth_hash=None,
        )
        defaults.update(kwargs)
        return ConfirmEmailChangeMutation.mutate(None, info, **defaults)

    def _setup_user_model(self, mock_get_user_patch, user):
        User = MagicMock()
        User.objects.filter.return_value.exclude.return_value.exists.return_value = False
        mock_get_user_patch.return_value = User
        return User

    def test_no_pending_rejected(
        self, mock_fresh, mock_locked, mock_scim, mock_check, mock_om,
        mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        info = _make_info(_make_user(), session={})
        with pytest.raises(GraphQLError, match="No pending email change"):
            self._mutate(info)

    def test_expired_pending_cleared(
        self, mock_fresh, mock_locked, mock_scim, mock_check, mock_om,
        mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        session = self._valid_session()
        session["email_change_at"] = int(time.time()) - 10000
        info = _make_info(_make_user(), session=session)
        with pytest.raises(GraphQLError, match="expired"):
            self._mutate(info)
        assert "email_change_new_email" not in session

    def test_locked_out_rejected(
        self, mock_fresh, mock_locked, mock_scim, mock_check, mock_om,
        mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        mock_locked.return_value = True
        info = _make_info(_make_user(), session=self._valid_session())
        with pytest.raises(GraphQLError, match="Too many attempts"):
            self._mutate(info)

    @patch("backend.graphene.mutations.account._record_email_change_failure")
    def test_wrong_code_records_failure(
        self, mock_record, mock_fresh, mock_locked, mock_scim, mock_check,
        mock_om, mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        mock_check.return_value = False  # code mismatch
        info = _make_info(_make_user(), session=self._valid_session())
        with pytest.raises(GraphQLError, match="Incorrect verification code"):
            self._mutate(info)
        mock_record.assert_called_once()

    def test_email_mismatch_rejected(
        self, mock_fresh, mock_locked, mock_scim, mock_check, mock_om,
        mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        info = _make_info(_make_user(), session=self._valid_session())
        with pytest.raises(GraphQLError, match="mismatch"):
            self._mutate(info, new_email="different@example.com")

    @patch("django.contrib.auth.get_user_model")
    def test_password_user_missing_authhash_rejected(
        self, mock_get_user, mock_fresh, mock_locked, mock_scim, mock_check,
        mock_om, mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        mock_check.return_value = True
        self._setup_user_model(mock_get_user, _make_user())
        info = _make_info(_make_user(has_password=True), session=self._valid_session())
        with pytest.raises(GraphQLError, match="Password proof required"):
            self._mutate(info, current_auth_hash=None)

    @patch("django.contrib.auth.get_user_model")
    def test_password_user_wrong_password_rejected(
        self, mock_get_user, mock_fresh, mock_locked, mock_scim, mock_check,
        mock_om, mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        mock_check.return_value = True  # code ok
        self._setup_user_model(mock_get_user, _make_user())
        user = _make_user(has_password=True)
        user.check_password.return_value = False  # wrong password
        info = _make_info(user, session=self._valid_session())
        with pytest.raises(GraphQLError, match="Current password is incorrect"):
            self._mutate(
                info, current_auth_hash="bad", new_auth_hash="new"
            )

    @patch("django.contrib.auth.get_user_model")
    def test_identity_key_mismatch_rejected(
        self, mock_get_user, mock_fresh, mock_locked, mock_scim, mock_check,
        mock_om, mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        mock_check.return_value = True
        self._setup_user_model(mock_get_user, _make_user())
        mock_tx.atomic.return_value.__enter__ = MagicMock()
        mock_tx.atomic.return_value.__exit__ = MagicMock(return_value=False)

        user = _make_user(has_password=False)
        info = _make_info(user, session=self._valid_session())
        mock_om.objects.filter.return_value.select_related.return_value = [
            _member("org-1", identity_key="real-ik")
        ]
        with pytest.raises(GraphQLError, match="Keyring verification failed"):
            self._mutate(info, keyrings=[_keyring_input("org-1", identity_key="forged-ik")])

    @patch("api.views.auth_password._smtp_configured", return_value=False)
    @patch("api.views.auth_password._skip_email_verification", return_value=False)
    @patch("django.contrib.auth.get_user_model")
    def test_codeless_pending_accepted_when_verification_skipped(
        self, mock_get_user, mock_skip, mock_smtp, mock_fresh, mock_locked,
        mock_scim, mock_check, mock_om, mock_tx, mock_login, mock_stamp,
        mock_alert,
    ):
        """A pending change written in skip mode (no code hash) confirms
        without a code — the skip condition is re-checked server-side."""
        self._setup_user_model(mock_get_user, _make_user())
        mock_tx.atomic.return_value.__enter__ = MagicMock()
        mock_tx.atomic.return_value.__exit__ = MagicMock(return_value=False)
        mock_tx.on_commit.side_effect = lambda cb: cb()

        user = _make_user(has_password=False)
        mock_om.objects.filter.return_value.select_related.return_value = [
            _member("org-1")
        ]
        session = self._valid_session()
        del session["email_change_code_hash"]

        with patch("backend.graphene.mutations.account.settings") as mock_settings:
            mock_settings.APP_HOST = "self"
            info = _make_info(user, session=session)
            with patch(
                "api.views.auth_password.username_for_email",
                return_value="new@example.com",
            ):
                result = self._mutate(info, code=None, keyrings=[_keyring_input("org-1")])

        assert result.ok is True
        assert user.email == "new@example.com"
        # No code verification happened
        mock_check.assert_not_called()

    @patch("api.views.auth_password._smtp_configured", return_value=True)
    @patch("api.views.auth_password._skip_email_verification", return_value=False)
    @patch("django.contrib.auth.get_user_model")
    def test_codeless_pending_rejected_when_smtp_configured(
        self, mock_get_user, mock_skip, mock_smtp, mock_fresh, mock_locked,
        mock_scim, mock_check, mock_om, mock_tx, mock_login, mock_stamp,
        mock_alert,
    ):
        """A forged/stale no-code pending state must not bypass
        verification on an instance that does have SMTP."""
        self._setup_user_model(mock_get_user, _make_user())
        user = _make_user(has_password=False)
        session = self._valid_session()
        del session["email_change_code_hash"]

        info = _make_info(user, session=session)
        with pytest.raises(GraphQLError, match="No pending email change"):
            self._mutate(info, code=None, keyrings=[])
        assert user.email == "old@example.com"

    @patch("django.contrib.auth.get_user_model")
    def test_incomplete_keyrings_rejected(
        self, mock_get_user, mock_fresh, mock_locked, mock_scim, mock_check,
        mock_om, mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        """Every keyring-bearing membership must be re-wrapped in one
        ceremony — a partial submission must abort before the email flips,
        never brick the un-submitted org."""
        mock_check.return_value = True
        self._setup_user_model(mock_get_user, _make_user())

        user = _make_user(has_password=False)
        info = _make_info(user, session=self._valid_session())
        # User is in two keyring-bearing orgs...
        mock_om.objects.filter.return_value.select_related.return_value = [
            _member("org-1"),
            _member("org-2"),
        ]
        # ...but the client only submitted one.
        with pytest.raises(GraphQLError, match="not re-encrypted for all"):
            self._mutate(info, keyrings=[_keyring_input("org-1")])

        # Nothing was mutated — the email did not flip.
        assert user.email == "old@example.com"
        user.save.assert_not_called()
        mock_login.assert_not_called()

    @patch("django.contrib.auth.get_user_model")
    def test_sso_user_happy_path(
        self, mock_get_user, mock_fresh, mock_locked, mock_scim, mock_check,
        mock_om, mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        mock_check.return_value = True
        self._setup_user_model(mock_get_user, _make_user())
        mock_tx.atomic.return_value.__enter__ = MagicMock()
        mock_tx.atomic.return_value.__exit__ = MagicMock(return_value=False)
        mock_tx.on_commit.side_effect = lambda cb: cb()

        user = _make_user(has_password=False)
        member = _member("org-1", role="Owner")
        mock_om.objects.filter.return_value.select_related.return_value = [member]

        with patch("backend.graphene.mutations.account.settings") as mock_settings:
            mock_settings.APP_HOST = "self"
            info = _make_info(user, session=self._valid_session())
            with patch(
                "api.views.auth_password.username_for_email",
                return_value="new@example.com",
            ):
                result = self._mutate(info, keyrings=[_keyring_input("org-1")])

        assert result.ok is True
        # Keyring re-wrapped for the org
        assert member.wrapped_keyring == "wk-org-1"
        assert member.wrapped_recovery == "wr-org-1"
        member.save.assert_called_once()
        # SSO user: email/username updated, password NOT rotated
        assert user.email == "new@example.com"
        user.set_password.assert_not_called()
        user.save.assert_called_once()
        _, save_kwargs = user.save.call_args
        assert set(save_kwargs["update_fields"]) == {"email", "username"}
        # Session re-established + freshness re-stamped; pending cleared
        mock_login.assert_called_once()
        mock_stamp.assert_called_once()
        assert "email_change_new_email" not in info.context.session
        mock_alert.assert_called_once()

    @patch("django.contrib.auth.get_user_model")
    def test_password_user_happy_path_rotates_password(
        self, mock_get_user, mock_fresh, mock_locked, mock_scim, mock_check,
        mock_om, mock_tx, mock_login, mock_stamp, mock_alert,
    ):
        mock_check.return_value = True
        self._setup_user_model(mock_get_user, _make_user())
        mock_tx.atomic.return_value.__enter__ = MagicMock()
        mock_tx.atomic.return_value.__exit__ = MagicMock(return_value=False)
        mock_tx.on_commit.side_effect = lambda cb: cb()

        user = _make_user(has_password=True)
        user.check_password.return_value = True
        member = _member("org-1")
        mock_om.objects.filter.return_value.select_related.return_value = [member]

        with patch("backend.graphene.mutations.account.settings") as mock_settings:
            mock_settings.APP_HOST = "self"
            info = _make_info(user, session=self._valid_session())
            with patch(
                "api.views.auth_password.username_for_email",
                return_value="new@example.com",
            ):
                result = self._mutate(
                    info,
                    keyrings=[_keyring_input("org-1")],
                    current_auth_hash="cur",
                    new_auth_hash="new",
                )

        assert result.ok is True
        user.set_password.assert_called_once_with("new")
        _, save_kwargs = user.save.call_args
        assert set(save_kwargs["update_fields"]) == {"email", "username", "password"}
