'use client'

import clsx from 'clsx'
import { useSession } from '@/contexts/userContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@apollo/client'
import { GetAccountIdentities } from '@/graphql/queries/account/getAccountIdentities.gql'
import Spinner from '../common/Spinner'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { LogoWordMark } from '../common/LogoWordMark'
import { getProviderName, orgProviderIcons, providerButtons } from './providerMeta'
import TotpVerifyForm, { TotpVerifySuccess } from './TotpVerifyForm'
import Link from 'next/link'
import { isCloudHosted } from '@/utils/appConfig'
import { Alert } from '../common/Alert'
import { FaArrowLeft, FaUserClock } from 'react-icons/fa'
import { FaEye, FaEyeSlash } from 'react-icons/fa'
import { decodeb64string, deviceVaultKey, passwordAuthHash } from '@/utils/crypto'
import { setDeviceKey } from '@/utils/localStorage'
import axios from 'axios'
import { UrlUtils, isSafeRedirectPath } from '@/utils/auth'
import { knownErrorMessage, loginNotice } from '@/utils/accountErrors'
import { useRememberedLogins } from '@/hooks/useRememberedLogins'
import {
  LoginMethod,
  RememberedLogin,
  SsoLoginMethod,
  findRememberedLogin,
  forgetLogin,
  isSameLoginMethod,
  setPendingLogin,
} from '@/utils/lastLogin'
import { LastUsedBadge } from './LastUsedBadge'
import { RememberedAccountList } from './RememberedAccountList'

