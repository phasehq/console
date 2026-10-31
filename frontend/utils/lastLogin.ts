// "Last used" sign-in memory for the login page.
//
// Remembers which accounts signed in on this browser, and how, so /login can
// offer a one-click "continue as …" chooser and mark the matching method as
// "Last used". localStorage is per-origin, so Phase Cloud and every
// self-hosted instance each keep their own list.
//
//   phase-last-login     Accounts that signed in here, most recent first.
//                        Synced from /auth/me on every app load — the
//                        current session is, by definition, the most recent
//                        sign-in on this browser.
//   phase-pending-login  An SSO attempt in flight. SSO completes off-page
//                        (IdP round trip, possibly /login/mfa), so the attempt
//                        only carries the display details the session can't
//                        (org provider name, org name) and is never recorded
//                        unless /auth/me confirms the session came from it.
//                        A cancelled or failed attempt is never remembered.
//
// This is a convenience hint, never an auth input: every read tolerates
// missing, corrupt or foreign data, and every write tolerates storage being
// unavailable (private browsing, quota, disabled storage).

export type LoginMethod =
  | { kind: 'password' }
  // Instance-level provider, keyed by its authorize-URL slug (e.g. 'google')
  | { kind: 'instance-sso'; slug: string }
  // Org-level SSO provider config. Display details are captured at click
  // time so the chooser can render without another lookup.
  | {
      kind: 'org-sso'
      id: string
      provider?: string
      providerName?: string
      organisationName?: string
    }

export type SsoLoginMethod = Exclude<LoginMethod, { kind: 'password' }>

export type RememberedLogin = {
  email: string
  method: LoginMethod
  lastUsedAt: number
}

// The parts of /auth/me that say how the current session was established.
// The per-provider markers are absent on backends that predate them.
export type SessionAuthInfo = {
  email: string
  authMethod: string
  authSsoOrgId?: string | null
  authSsoProviderId?: string | null
  authSsoProviderSlug?: string | null
}

export const LAST_LOGIN_STORAGE_KEY = 'phase-last-login'
export const PENDING_LOGIN_STORAGE_KEY = 'phase-pending-login'
const STORAGE_VERSION = 1

export const MAX_REMEMBERED_LOGINS = 3
// Accounts unused on this browser for ~6 months are dropped.
export const REMEMBERED_LOGIN_TTL_MS = 180 * 24 * 60 * 60 * 1000
// Covers a slow IdP login plus the 10 minute TOTP challenge.
export const PENDING_LOGIN_TTL_MS = 30 * 60 * 1000

// Same-tab change signal; other tabs get the native `storage` event.
const CHANGE_EVENT = 'phase:last-login-change'

// --- Storage access ---------------------------------------------------------

const getStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Merely touching localStorage throws when storage is blocked
    return null
  }
}

const readRaw = (key: string): string | null => {
  try {
    return getStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

const writeRaw = (key: string, value: string | null) => {
  const storage = getStorage()
  if (!storage) return
  try {
    if (value === null) storage.removeItem(key)
    else storage.setItem(key, value)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // Quota exceeded or storage disabled — remembering is best-effort
  }
}

const parseJson = (raw: string | null): unknown => {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// --- Validation ---------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Slugs and config ids are only ever used in authorize URLs after being
// matched against what the server currently offers — but keep them URL-safe
// regardless of what ends up in storage.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const safeId = (value: unknown): string | undefined =>
  typeof value === 'string' && SAFE_ID_RE.test(value) ? value : undefined

const displayText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value.length <= 200 ? value : undefined

export const normaliseEmail = (email: string) => email.trim().toLowerCase()

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/
const validEmail = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const email = normaliseEmail(value)
  return email.length <= 254 && EMAIL_RE.test(email) ? email : undefined
}

export const parseLoginMethod = (raw: unknown): LoginMethod | null => {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'password':
      return { kind: 'password' }
    case 'instance-sso': {
      const slug = safeId(raw.slug)
      return slug ? { kind: 'instance-sso', slug } : null
    }
    case 'org-sso': {
      const id = safeId(raw.id)
      if (!id) return null
      const method: LoginMethod = { kind: 'org-sso', id }
      const provider = safeId(raw.provider)
      const providerName = displayText(raw.providerName)
      const organisationName = displayText(raw.organisationName)
      if (provider) method.provider = provider
      if (providerName) method.providerName = providerName
      if (organisationName) method.organisationName = organisationName
      return method
    }
    default:
      return null
  }
}

export const isSameLoginMethod = (
  a: LoginMethod | null | undefined,
  b: LoginMethod | null | undefined
): boolean => {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'instance-sso') return a.slug === (b as typeof a).slug
  if (a.kind === 'org-sso') return a.id === (b as typeof a).id
  return true
}

