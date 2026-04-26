from django.conf import settings
from django.contrib.auth import logout as django_logout
from django.utils import timezone

from api.models import (
    Organisation,
    OrganisationMember,
    OrganisationSSOProvider,
)
from api.utils.access.permissions import user_has_permission
from api.utils.network import validate_url_is_safe
from api.utils.sso import (
    ORG_SSO_PROVIDER_REGISTRY,
    get_org_provider_meta,
    resolve_issuer,
    validate_provider_config,
)
from django.core.exceptions import ValidationError
import graphene
import logging
from graphql import GraphQLError

logger = logging.getLogger(__name__)

CLOUD_HOSTED = settings.APP_HOST == "cloud"


def _check_sso_entitlement(org):
    """Verify the org is entitled to use SSO.

    Cloud: org must be on the Enterprise plan.
    Self-hosted: requires an active ActivatedPhaseLicense (checked at adapter level).
    """
    if CLOUD_HOSTED and org.plan != Organisation.ENTERPRISE_PLAN:
        raise GraphQLError(
            "SSO is available on the Enterprise plan. Please upgrade to configure SSO."
        )


class CreateOrganisationSSOProviderMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        provider_type = graphene.String(required=True)
        name = graphene.String(required=True)
        config = graphene.JSONString(required=True)

    provider_id = graphene.ID()

    @classmethod
    def mutate(cls, root, info, org_id, provider_type, name, config):
        user = info.context.user
        org = Organisation.objects.get(id=org_id)

        if not user_has_permission(user, "create", "SSO", org):
            raise GraphQLError(
                "You don't have the permissions required to configure SSO in this organisation"
            )

        _check_sso_entitlement(org)

        meta = get_org_provider_meta(provider_type)
        if not meta:
            raise GraphQLError(f"Unsupported provider type: {provider_type}")

        if OrganisationSSOProvider.objects.filter(
            organisation=org, provider_type=provider_type
        ).exists():
            raise GraphQLError(
                f"An SSO provider of type '{meta['label']}' is already configured for this organisation"
            )

        try:
            validate_provider_config(provider_type, config, require_secret=True)
        except ValueError as e:
            raise GraphQLError(str(e))

        member = OrganisationMember.objects.get(
            user=user, organisation=org, deleted_at=None
        )

        provider = OrganisationSSOProvider.objects.create(
            organisation=org,
            provider_type=provider_type,
            name=name,
            config=config,
            enabled=False,
            created_by=member,
            updated_by=member,
        )

        return CreateOrganisationSSOProviderMutation(provider_id=provider.id)


class UpdateOrganisationSSOProviderMutation(graphene.Mutation):
    class Arguments:
        provider_id = graphene.ID(required=True)
        name = graphene.String()
        config = graphene.JSONString()
        enabled = graphene.Boolean()

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, provider_id, name=None, config=None, enabled=None):
        user = info.context.user
        provider = OrganisationSSOProvider.objects.get(id=provider_id)

        if not user_has_permission(user, "update", "SSO", provider.organisation):
            raise GraphQLError(
                "You don't have the permissions required to update SSO in this organisation"
            )

        _check_sso_entitlement(provider.organisation)

        member = OrganisationMember.objects.get(
            user=user, organisation=provider.organisation, deleted_at=None
        )

        if name is not None:
            provider.name = name

        if config is not None:
            existing_config = provider.config.copy()
            secret_was_provided = False
            for key, value in config.items():
                if key == "client_secret" and not value:
                    continue
                if key == "client_secret":
                    secret_was_provided = True
                existing_config[key] = value
            try:
                validate_provider_config(
                    provider.provider_type,
                    existing_config,
                    require_secret=secret_was_provided,
                )
            except ValueError as e:
                raise GraphQLError(str(e))
            provider.config = existing_config

        if enabled is not None:
            if enabled:
                # Enabling this provider — deactivate all others in the org
                OrganisationSSOProvider.objects.filter(
                    organisation=provider.organisation, enabled=True
                ).exclude(id=provider_id).update(enabled=False)
            elif provider.enabled and provider.organisation.require_sso:
                # Deactivating the currently-active provider while SSO is
                # enforced would lock everyone (including this admin) out
                # on their next request, since no provider would be able
                # to authenticate them. Mirror the delete-mutation policy:
                # turn enforcement off when the last active provider goes
                # inactive. The admin can re-enforce after (re-)activating.
                still_has_active = (
                    OrganisationSSOProvider.objects.filter(
                        organisation=provider.organisation, enabled=True
                    )
                    .exclude(id=provider_id)
                    .exists()
                )
                if not still_has_active:
                    provider.organisation.require_sso = False
                    provider.organisation.save()
                    from backend.graphene.middleware import (
                        OrgSSOEnforcementMiddleware,
                    )
                    OrgSSOEnforcementMiddleware.invalidate_decision(
                        provider.organisation_id
                    )
            provider.enabled = enabled

        provider.updated_by = member
        provider.save()

        return UpdateOrganisationSSOProviderMutation(ok=True)


