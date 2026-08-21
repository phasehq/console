// Error codes returned by the backend account-management flows
// (/auth/identities/* and the SSO link callback) mapped to user-facing copy.
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
  token_exchange_failed: 'Could not complete authentication with the provider. Please try again.',
  authentication_failed: 'Authentication with the provider failed. Please try again.',
}

export const accountErrorMessage = (code: string): string =>
  ERROR_MESSAGES[code] || `Something went wrong: ${code}`