// --- Remembered logins --------------------------------------------------------

const parseRememberedLogin = (raw: unknown, now: number): RememberedLogin | null => {
  if (!isRecord(raw)) return null
  const email = validEmail(raw.email)
  const method = parseLoginMethod(raw.method)
  const lastUsedAt = raw.lastUsedAt
  if (!email || !method || typeof lastUsedAt !== 'number' || !Number.isFinite(lastUsedAt)) {
    return null
  }
  if (now - lastUsedAt > REMEMBERED_LOGIN_TTL_MS) return null
  // A clock that jumped backwards must not pin an entry to the top forever
  return { email, method, lastUsedAt: Math.min(lastUsedAt, now) }
}

/** Parse the stored list: drops invalid, expired and duplicate entries,
 *  most recent first, capped. Never throws. */
export const parseRememberedLogins = (
  raw: string | null,
  now: number = Date.now()
): RememberedLogin[] => {
  const data = parseJson(raw)
  if (!isRecord(data) || data.v !== STORAGE_VERSION || !Array.isArray(data.logins)) return []

  const byEmail = new Map<string, RememberedLogin>()
  for (const item of data.logins) {
    const login = parseRememberedLogin(item, now)
    if (!login) continue
    const existing = byEmail.get(login.email)
    if (!existing || login.lastUsedAt > existing.lastUsedAt) byEmail.set(login.email, login)
  }

  return Array.from(byEmail.values())
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, MAX_REMEMBERED_LOGINS)
}

export const readRememberedLoginsSnapshot = (): string | null => readRaw(LAST_LOGIN_STORAGE_KEY)

export const getRememberedLogins = (now: number = Date.now()): RememberedLogin[] =>
  parseRememberedLogins(readRememberedLoginsSnapshot(), now)

const writeRememberedLogins = (logins: RememberedLogin[]) =>
  writeRaw(
    LAST_LOGIN_STORAGE_KEY,
    logins.length ? JSON.stringify({ v: STORAGE_VERSION, logins }) : null
  )

/** Record a sign-in, moving the account to the top of the list. */
export const rememberLogin = (email: string, method: LoginMethod, now: number = Date.now()) => {
  const validatedEmail = validEmail(email)
  const validatedMethod = parseLoginMethod(method)
  if (!validatedEmail || !validatedMethod) return

  const others = getRememberedLogins(now).filter((login) => login.email !== validatedEmail)
  writeRememberedLogins(
    [{ email: validatedEmail, method: validatedMethod, lastUsedAt: now }, ...others].slice(
      0,
      MAX_REMEMBERED_LOGINS
    )
  )
}

/** Remove an account from this browser's list. */
export const forgetLogin = (email: string) => {
  const target = normaliseEmail(email)
  const logins = getRememberedLogins()
  writeRememberedLogins(logins.filter((login) => login.email !== target))
}

export const findRememberedLogin = (
  logins: RememberedLogin[],
  email: string | null | undefined
): RememberedLogin | undefined => {
  if (!email) return undefined
  const target = normaliseEmail(email)
  return logins.find((login) => login.email === target)
}

