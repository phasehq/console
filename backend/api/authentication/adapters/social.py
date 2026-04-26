import logging

from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)

User = get_user_model()


class AutoLinkSocialAccountAdapter(DefaultSocialAccountAdapter):
    """
    Custom SocialAccountAdapter that automatically links social logins
    to existing users with matching email addresses.

    This is essential for SCIM-provisioned users: SCIM creates the
    CustomUser + OrganisationMember but no SocialAccount. Without this
    adapter, the first SSO login would fail with "User is already
    registered with this e-mail address."
    """

    def pre_social_login(self, request, sociallogin):
        # If the social account is already linked, nothing to do
        if sociallogin.is_existing:
            return

        email = sociallogin.user.email
        if not email:
            return

        try:
            existing_user = User.objects.get(email=email)
        except User.DoesNotExist:
            return

        # Link the social account to the existing user
        sociallogin.user = existing_user
        social_account, created = SocialAccount.objects.get_or_create(
            provider=sociallogin.account.provider,
            uid=sociallogin.account.uid,
            defaults={
                "user": existing_user,
                "extra_data": sociallogin.account.extra_data,
            },
        )

        if not created:
            social_account.extra_data = sociallogin.account.extra_data
            social_account.save()

        sociallogin.account = social_account

        logger.info(
            f"Auto-linked social account ({sociallogin.account.provider}) "
            f"to existing user {email}"
        )