class DeleteOrganisationSSOProviderMutation(graphene.Mutation):
    class Arguments:
        provider_id = graphene.ID(required=True)

    ok = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, provider_id):
        user = info.context.user
        provider = OrganisationSSOProvider.objects.get(id=provider_id)

        if not user_has_permission(user, "delete", "SSO", provider.organisation):
            raise GraphQLError(
                "You don't have the permissions required to delete SSO in this organisation"
            )

        # If this was the active provider and SSO was enforced, turn off enforcement
        if provider.enabled and provider.organisation.require_sso:
            provider.organisation.require_sso = False
            provider.organisation.save()
            from backend.graphene.middleware import OrgSSOEnforcementMiddleware
            OrgSSOEnforcementMiddleware.invalidate_decision(
                provider.organisation_id
            )

        provider.delete()

        return DeleteOrganisationSSOProviderMutation(ok=True)


class TestOrganisationSSOProviderMutation(graphene.Mutation):
    class Arguments:
        provider_id = graphene.ID(required=True)

    success = graphene.Boolean()
    error = graphene.String()

    @classmethod
    def mutate(cls, root, info, provider_id):
        from api.views.sso import _safe_oidc_request

        user = info.context.user
        provider = OrganisationSSOProvider.objects.get(id=provider_id)

        if not user_has_permission(user, "update", "SSO", provider.organisation):
            raise GraphQLError(
                "You don't have the permissions required to test SSO in this organisation"
            )

        # Build OIDC discovery URL from config
        issuer = resolve_issuer(provider.provider_type, provider.config)
        if not issuer:
            return TestOrganisationSSOProviderMutation(
                success=False, error="Unsupported provider type"
            )

        if CLOUD_HOSTED:
            try:
                validate_url_is_safe(issuer)
            except ValidationError:
                return TestOrganisationSSOProviderMutation(
                    success=False,
                    error="Issuer URL is not a valid public HTTPS endpoint",
                )

        discovery_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
        # Route through _safe_oidc_request so a 302 redirect from a public
        # issuer can't pivot the fetch to an internal target (cloud) — the
        # helper sets allow_redirects=False and re-validates URLs on cloud.
        try:
            resp = _safe_oidc_request("GET", discovery_url, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if "authorization_endpoint" not in data or "token_endpoint" not in data:
                return TestOrganisationSSOProviderMutation(
                    success=False,
                    error="OIDC discovery document is missing required endpoints",
                )
            return TestOrganisationSSOProviderMutation(success=True, error=None)
        except Exception as e:
            # Don't surface upstream response bodies or internal error
            # detail to the client — that would leak info from whatever
            # host the (possibly-malicious) issuer pointed at. Log the
            # real error server-side, return a generic message.
            logger.warning(
                f"OIDC discovery failed for provider {provider_id}: {e}"
            )
            return TestOrganisationSSOProviderMutation(
                success=False,
                error="Failed to reach the OIDC provider. Check the issuer URL and try again.",
            )


class UpdateOrganisationSecurityMutation(graphene.Mutation):
    class Arguments:
        org_id = graphene.ID(required=True)
        require_sso = graphene.Boolean(required=True)

    ok = graphene.Boolean()
    session_invalidated = graphene.Boolean()

    @classmethod
    def mutate(cls, root, info, org_id, require_sso):
        user = info.context.user
        org = Organisation.objects.get(id=org_id)

        if not user_has_permission(user, "update", "SSO", org):
            raise GraphQLError(
                "You don't have the permissions required to update SSO settings"
            )

        if require_sso:
            # Must have at least one enabled SSO provider
            if not OrganisationSSOProvider.objects.filter(
                organisation=org, enabled=True
            ).exists():
                raise GraphQLError(
                    "Cannot enforce SSO without an active SSO provider"
                )

        org.require_sso = require_sso
        org.save()

        from backend.graphene.middleware import OrgSSOEnforcementMiddleware
        OrgSSOEnforcementMiddleware.invalidate_decision(org.id)

        # When enabling enforcement, immediately invalidate the admin's own
        # session so they are forced to re-authenticate via SSO. This is a
        # clean break — no half-state where this session keeps working on
        # the page it's on but fails on the next navigation. Other users'
        # sessions are invalidated passively by OrgSSOEnforcementMiddleware
        # on their next org-scoped query.
        session_invalidated = False
        if require_sso and info.context.session.get("auth_method") != "sso":
            django_logout(info.context)
            session_invalidated = True

        return UpdateOrganisationSecurityMutation(
            ok=True, session_invalidated=session_invalidated
        )