/** Subscribe to changes from this tab and others (useSyncExternalStore). */
export const subscribeToRememberedLogins = (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    // key is null when another tab cleared all storage
    if (event.key === null || event.key === LAST_LOGIN_STORAGE_KEY) onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

// --- Pending SSO attempts -----------------------------------------------------

type PendingLogin = { method: SsoLoginMethod; startedAt: number }

const parsePendingLogin = (raw: string | null, now: number): PendingLogin | null => {
  const data = parseJson(raw)
  if (!isRecord(data) || data.v !== STORAGE_VERSION) return null
  const method = parseLoginMethod(data.method)
  const startedAt = data.startedAt
  if (!method || method.kind === 'password') return null
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null
  if (now - startedAt > PENDING_LOGIN_TTL_MS) return null
  return { method, startedAt }
}

/** Note an SSO attempt just before redirecting to the identity provider. */
export const setPendingLogin = (method: SsoLoginMethod, now: number = Date.now()) => {
  const validated = parseLoginMethod(method)
  if (!validated || validated.kind === 'password') return
  writeRaw(
    PENDING_LOGIN_STORAGE_KEY,
    JSON.stringify({ v: STORAGE_VERSION, method: validated, startedAt: now })
  )
}

export const clearPendingLogin = () => writeRaw(PENDING_LOGIN_STORAGE_KEY, null)

// --- Syncing from the session -------------------------------------------------

/**
 * The method that established `session`, or null when it can't be known.
 * `consumedPending` is true when the pending attempt is the one that
 * produced this session.
 */
export const resolveSessionLoginMethod = (
  session: SessionAuthInfo,
  pending: PendingLogin | null,
  existing: RememberedLogin | undefined
): { method: LoginMethod; consumedPending: boolean } | null => {
  if (session.authMethod === 'password') {
    return { method: { kind: 'password' }, consumedPending: false }
  }
  if (session.authMethod !== 'sso') return null

  const slug = safeId(session.authSsoProviderSlug)
  if (slug) {
    const method: LoginMethod = { kind: 'instance-sso', slug }
    return { method, consumedPending: isSameLoginMethod(pending?.method, method) }
  }

  const configId = safeId(session.authSsoProviderId)
  if (configId) {
    // The session only knows the config id — keep the display details
    // captured for this exact provider, if any.
    const bare: LoginMethod = { kind: 'org-sso', id: configId }
    const known = [pending?.method, existing?.method].find((m) => isSameLoginMethod(m, bare))
    return {
      method: known ?? bare,
      consumedPending: isSameLoginMethod(pending?.method, bare),
    }
  }

  // No per-provider marker (an older backend, or a session from before
  // markers existed): org vs instance SSO is all that's known, so only
  // trust a pending attempt or existing record of the same type.
  const isOrg = Boolean(session.authSsoOrgId)
  const fits = (m: LoginMethod | undefined) => m?.kind === (isOrg ? 'org-sso' : 'instance-sso')
  if (pending && fits(pending.method)) return { method: pending.method, consumedPending: true }
  if (existing && fits(existing.method)) return { method: existing.method, consumedPending: false }
  return null
}

/**
 * Record how the current session signed in. Called whenever /auth/me
 * resolves; a pending attempt that doesn't match is left to expire, since
 * another tab may still be completing it.
 */
export const syncLastLogin = (session: SessionAuthInfo, now: number = Date.now()) => {
  const email = validEmail(session.email)
  if (!email) return

  const rawPending = readRaw(PENDING_LOGIN_STORAGE_KEY)
  const pending = parsePendingLogin(rawPending, now)
  if (rawPending !== null && !pending) clearPendingLogin() // expired or unreadable

  const existing = findRememberedLogin(getRememberedLogins(now), email)
  const resolved = resolveSessionLoginMethod(session, pending, existing)
  if (!resolved) return

  if (resolved.consumedPending) clearPendingLogin()
  rememberLogin(email, resolved.method, now)
}
