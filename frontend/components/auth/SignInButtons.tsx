'use client'

import clsx from 'clsx'
import { signIn, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ReactNode, useEffect, useState } from 'react'
import { FaGithub, FaGitlab, FaGoogle } from 'react-icons/fa'
import { AnimatedLogo } from '../common/AnimatedLogo'
import Spinner from '../common/Spinner'

type ProviderButton = { id: string; name: string; icon: ReactNode; style: string }

//const providers = process.env.NEXT_PUBLIC_NEXTAUTH_PROVIDERS?.split(',') ?? []
const providers = "github,gitlab"

const providerButtons: ProviderButton[] = [
  {
    id: 'google',
    name: 'Google',
    icon: <FaGoogle />,
    style:
      'bg-[#4285F4]/10 hover:bg-[#4285F4]/30 hover:ring-[#4285F4] text-[#4285F4]/70 hover:text-[#4285F4] ring-[#4285F4]/60',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: <FaGithub />,
    style:
      'bg-zinc-200/10 hover:bg-zinc-200/20 ring-zinc-200/40 hover:ring-zinc-100/80 text-zinc-100/80 hover:text-zinc-100',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    icon: <FaGitlab />,
    style:
      'bg-[#7759C2]/10 hover:bg-[#7759C2]/20 hover:ring-[#7759C2] text-[#7759C2]/90 hover:text-[#7759C2] ring-[#7759C2]/60',
  },
]

const BUTTON_BASE_STYLE =
  'py-2 px-20 mx-auto rounded-full shadow-2xl flex items-center gap-x-5 text-lg ring-1 ring-inset transition-colors ease-in-out'

export default function SignInButtons() {
  const [loading, setLoading] = useState<boolean>(false)
  const { status } = useSession()
  const router = useRouter()

  const titleText = () => (loading ? 'Logging you in' : 'Phase Console')

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains('dark')
    if (!isDarkMode) document.documentElement.classList.toggle('dark')
  }, [])

  useEffect(() => {
    if (status === 'authenticated') router.push('/')
  }, [router, status])

  const handleProviderButtonClick = (providerId: string) => {
    setLoading(true)
    signIn(providerId)
  }

  return (
    <>
      <div className="gap-y-2 flex flex-col items-center p-16 border border-neutral-500/20 shadow-2xl rounded-lg bg-neutral-800/80 text-white">
        <div className={clsx(status === 'loading' && 'animate-pulse')}>
          <AnimatedLogo boxSize={96} />
        </div>
        {status === 'unauthenticated' && (
          <div className="space-y-4">
            <div className="text-2xl font-semibold pb-4 text-center">{titleText()}</div>

            <div className="space-y-6">
              {!loading &&
                providerButtons
                  .filter((p) => providers.includes(p.id))
                  .map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => handleProviderButtonClick(provider.id)}
                      className={clsx(BUTTON_BASE_STYLE, provider.style)}
                    >
                      {provider.icon}
                      {`Login with ${provider.name}`}
                    </button>
                  ))}
            </div>
          </div>
        )}
        {status === 'loading' || (loading && <Spinner size="xl" />)}
      </div>
    </>
  )
}
