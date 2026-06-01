"""Unit tests for AutoLinkSocialAccountAdapter (F2 of QA batch 1).

The adapter currently isn't invoked in the product SSO flow (which
bypasses allauth's `complete_social_login`), but it is still registered
globally via `SOCIALACCOUNT_ADAPTER`. Anything that does flow through
allauth — Django admin OAuth, future allauth-based code paths,
third-party deps — would invoke it. The auto-link must only fire when
the IdP's `email_verified` claim isn't explicitly False.
"""

from unittest.mock import MagicMock, patch


def _make_sociallogin(email, extra_data, is_existing=False):
    sociallogin = MagicMock()
    sociallogin.is_existing = is_existing
    sociallogin.user = MagicMock(email=email)
    sociallogin.account = MagicMock(
        provider="okta-oidc",
        uid="idp-uid-123",
        extra_data=extra_data,
    )
    return sociallogin


@patch("api.authentication.adapters.social.SocialAccount")
@patch("api.authentication.adapters.social.User")
def test_skips_link_when_email_explicitly_unverified(MockUser, MockSocialAccount):
    """`email_verified=False` is the only blocker — a malicious or
    misconfigured IdP claiming another user's email must not be silently
    linked to that account."""
    from api.authentication.adapters.social import AutoLinkSocialAccountAdapter

    adapter = AutoLinkSocialAccountAdapter()
    sociallogin = _make_sociallogin(
        email="victim@example.com",
        extra_data={"email_verified": False},
    )

    adapter.pre_social_login(request=MagicMock(), sociallogin=sociallogin)

    # Neither the lookup nor the link should have happened.
    MockUser.objects.get.assert_not_called()
    MockSocialAccount.objects.get_or_create.assert_not_called()


@patch("api.authentication.adapters.social.SocialAccount")
@patch("api.authentication.adapters.social.User")
def test_links_when_email_verified_true(MockUser, MockSocialAccount):
    existing = MagicMock()
    MockUser.objects.get.return_value = existing
    sa = MagicMock()
    MockSocialAccount.objects.get_or_create.return_value = (sa, True)

    from api.authentication.adapters.social import AutoLinkSocialAccountAdapter

    adapter = AutoLinkSocialAccountAdapter()
    sociallogin = _make_sociallogin(
        email="alice@example.com",
        extra_data={"email_verified": True},
    )

    adapter.pre_social_login(request=MagicMock(), sociallogin=sociallogin)

    MockUser.objects.get.assert_called_once_with(email="alice@example.com")
    MockSocialAccount.objects.get_or_create.assert_called_once()


@patch("api.authentication.adapters.social.SocialAccount")
@patch("api.authentication.adapters.social.User")
def test_links_when_email_verified_absent(MockUser, MockSocialAccount):
    """Some IdPs (Microsoft work accounts, older OIDC) don't emit the
    claim. Those flow through — the adapter trusts the IdP at the
    registration level. Only an explicit False is a blocker."""
    existing = MagicMock()
    MockUser.objects.get.return_value = existing
    sa = MagicMock()
    MockSocialAccount.objects.get_or_create.return_value = (sa, True)

    from api.authentication.adapters.social import AutoLinkSocialAccountAdapter

    adapter = AutoLinkSocialAccountAdapter()
    sociallogin = _make_sociallogin(
        email="alice@example.com",
        extra_data={},  # no email_verified key at all
    )

    adapter.pre_social_login(request=MagicMock(), sociallogin=sociallogin)

    MockUser.objects.get.assert_called_once()
    MockSocialAccount.objects.get_or_create.assert_called_once()
