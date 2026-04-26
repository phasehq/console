'use client'

import clsx from 'clsx'
import { useSession } from '@/contexts/userContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import Spinner from '../common/Spinner'
import {
  GoogleLogo,
  GitHubLogo,
  GitLabLogo,
  JumpCloudLogo,
  EntraIDLogo,
  AuthentikLogo,
  OktaLogo,
} from '../common/logos'
import { SiAuthelia } from 'react-icons/si'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { LogoProps } from '../common/logos/types'
import { LogoWordMark } from '../common/LogoWordMark'
import Link from 'next/link'
import { isCloudHosted } from '@/utils/appConfig'
import { Alert } from '../common/Alert'
import { FaArrowLeft } from 'react-icons/fa'
import { FaEye, FaEyeSlash } from 'react-icons/fa'
import { decodeb64string, deviceVaultKey, passwordAuthHash } from '@/utils/crypto'
import { setDeviceKey } from '@/utils/localStorage'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'

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

type ProviderButton = {
  id: string
  name: string
  icon: ({ className }: LogoProps) => React.ReactNode
}

const providerButtons: ProviderButton[] = [
  { id: 'google', name: 'Google', icon: GoogleLogo },
  { id: 'github', name: 'GitHub', icon: GitHubLogo },
  { id: 'gitlab', name: 'GitLab', icon: GitLabLogo },
  { id: 'google-oidc', name: 'Google OIDC', icon: GoogleLogo },
  { id: 'jumpcloud-oidc', name: 'JumpCloud OIDC', icon: JumpCloudLogo },
  { id: 'entra-id-oidc', name: 'Entra ID OIDC', icon: EntraIDLogo },
  { id: 'github-enterprise', name: 'GitHub Enterprise', icon: GitHubLogo },
  { id: 'authentik', name: 'Authentik', icon: AuthentikLogo },
  { id: 'authelia', name: 'Authelia', icon: SiAuthelia },
  { id: 'okta-oidc', name: 'Okta', icon: OktaLogo },
]

// Map org-level provider_type to the icon used for instance-level buttons
const orgProviderIcons: Record<string, ({ className }: LogoProps) => React.ReactNode> = {
  entra_id: EntraIDLogo,
  okta: OktaLogo,
  google: GoogleLogo,
  jumpcloud: JumpCloudLogo,
}

type SSOMethod = {
  id: string
  providerType: 'instance' | 'oidc'
  provider?: string
  providerName?: string
  enforced: boolean
}

type LoginStep = 'email' | 'password' | 'sso-redirect'

