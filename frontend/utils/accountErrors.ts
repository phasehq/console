// Error codes surfaced by the SSO link callback redirect (/account?error=)
// mapped to user-facing copy. Identity/MFA management errors now arrive as
// GraphQL error messages and are shown directly.
const ERROR_MESSAGES: Record<string, string> = {
  identity_in_use:
    'This sign-in identity is already linked to a different account. Contact support if you believe this is a mistake.',
  not_verified:
    'The identity provider reports this email address as unverified. Verify it with your provider and try again.',
  link_failed: 'Something went wrong while linking this sign-in method. Please try again.',
  session_changed: 'Your session changed while linking. Please try again.',
  link_session_stale:
    'Your session expired before linking finished. Please sign in again and retry.',
  not_a_member: 'You are not a member of the organisation that this SSO provider belongs to.',
  email_domain_not_allowed: 'This email domain is not allowed on this instance.',
  last_method: 'You must keep at least one sign-in method.',
  org_enforced: 'Your organisation requires this sign-in method.',
  scim_managed: 'Your organisation manages this sign-in method.',
  invalid_state: 'The sign-in flow expired or was tampered with. Please try again.',
  missing_code_or_state: 'The sign-in flow was incomplete. Please try again.',
  token_exchange_failed: 'Could not complete authentication with the provider. Please try again.',
  no_access_token: 'Could not complete authentication with the provider. Please try again.',
  sso_config_not_found: 'This SSO provider is no longer configured. Contact your administrator.',
  unsupported_provider: 'This sign-in provider is not supported on this instance.',
  unknown_provider: 'This sign-in provider is not supported on this instance.',
  login_failed: 'Sign-in failed. Please try again.',
  authentication_failed: 'Authentication with the provider failed. Please try again.',
}

// Fallback is generic on purpose — backend/IdP error strings (e.g. a
// forwarded error_description) must not be surfaced verbatim.
export const accountErrorMessage = (code: string): string =>
  ERROR_MESSAGES[code] || 'Something went wrong. Please try again.'

// The account page bounces stale sessions here to re-authenticate before a
// sensitive action; the Apollo errorLink owns the redirect on REAUTH_REQUIRED.
export const REAUTH_URL = '/login?callbackUrl=%2Faccount&reauth=1'

// True for the fresh-session gate error. Callers use this only to skip their
// own toast — the errorLink performs the redirect.
export const isReauthError = (message?: string | null): boolean =>
  !!message && message.includes('reauth_required')
