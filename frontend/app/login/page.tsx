import { VersionLabel } from '@/components/VersionLabel'
import SignInButtons from '@/components/auth/SignInButtons'
import { ModeToggle } from '@/components/common/ModeToggle'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { isCloudHosted } from '@/utils/appConfig'
import { formatTitle } from '@/utils/meta'
import { Metadata } from 'next'
import { FaSun, FaMoon } from 'react-icons/fa6'
import { InstanceInfo } from '@/components/InstanceInfo'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: formatTitle(`Log in`),
    description: `Log in to Phase`,
  }
}

export default async function Login() {
  const providers =
    process.env.SSO_PROVIDERS?.split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean) ?? []
  const loginBannerText = process.env.LOGIN_BANNER_TEXT

  return (
    <>
      <div className="h-screen w-full md:p-16 text-zinc-900 dark:text-zinc-100 flex items-center justify-center px-4">
        <div className="absolute top-4 px-4 md:px-8 md:top-8 w-full flex justify-between gap-6">
          <div className="flex items-center gap-2">
            <InstanceInfo />
          </div>
          <div className="flex items-center gap-6">
            {isCloudHosted() && <StatusIndicator />}
            <div className="flex items-center justify-between px-2  text-neutral-500">
              <div className="flex items-center gap-2">
                <FaSun />
                <ModeToggle />
                <FaMoon />
              </div>
            </div>
          </div>
        </div>

        <SignInButtons providers={providers} loginMessage={loginBannerText} />

        <div className="absolute bottom-4 px-4 md:px-8 md:bottom-8 w-full flex justify-between">
          <div className="text-neutral-500 text-sm font-medium">Phi Security Inc.</div>
          <VersionLabel />
        </div>
      </div>
    </>
  )
}