const INVITE_PATH_RE = /^\/invite\/([^/?#]+)/

const extractInviteIdFromCallback = async (
  callbackUrl: string | null | undefined
): Promise<string | null> => {
  if (!callbackUrl) return null
  const match = callbackUrl.match(INVITE_PATH_RE)
  if (!match) return null
  try {
    return await decodeb64string(decodeURIComponent(match[1]))
  } catch {
    return null
  }
}

type SSOMethod = {
  id: string
  providerType: 'instance' | 'oidc'
  provider?: string
  providerName?: string
  organisationName?: string
  enforced: boolean
}

type LoginStep = 'email' | 'password' | 'sso-redirect' | 'totp'

const toLoginMethod = (method: SSOMethod): SsoLoginMethod =>
  method.providerType === 'oidc'
    ? {
        kind: 'org-sso',
        id: method.id,
        provider: method.provider,
        providerName: method.providerName,
        organisationName: method.organisationName,
      }
    : { kind: 'instance-sso', slug: method.id }

const OrDivider = () => (
  <div className="flex items-center gap-4">
    <div className="flex-1 h-px bg-neutral-500/20" />
    <span className="text-xs text-neutral-500 uppercase">or</span>
    <div className="flex-1 h-px bg-neutral-500/20" />
  </div>
)

export default function SignInButtons({
  providers,
  loginMessage,
  passwordAuthEnabled = false,
}: {
  providers: string[]
  loginMessage?: string | undefined | null
  passwordAuthEnabled?: boolean
}) {
  const [loading, setLoading] = useState<boolean>(false)
  const [checking, setChecking] = useState<boolean>(false)
  const [derivingKey, setDerivingKey] = useState<boolean>(false)
  const { data: sessionData, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  // A stale-but-valid session bounced here to re-authenticate before a
  // sensitive action (see the Apollo errorLink). We know who the user is.
  const isReauth = searchParams?.get('reauth') === '1'

  const [email, setEmail] = useState('')
  const [emailLocked, setEmailLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(true)
  const [step, setStep] = useState<LoginStep>('email')
  const [ssoProvider, setSsoProvider] = useState<string | null>(null)
  const [ssoMethods, setSsoMethods] = useState<SSOMethod[]>([])
  const [hasPassword, setHasPassword] = useState<boolean>(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)

  // Accounts that signed in on this browser before. When there are any, an
  // account chooser is shown ahead of the full form until the user picks
  // "Use another account".
  const rememberedLogins = useRememberedLogins()
  const [showSavedAccounts, setShowSavedAccounts] = useState(true)

  const passwordRef = useRef<HTMLInputElement>(null)
  const pendingDeviceKeyRef = useRef<string | null>(null)

  const hasSSOProviders = providers.length > 0

  // On reauth we know the account, so fetch its identities to offer only the
  // sign-in methods actually linked to it (null until loaded → show all).
  const { data: identitiesData } = useQuery(GetAccountIdentities, {
    skip: !isReauth || status !== 'authenticated',
    fetchPolicy: 'cache-and-network',
  })
  const reauthLinkedSlugs = useMemo(() => {
    const acc = identitiesData?.accountIdentities
    if (!acc) return null
    const linkedProviderIds = new Set((acc.identities ?? []).map((i: any) => i.provider))
    // Org- and instance-level identities share a provider_id, so a linked
    // ORG identity (e.g. org Entra) would otherwise light up the INSTANCE
    // button. Exclude provider_ids the user's org SSO serves — that identity
    // is the org one, and its org button appears via email lookup instead.
    const orgProviderIds = new Set((acc.availableOrgProviders ?? []).map((p: any) => p.providerId))
    return new Set<string>(
      (acc.availableInstanceProviders ?? [])
        .filter(
          (p: any) => linkedProviderIds.has(p.providerId) && !orgProviderIds.has(p.providerId)
        )
        .map((p: any) => p.slug)
    )
  }, [identitiesData])

  const redirectAfterLogin = () => {
    const callbackUrl = searchParams?.get('callbackUrl')
    // Same-origin relative paths only — see isSafeRedirectPath (guards
    // protocol-relative //evil.com and backslash /\evil.com bypasses).
    window.location.href = isSafeRedirectPath(callbackUrl) ? callbackUrl : '/'
  }

  const handleTotpSuccess = (data: TotpVerifySuccess) => {
    if (pendingDeviceKeyRef.current && data.userId) {
      setDeviceKey(data.userId, pendingDeviceKeyRef.current)
      pendingDeviceKeyRef.current = null
    }
    redirectAfterLogin()
  }

  useEffect(() => {
    let cancelled = false
    const prefillFromInvite = async () => {
      const inviteId = await extractInviteIdFromCallback(searchParams?.get('callbackUrl'))
      if (!inviteId) return
      try {
        const { data } = await axios.get(
          UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'invite', inviteId),
          { withCredentials: true }
        )
        if (!cancelled && data?.inviteeEmail) {
          setEmail(data.inviteeEmail)
          setEmailLocked(true)
        }
      } catch {
        // Invalid/expired invite — leave the email blank, user can enter manually
      }
    }
    prefillFromInvite()
    return () => {
      cancelled = true
    }
  }, [searchParams])

  // Pre-fill email from `?email=`. Lower precedence than invite-callback
  // pre-fill; left editable.
  useEffect(() => {
    const prefill = searchParams?.get('email')
    if (prefill && !emailLocked) {
      setEmail((current) => current || prefill)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Reauth: the session already identifies the user — lock their email so
  // they re-authenticate as themselves and can't retype a different address.
  useEffect(() => {
    const sessionEmail = sessionData?.user?.email
    if (isReauth && status === 'authenticated' && sessionEmail && !emailLocked) {
      setEmail(sessionEmail)
      setEmailLocked(true)
    }
  }, [isReauth, status, sessionData?.user?.email, emailLocked])

  const startSso = useCallback(
    (method: SsoLoginMethod) => {
      setLoading(true)
      // Only remembered as "last used" once /auth/me confirms this method
      // established the session (see utils/lastLogin).
      setPendingLogin(method)
      const callbackUrl = searchParams?.get('callbackUrl') || ''
      const qs = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''
      const path = method.kind === 'org-sso' ? `sso/org/${method.id}` : `sso/${method.slug}`
      window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/${path}/authorize/${qs}`
    },
    [searchParams]
  )

  const handleProviderButtonClick = useCallback(
    (providerId: string) => startSso({ kind: 'instance-sso', slug: providerId }),
    [startSso]
  )

  // `preferred` is the method a saved account used last time: if it's still
  // offered for this email, continue with it straight away.
  const checkEmail = async (emailToCheck: string, preferred?: LoginMethod) => {
    setChecking(true)
    try {
      const inviteId = await extractInviteIdFromCallback(searchParams?.get('callbackUrl'))
      const response = await axios.post(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'email', 'check'),
        {
          email: emailToCheck.toLowerCase().trim(),
          ...(inviteId ? { inviteId } : {}),
        },
        { withCredentials: true }
      )

      const { authMethods, authMethod, ssoProvider: legacyProvider } = response.data

      if (authMethods) {
        const methods = authMethods.sso as SSOMethod[]
        // Defence-in-depth: even if a stale backend reports password=true
        // before redeploy, never offer password when the operator has
        // disabled it.
        const passwordAvailable = passwordAuthEnabled ? (authMethods.password as boolean) : false
        setHasPassword(passwordAvailable)
        setSsoMethods(methods)

        const preferredSso = preferred
          ? methods.find((m) => isSameLoginMethod(toLoginMethod(m), preferred))
          : undefined

        if (preferredSso) {
          startSso(toLoginMethod(preferredSso))
        } else if (methods.length > 0 && !passwordAvailable) {
          // Only SSO available (no password set) — go straight to SSO
          const method = methods[0]
          setSsoProvider(method.id)
          setStep('sso-redirect')
        } else {
          // Password available (possibly with SSO options too).
          // SSO enforcement is handled at the org lobby, not the login page.
          setStep('password')
          setTimeout(() => passwordRef.current?.focus(), 100)
        }
      } else if (authMethod === 'sso' && legacyProvider) {
        // Legacy response format
        setSsoProvider(legacyProvider)
        setStep('sso-redirect')
      } else {
        setStep('password')
        setTimeout(() => passwordRef.current?.focus(), 100)
      }
    } catch {
      toast.error('Something went wrong. Please try again.', { autoClose: 5000 })
    } finally {
      setChecking(false)
    }
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    await checkEmail(email)
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return

    setDerivingKey(true)
    try {
      const trimmedEmail = email.toLowerCase().trim()
      // Derive authHash and deviceKey in parallel — both are independent
      // Argon2id derivations from the password.
      const [authHash, deviceKey] = await Promise.all([
        passwordAuthHash(password, trimmedEmail),
        rememberDevice ? deviceVaultKey(password, trimmedEmail) : Promise.resolve(null),
      ])

      const response = await axios.post(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'password', 'login'),
        { email: trimmedEmail, authHash },
        { withCredentials: true }
      )

      if (response.status === 200) {
        if (response.data?.mfaRequired) {
          // No session yet — hold the derived deviceKey until the TOTP
          // code verifies (the userId only arrives with the verify
          // response).
          pendingDeviceKeyRef.current = deviceKey
          setStep('totp')
          return
        }
        if (deviceKey && response.data?.userId) {
          setDeviceKey(response.data.userId, deviceKey)
        }
        redirectAfterLogin()
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        const msg = err.response.data?.error || 'Login failed'
        toast.error(msg, { autoClose: 5000 })
      } else {
        toast.error('Something went wrong. Please try again.', { autoClose: 5000 })
      }
    } finally {
      setDerivingKey(false)
    }
  }

  const handleBack = () => {
    setStep('email')
    setPassword('')
    setShowPw(false)
    setSsoProvider(null)
    setSsoMethods([])
    setHasPassword(true)
  }

  useEffect(() => {
    const providerId = searchParams?.get('provider')
    const error = searchParams?.get('error')
    const verified = searchParams?.get('verified')
    const ssoEnforced = searchParams?.get('sso_enforced')
    const notice = searchParams?.get('notice')

    if (notice) setNoticeMessage(loginNotice(notice))

    if (verified === 'true') {
      toast.success('Email verified! You can now log in.', { autoClose: 5000 })
    }

    if (ssoEnforced === 'true') {
      toast.info(
        'SSO enforcement is now active for your organisation. Please sign in via SSO to continue.',
        { autoClose: 8000 }
      )
    }

    if (error) {
      // Backend redirects bring either a short code (mapped to friendly
      // copy) or a curated human-readable message (shown verbatim) via
      // `?error=...`. Surface it persistently under the login box.
      setErrorMessage(knownErrorMessage(error) ?? error)
    }

    if (providerId) {
      const schedule =
        typeof window !== 'undefined' && 'requestIdleCallback' in window
          ? window.requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 100)

      schedule(() => {
        handleProviderButtonClick(providerId)
      })
    }
  }, [handleProviderButtonClick, searchParams])

  const isWorking = loading || checking || derivingKey

  const titleText = () => {
    if (loading) return 'Logging in...'
    if (checking) return 'Checking...'
    if (derivingKey) return 'Deriving keys...'
    return `Log in to Phase ${isCloudHosted() ? 'Cloud' : ''}`
  }

  useEffect(() => {
    // A stale-but-valid session sent here to re-authenticate
    // (?reauth=1) must be allowed to actually sign in again.
    if (status === 'authenticated' && searchParams?.get('reauth') !== '1') router.push('/')
  }, [router, searchParams, status])

  const maxBannerLength = 512
  const truncatedMessage = loginMessage?.slice(0, maxBannerLength)

  // The login form must render even during reauth, when the user is
  // technically still "authenticated" — otherwise the page is a dead end.
  const showLoginUi = status === 'unauthenticated' || (status === 'authenticated' && isReauth)

  // On reauth, offer only the instance providers the account has linked.
  const instanceProviderIds = providers.filter(
    (id) => !isReauth || !reauthLinkedSlugs || reauthLinkedSlugs.has(id)
  )
  const instanceButtons = providerButtons.filter((p) => instanceProviderIds.includes(p.id))

  // The account chooser comes first when this browser has signed in before
  // — unless the link already pins the sign-in to an account or flow.
  const chooserSkipped =
    isReauth ||
    emailLocked ||
    INVITE_PATH_RE.test(searchParams?.get('callbackUrl') ?? '') ||
    Boolean(searchParams?.get('email')) ||
    Boolean(searchParams?.get('provider')) ||
    searchParams?.get('verified') === 'true'
  const chooserAvailable = !chooserSkipped && rememberedLogins.length > 0
  const activeStep = step === 'email' && chooserAvailable && showSavedAccounts ? 'accounts' : step

  // "Last used" hints. Once an email is entered they describe that account;
  // on an empty form, this browser's most recent sign-in. Only shown where
  // there's more than one way in.
  const emailLogin = findRememberedLogin(rememberedLogins, email)
  const firstStepHint = email.trim() ? emailLogin : rememberedLogins[0]
  const continueLastUsed =
    instanceButtons.length > 0 &&
    (firstStepHint?.method.kind === 'password' || firstStepHint?.method.kind === 'org-sso')

  const continueWithRemembered = (login: RememberedLogin) => {
    const { method } = login
    // Instance providers need no lookup: straight to the IdP if still offered
    if (method.kind === 'instance-sso' && instanceProviderIds.includes(method.slug)) {
      startSso(method)
      return
    }
    // Password and org SSO resolve through the email check, which also copes
    // with a method that has since been disabled or reconfigured.
    setEmail(login.email)
    checkEmail(login.email, method)
  }

  const handleUseAnotherAccount = () => {
    setEmail('')
    setShowSavedAccounts(false)
  }

  // Org SSO and instance SSO offered after the email check
  const renderSsoMethodButton = (method: SSOMethod, primary: boolean) => {
    const loginMethod = toLoginMethod(method)
    const isOrg = method.providerType === 'oidc'
    const verb = primary ? 'Continue with' : 'Sign in with'
    // Disambiguate when the user has multiple org-level providers — same
    // provider name across different orgs would otherwise render as
    // identical buttons.
    const needsOrgSuffix =
      isOrg &&
      method.organisationName &&
      ssoMethods.filter((m) => m.providerName === method.providerName).length > 1
    const label = isOrg
      ? `${verb} ${method.providerName || 'SSO'}${needsOrgSuffix ? ` — ${method.organisationName}` : ''}`
      : `${verb} ${getProviderName(method.id)}`
    const icon = isOrg
      ? method.provider
        ? orgProviderIcons[method.provider]
        : undefined
      : providerButtons.find((p) => p.id === method.id)?.icon
    // On the SSO-only step a single option needs no hint
    const lastUsed =
      (!primary || ssoMethods.length > 1) && isSameLoginMethod(emailLogin?.method, loginMethod)

    return (
      <Button
        key={method.id}
        type="button"
        variant={primary ? 'primary' : 'outline'}
        size={primary ? 'lg' : 'md'}
        onClick={() => startSso(loginMethod)}
        icon={icon}
      >
        {label}
        {lastUsed && <LastUsedBadge tone={primary ? 'inverse' : 'default'} className="ml-1" />}
      </Button>
    )
  }

  // Build /signup URL forwarding email and callbackUrl when present so the
  // invite flow can resume after registration → verification → login.
  const signupHref = (() => {
    const params = new URLSearchParams()
    if (email) params.set('email', email)
    const callbackUrl = searchParams?.get('callbackUrl')
    if (callbackUrl) params.set('callbackUrl', callbackUrl)
    const qs = params.toString()
    return qs ? `/signup?${qs}` : '/signup'
  })()

  return (
    <div className="gap-y-4 flex flex-col items-center justify-center text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-col items-center justify-center">
        <div className={clsx(status === 'loading' && 'animate-pulse', 'mb-4')}>
          <LogoWordMark className="w-32 fill-neutral-500" />
        </div>
        <div className="text-lg font-medium pb-4 text-center flex items-center gap-4">
          {isWorking && <Spinner size="sm" />}
          {showLoginUi && titleText()}
        </div>
      </div>

      {showLoginUi && !loading && (
        <div>
          {isReauth && (
            <div className="mb-6 max-w-lg">
              <div className="flex items-center gap-3 rounded-lg ring-1 ring-inset ring-amber-500/40 bg-amber-300/40 dark:bg-amber-400/10 p-3">
                <div className="shrink-0 rounded-full bg-amber-400/20 p-2">
                  <FaUserClock className="size-4 text-amber-500" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-black dark:text-amber-400">
                    Confirm it&apos;s you
                  </div>
                  <div className="text-xs text-black/70 dark:text-neutral-400">
                    You&apos;re making a sensitive account change. Please sign in again to continue.
                  </div>
                </div>
              </div>
            </div>
          )}
          {noticeMessage && (
            <div className="mb-6 max-w-lg">
              <Alert variant="success" icon={true}>
                <div className="text-sm">{noticeMessage}</div>
              </Alert>
            </div>
          )}
          {loginMessage && (
            <div className="mb-6 max-w-lg">
              <Alert variant="info">
                <div className="text-sm whitespace-pre-wrap" title={loginMessage}>
                  {truncatedMessage}
                </div>
              </Alert>
            </div>
          )}

          <div className="flex flex-col gap-6 justify-center p-5 md:p-8 border border-neutral-500/20 shadow-lg dark:shadow-2xl rounded-lg bg-neutral-200/10 dark:bg-neutral-800/40 backdrop-blur-lg min-w-[320px]">
            {/* Step 0: Accounts that signed in on this browser before */}
            {activeStep === 'accounts' && (
              <>
                <RememberedAccountList
                  logins={rememberedLogins}
                  onSelect={continueWithRemembered}
                  onForget={forgetLogin}
                  disabled={isWorking}
                />
                <OrDivider />
                <button
                  type="button"
                  onClick={handleUseAnotherAccount}
                  disabled={isWorking}
                  className="self-center text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition ease"
                >
                  Use another account
                </button>
              </>
            )}

            {/* Step 1: Email (with SSO buttons above if configured) */}
            {activeStep === 'email' && (
              <>
                {chooserAvailable && (
                  <button
                    type="button"
                    onClick={() => setShowSavedAccounts(true)}
                    className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease w-fit"
                  >
                    <FaArrowLeft className="text-xs" />
                    Back
                  </button>
                )}
                {!passwordAuthEnabled && !hasSSOProviders && ssoMethods.length === 0 && (
                  <Alert variant="warning" size="sm" icon={true}>
                    Password authentication is disabled and no SSO providers are configured. Contact
                    your administrator.
                  </Alert>
                )}
                {instanceButtons.length > 0 && (
                  <>
                    <div className="flex flex-col gap-3">
                      {instanceButtons.map((provider) => (
                        <Button
                          key={provider.id}
                          variant="outline"
                          size="lg"
                          onClick={() => handleProviderButtonClick(provider.id)}
                          icon={provider.icon}
                        >
                          {`Continue with ${provider.name}`}
                          {isSameLoginMethod(firstStepHint?.method, {
                            kind: 'instance-sso',
                            slug: provider.id,
                          }) && <LastUsedBadge className="ml-1" />}
                        </Button>
                      ))}
                    </div>
                    <OrDivider />
                  </>
                )}
                {/* Email form stays visible even when password auth is
                    disabled — it's the discovery mechanism for org-level
                    SSO. The backend's email_check returns the org's SSO
                    config and the frontend redirects automatically. */}
                <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
                  <div>
                    <input
                      type="email"
                      placeholder="satoshin@gmx.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus={!emailLocked}
                      readOnly={emailLocked}
                      aria-readonly={emailLocked}
                      className={clsx('w-full', emailLocked && 'cursor-not-allowed opacity-75')}
                    />
                  </div>
                  <Button type="submit" variant="primary" isLoading={checking} disabled={checking}>
                    Continue
                    {continueLastUsed && <LastUsedBadge tone="inverse" className="ml-1" />}
                  </Button>
                </form>
                {passwordAuthEnabled && (
                  <div className="text-center">
                    <Link
                      href={signupHref}
                      className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease"
                    >
                      Create an account
                    </Link>
                  </div>
                )}
              </>
            )}

            {/* Step 2a: Password login */}
            {activeStep === 'password' && (
              <form onSubmit={handlePasswordLogin} className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease w-fit"
                >
                  <FaArrowLeft className="text-xs" />
                  {email}
                </button>

                <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                  <input
                    ref={passwordRef}
                    type={showPw ? 'text' : 'password'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={16}
                    autoFocus
                    className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
                  />
                  <button
                    className="bg-zinc-100 dark:bg-zinc-800 px-3 text-neutral-500 rounded-md"
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    tabIndex={-1}
                  >
                    {showPw ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>

                {/*
                  Hidden for password users: always store the deviceKey.
                  Unchecking has bad UX (re-typing the password on every
                  privileged action), and sessionStorage isn't a viable
                  alternative — a user can land in a browser session with
                  an already-valid auth cookie and never enter their
                  password, leaving us with no key material to cache.

                  <label className="flex items-center gap-2 text-sm text-neutral-500 select-none">
                    <input
                      type="checkbox"
                      checked={rememberDevice}
                      onChange={(e) => setRememberDevice(e.target.checked)}
                      className="rounded accent-emerald-500"
                    />
                    Remember me on this device
                  </label>
                */}

                <Button
                  type="submit"
                  variant="primary"
                  isLoading={derivingKey}
                  disabled={derivingKey}
                >
                  Log in
                  {ssoMethods.length > 0 && emailLogin?.method.kind === 'password' && (
                    <LastUsedBadge tone="inverse" className="ml-1" />
                  )}
                </Button>

                {/* Show SSO option when both password and SSO are available */}
                {ssoMethods.length > 0 && (
                  <>
                    <OrDivider />
                    {ssoMethods.map((method) => renderSsoMethodButton(method, false))}
                  </>
                )}

                {passwordAuthEnabled && (
                  <div className="text-center">
                    <Link
                      href={signupHref}
                      className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease"
                    >
                      Create an account
                    </Link>
                  </div>
                )}
              </form>
            )}

            {/* Step 2b: SSO redirect */}
            {activeStep === 'sso-redirect' && ssoProvider && (
              <div className="flex flex-col gap-4 items-center">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease w-fit self-start"
                >
                  <FaArrowLeft className="text-xs" />
                  {email}
                </button>

                <p className="text-sm text-neutral-500 text-center">
                  This account uses SSO. Continue with your identity provider.
                </p>

                {ssoMethods.length > 0 ? (
                  ssoMethods.map((method) => renderSsoMethodButton(method, true))
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => handleProviderButtonClick(ssoProvider)}
                    icon={providerButtons.find((p) => p.id === ssoProvider)?.icon}
                  >
                    {`Continue with ${getProviderName(ssoProvider)}`}
                  </Button>
                )}
              </div>
            )}

            {/* Step 2c: TOTP challenge (password flow) */}
            {activeStep === 'totp' && (
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease w-fit"
                >
                  <FaArrowLeft className="text-xs" />
                  {email}
                </button>

                <p className="text-sm text-neutral-500 text-center">
                  Enter the 6-digit code from your authenticator app.
                </p>

                <TotpVerifyForm onSuccess={handleTotpSuccess} />
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="mt-4 max-w-sm">
              <Alert variant="danger" size="sm" icon>
                <div className="text-sm">{errorMessage}</div>
              </Alert>
            </div>
          )}

          {isCloudHosted() && (
            <p className="text-neutral-500 text-xs py-4 max-w-sm">
              By continuing, you are agreeing to our{' '}
              <Link
                className="text-emerald-400 hover:text-emerald-500 transition ease"
                href="https://phase.dev/legal/terms"
                target="_blank"
                rel="noopener"
              >
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link
                className="text-emerald-400 hover:text-emerald-500 transition ease"
                href="https://phase.dev/legal/privacy"
                target="_blank"
                rel="noopener"
              >
                Privacy Policy
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </div>
  )
}
