'use client'

import { Button } from '@/components/common/Button'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import UserMenu from '@/components/UserMenu'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PiNetworkSlashBold } from 'react-icons/pi'

export default function IPRestricted() {
  const searchParams = useSearchParams()

  const org = searchParams?.get('org')
  return (
    <div className="flex flex-col justify-between w-full h-screen">
      <OnboardingNavbar />

      <div className="flex flex-col mx-auto my-auto w-full max-w-3xl gap-y-8">
        <div className="flex justify-center">
          <PiNetworkSlashBold className="text-neutral-500 text-4xl" />
        </div>
        <div className="text-zinc-900 dark:text-zinc-100 font-mono font-semibold text-2xl text-center">
          IP_RESTRICTED
        </div>
        <p className="text-neutral-500 text-center text-lg font-medium">
          You are not allowed to access the {org} workspace from your current IP address. Please
          contact your organisation admin to get access.
        </p>

        <div className="flex justify-center">
          <Link href={`/${org}`}>
            <Button variant="primary">Try again</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