export default function SignInButtons({
  providers,
  loginMessage,
}: {
  providers: string[]
  loginMessage?: string | undefined | null
}) {
  const [loading, setLoading] = useState<boolean>(false)
  const [checking, setChecking] = useState<boolean>(false)
  const [derivingKey, setDerivingKey] = useState<boolean>(false)
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [email, setEmail] = useState('')
  const [emailLocked, setEmailLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(true)
  const [step, setStep] = useState<LoginStep>('email')
  const [ssoProvider, setSsoProvider] = useState<string | null>(null)
  const [ssoMethods, setSsoMethods] = useState<SSOMethod[]>([])
  const [hasPassword, setHasPassword] = useState<boolean>(true)

  const passwordRef = useRef<HTMLInputElement>(null)

  const hasSSOProviders = providers.length > 0

  useEffect(() => {
    let cancelled = false
    const prefillFromInvite = async () => {
      const inviteId = await extractInviteIdFromCallback(searchParams?.get('callbackUrl'))
      if (!inviteId) return
      try {
        const { data } = await axios.get(
          UrlUtils.makeUrl(
            process.env.NEXT_PUBLIC_BACKEND_API_BASE!,
            'auth',
            'invite',
            inviteId
          ),
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

  const handleProviderButtonClick = useCallback(
    (providerId: string) => {
      setLoading(true)
      const callbackUrl = searchParams?.get('callbackUrl') || ''
      const qs = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''
      window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/sso/${providerId}/authorize/${qs}`
    },
    [searchParams]
  )

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setChecking(true)
    try {
      const inviteId = await extractInviteIdFromCallback(searchParams?.get('callbackUrl'))
      const response = await axios.post(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'email', 'check'),
        {
          email: email.toLowerCase().trim(),
          ...(inviteId ? { inviteId } : {}),
        },
        { withCredentials: true }
      )

      const { authMethods, authMethod, ssoProvider: legacyProvider } = response.data

      if (authMethods) {
        const methods = authMethods.sso as SSOMethod[]
        const passwordAvailable = authMethods.password as boolean
        setHasPassword(passwordAvailable)
        setSsoMethods(methods)

        if (methods.length > 0 && !passwordAvailable) {
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
        if (deviceKey && response.data?.userId) {
          setDeviceKey(response.data.userId, deviceKey)
        }
        const callbackUrl = searchParams?.get('callbackUrl')
        // Same-origin relative paths only. Protocol-relative URLs like
        // //evil.com/phish would be cross-origin and let an attacker
        // hijack the post-login navigation.
        const isSafeCallback =
          !!callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
        window.location.href = isSafeCallback ? (callbackUrl as string) : '/'
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
      toast.error(
        'Something went wrong. Please contact your server admin or check the server logs for more information.',
        { autoClose: 5000 }
      )
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
    if (status === 'authenticated') router.push('/')
  }, [router, status])

  const maxBannerLength = 512
  const truncatedMessage = loginMessage?.slice(0, maxBannerLength)

  // Find the friendly name for a provider ID
  const getProviderName = (id: string) =>
    providerButtons.find((p) => p.id === id)?.name || id

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
          {status === 'unauthenticated' && titleText()}
        </div>
      </div>

      {status === 'unauthenticated' && !loading && (
        <div>
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
            {/* Step 1: Email (with SSO buttons above if configured) */}
            {step === 'email' && (
              <>
                {hasSSOProviders && (
                  <>
                    <div className="flex flex-col gap-3">
                      {providerButtons
                        .filter((p) => providers.includes(p.id))
                        .map((provider) => (
                          <Button
                            key={provider.id}
                            variant="outline"
                            size="lg"
                            onClick={() => handleProviderButtonClick(provider.id)}
                            icon={provider.icon}
                          >
                            {`Continue with ${provider.name}`}
                          </Button>
                        ))}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 h-px bg-neutral-500/20" />
                      <span className="text-xs text-neutral-500 uppercase">or</span>
                      <div className="flex-1 h-px bg-neutral-500/20" />
                    </div>
                  </>
                )}
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
                      className={clsx(
                        'w-full',
                        emailLocked && 'cursor-not-allowed opacity-75'
                      )}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={checking}
                    disabled={checking}
                  >
                    Continue
                  </Button>
                </form>
                <div className="text-center">
                  <Link
                    href={signupHref}
                    className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease"
                  >
                    Create an account
                  </Link>
                </div>
              </>
            )}

            {/* Step 2a: Password login */}
            {step === 'password' && (
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

                <label className="flex items-center gap-2 text-sm text-neutral-500 select-none">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="rounded accent-emerald-500"
                  />
                  Remember me on this device
                </label>

                <Button
                  type="submit"
                  variant="primary"
                  isLoading={derivingKey}
                  disabled={derivingKey}
                >
                  Log in
                </Button>

                {/* Show SSO option when both password and SSO are available */}
                {ssoMethods.length > 0 && (
                  <>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 h-px bg-neutral-500/20" />
                      <span className="text-xs text-neutral-500 uppercase">or</span>
                      <div className="flex-1 h-px bg-neutral-500/20" />
                    </div>
                    {ssoMethods.map((method) => {
                      const isOrg = method.providerType === 'oidc'
                      const handleClick = () => {
                        setLoading(true)
                        const callbackUrl = searchParams?.get('callbackUrl') || ''
                        const qs = callbackUrl
                          ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                          : ''
                        if (isOrg) {
                          window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/sso/org/${method.id}/authorize/${qs}`
                        } else {
                          window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/sso/${method.id}/authorize/${qs}`
                        }
                      }

                      const label = isOrg
                        ? `Sign in with ${method.providerName || 'SSO'}`
                        : `Sign in with ${getProviderName(method.id)}`
                      const icon = isOrg
                        ? (method.provider ? orgProviderIcons[method.provider] : undefined)
                        : providerButtons.find((p) => p.id === method.id)?.icon

                      return (
                        <Button
                          key={method.id}
                          variant="outline"
                          onClick={handleClick}
                          type="button"
                          icon={icon}
                        >
                          {label}
                        </Button>
                      )
                    })}
                  </>
                )}

                <div className="text-center">
                  <Link
                    href={signupHref}
                    className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease"
                  >
                    Create an account
                  </Link>
                </div>
              </form>
            )}

            {/* Step 2b: SSO redirect */}
            {step === 'sso-redirect' && ssoProvider && (
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
                  ssoMethods.map((method) => {
                    const isOrg = method.providerType === 'oidc'
                    const handleClick = () => {
                      setLoading(true)
                      const callbackUrl = searchParams?.get('callbackUrl') || ''
                      const qs = callbackUrl
                        ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
                        : ''
                      if (isOrg) {
                        window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/sso/org/${method.id}/authorize/${qs}`
                      } else {
                        window.location.href = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/sso/${method.id}/authorize/${qs}`
                      }
                    }

                    const label = isOrg
                      ? `Continue with ${method.providerName || 'SSO'}`
                      : `Continue with ${getProviderName(method.id)}`
                    const icon = isOrg
                      ? (method.provider ? orgProviderIcons[method.provider] : undefined)
                      : providerButtons.find((p) => p.id === method.id)?.icon

                    return (
                      <Button
                        key={method.id}
                        variant="primary"
                        size="lg"
                        onClick={handleClick}
                        icon={icon}
                      >
                        {label}
                      </Button>
                    )
                  })
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
          </div>

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
