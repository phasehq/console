import { VersionLabel } from '@/components/VersionLabel'
import SignInButtons from '@/components/auth/SignInButtons'
import { ModeToggle } from '@/components/common/ModeToggle'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { isCloudHosted } from '@/utils/appConfig'
import { formatTitle } from '@/utils/meta'
import { Metadata } from 'next'
import { FaSun, FaMoon } from 'react-icons/fa6'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: formatTitle(`Log in`),
    description: `Log in to Phase`,
  }
}

export default async function Login() {
  const providers = process.env.SSO_PROVIDERS?.split(',') ?? []

  return (
    <>
      <div className="h-screen w-full md:p-16 text-zinc-900 dark:text-zinc-100 flex items-center justify-center px-4">
        <div className="absolute top-4 px-4 md:px-8 md:top-8 w-full flex justify-end gap-6">
          {isCloudHosted() && <StatusIndicator />}
          <div className="flex items-center justify-between px-2  text-neutral-500">
            <div className="flex items-center gap-2">
              <FaSun />
              <ModeToggle />
              <FaMoon />
            </div>
          </div>
        </div>

        <SignInButtons providers={providers} />

        <div className="absolute bottom-4 px-4 md:px-8 md:bottom-8 w-full flex justify-between">
          <div className="text-neutral-500 text-sm font-medium">Phi Security Inc.</div>
          <VersionLabel />
        </div>
      </div>
    </>
  )
}
