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
import { deviceVaultKey, passwordAuthHash } from '@/utils/crypto'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'

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
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [step, setStep] = useState<LoginStep>('email')
  const [ssoProvider, setSsoProvider] = useState<string | null>(null)

  const passwordRef = useRef<HTMLInputElement>(null)

  const hasSSOProviders = providers.length > 0

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
      const response = await axios.post(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'email', 'check'),
        { email: email.toLowerCase().trim() },
        { withCredentials: true }
      )

      const { authMethod, ssoProvider: provider } = response.data

      if (authMethod === 'sso' && provider) {
        setSsoProvider(provider)
        setStep('sso-redirect')
      } else {
        // "credentials" — show password field (works for both existing and unknown emails)
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
      const masterKey = await deviceVaultKey(password, email.toLowerCase().trim())
      const authHash = await passwordAuthHash(masterKey)

      const response = await axios.post(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'password', 'login'),
        { email: email.toLowerCase().trim(), authHash },
        { withCredentials: true }
      )

      if (response.status === 200) {
        const callbackUrl = searchParams?.get('callbackUrl')
        window.location.href = callbackUrl?.startsWith('/') ? callbackUrl : '/'
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
  }

  useEffect(() => {
    const providerId = searchParams?.get('provider')
    const error = searchParams?.get('error')
    const verified = searchParams?.get('verified')

    if (verified === 'true') {
      toast.success('Email verified! You can now log in.', { autoClose: 5000 })
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
                      autoFocus
                      className="w-full"
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
                    href="/signup"
                    className="text-sm text-neutral-500 hover:text-neutral-300 transition ease"
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
                  className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-300 transition ease w-fit"
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

                <Button
                  type="submit"
                  variant="primary"
                  isLoading={derivingKey}
                  disabled={derivingKey}
                >
                  Log in
                </Button>
                <div className="text-center">
                  <Link
                    href={`/signup?email=${encodeURIComponent(email)}`}
                    className="text-sm text-neutral-500 hover:text-neutral-300 transition ease"
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
                  className="flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-300 transition ease w-fit self-start"
                >
                  <FaArrowLeft className="text-xs" />
                  {email}
                </button>

                <p className="text-sm text-neutral-500 text-center">
                  This account uses SSO. Continue with your identity provider.
                </p>

                <Button
                  variant="primary"
                  onClick={() => handleProviderButtonClick(ssoProvider)}
                  icon={providerButtons.find((p) => p.id === ssoProvider)?.icon}
                >
                  {`Continue with ${getProviderName(ssoProvider)}`}
                </Button>
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
