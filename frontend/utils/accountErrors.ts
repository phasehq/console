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

// The account page bounces stale sessions to /login to re-authenticate
// before a sensitive action; the Apollo errorLink owns the redirect on
// REAUTH_REQUIRED. The callbackUrl carries the interrupted flow's state as
// query params (action, step, ...) so the page can restore it post-reauth.
export const buildReauthUrl = (returnTo: string): string =>
  `/login?callbackUrl=${encodeURIComponent(returnTo)}&reauth=1`

export const REAUTH_URL = buildReauthUrl('/account')

type ReauthStateGetter = () => Record<string, string>

let reauthStateGetter: ReauthStateGetter | null = null

// An open dialog registers a getter describing its restorable state (never
// passwords or codes). Returns an unregister function; unregistering only
// clears its own getter so an out-of-order cleanup can't drop a newer one.
export const registerReauthState = (getter: ReauthStateGetter): (() => void) => {
  reauthStateGetter = getter
  return () => {
    if (reauthStateGetter === getter) reauthStateGetter = null
  }
}

type ReauthPromptListener = (loginUrl: string) => void

let reauthPromptListener: ReauthPromptListener | null = null

// Mounted by the account page: shows a confirm dialog before the reauth
// redirect so the user can back out instead of being yanked to /login.
export const registerReauthPromptListener = (listener: ReauthPromptListener): (() => void) => {
  reauthPromptListener = listener
  return () => {
    if (reauthPromptListener === listener) reauthPromptListener = null
  }
}

// True when a mounted prompt took over; false tells the caller to fall back
// to a hard redirect (no prompt on this page).
export const requestReauthPrompt = (loginUrl: string): boolean => {
  if (!reauthPromptListener) return false
  reauthPromptListener(loginUrl)
  return true
}

// Where the errorLink sends a stale session: back to the current page, with
// the active dialog's state (if any) in the query string. Any stale search
// params on the current URL are dropped.
export const reauthRedirectUrl = (): string => {
  const path = typeof window === 'undefined' ? '/account' : window.location.pathname
  const state = reauthStateGetter?.()
  if (state && Object.keys(state).length > 0) {
    return buildReauthUrl(`${path}?${new URLSearchParams(state).toString()}`)
  }
  return buildReauthUrl(path)
}

// True for the fresh-session gate error. Callers use this only to skip their
// own toast — the errorLink performs the redirect.
export const isReauthError = (message?: string | null): boolean =>
  !!message && message.includes('reauth_required')
