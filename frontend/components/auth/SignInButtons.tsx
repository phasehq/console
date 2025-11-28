'use client'

import clsx from 'clsx'
import { signIn, useSession } from 'next-auth/react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
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
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { LogoProps } from '../common/logos/types'
import { LogoWordMark } from '../common/LogoWordMark'
import Link from 'next/link'
import { isCloudHosted } from '@/utils/appConfig'
import { Alert } from '../common/Alert'
import { FaExternalLinkAlt } from 'react-icons/fa'

type ProviderButton = {
  id: string
  name: string
  icon: ({ className }: LogoProps) => JSX.Element
}

const providerButtons: ProviderButton[] = [
  {
    id: 'google',
    name: 'Google',
    icon: GoogleLogo,
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: GitHubLogo,
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    icon: GitLabLogo,
  },
  {
    id: 'google-oidc',
    name: 'Google OIDC',
    icon: GoogleLogo,
  },
  {
    id: 'jumpcloud-oidc',
    name: 'JumpCloud OIDC',
    icon: JumpCloudLogo,
  },
  {
    id: 'entra-id-oidc',
    name: 'Entra ID OIDC',
    icon: EntraIDLogo,
  },
  {
    id: 'github-enterprise',
    name: 'GitHub Enterprise',
    icon: GitHubLogo,
  },
  {
    id: 'authentik',
    name: 'Authentik',
    icon: AuthentikLogo,
  },
  {
    id: 'okta-oidc',
    name: 'Okta',
    icon: OktaLogo,
  },
]

export default function SignInButtons({
  providers,
  loginMessage,
}: {
  providers: string[]
  loginMessage?: string | undefined | null
}) {
  const [loading, setLoading] = useState<boolean>(false)
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()

  const callbackUrl = searchParams?.get('callbackUrl')

  const handleProviderButtonClick = useCallback(
    (providerId: string) => {
      setLoading(true)
      signIn(providerId, {
        redirect: callbackUrl ? true : false,
        callbackUrl: callbackUrl || '',
      })
    },
    [callbackUrl]
  )

  useEffect(() => {
    const providerId = searchParams?.get('provider')
    const error = searchParams?.get('error')

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

  const titleText = () =>
    loading ? 'Logging in...' : `Log in to Phase ${isCloudHosted() ? 'Cloud' : ''}`

  useEffect(() => {
    if (status === 'authenticated') router.push('/')
  }, [router, status])

  const maxBannerLength = 512
  const truncatedMessage = loginMessage?.slice(0, maxBannerLength)

  return (
    <>
      <div className="gap-y-4 flex flex-col items-center justify-center text-zinc-900 dark:text-zinc-100">
        <div className="flex flex-col items-center justify-center">
          <div className={clsx(status === 'loading' && 'animate-pulse', 'mb-4')}>
            <LogoWordMark className="w-32 fill-neutral-500" />
          </div>
          <div className="text-lg font-medium pb-4 text-center flex items-center gap-4">
            {loading && <Spinner size="sm" />}
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
            {providers.length > 0 ? (
              <div className="flex flex-col gap-6 justify-center p-5 md:p-8 border border-neutral-500/20 shadow-lg dark:shadow-2xl rounded-lg bg-neutral-200/10 dark:bg-neutral-800/40 backdrop-blur-lg">
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
            ) : (
              <Alert variant="danger">
                <div className="text-center space-y-1">
                  <h2 className="font-semibold text-base">
                    No authentication providers configured
                  </h2>
                  <p className="max-w-sm text-sm">
                    Please contact your administrator, or refer to the{' '}
                    <Link
                      className="underline font-medium inline-flex items-center gap-1"
                      href="https://docs.phase.dev/self-hosting/configuration/envars#single-sign-on-sso"
                      target="_blank"
                      rel="noopener"
                    >
                      documentation <FaExternalLinkAlt />
                    </Link>{' '}
                    to correctly configure SSO providers.
                  </p>
                </div>
              </Alert>
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
    </>
  )
}
