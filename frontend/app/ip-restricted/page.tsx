'use client'

import { Button } from '@/components/common/Button'
import OnboardingNavbar from '@/components/layout/OnboardingNavbar'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PiNetworkSlashBold } from 'react-icons/pi'
import { GetIP } from '@/graphql/queries/access/getClientIp.gql'
import { useQuery } from '@apollo/client'
import CopyButton from '@/components/common/CopyButton'

export default function IPRestricted() {
  const searchParams = useSearchParams()

  const { data } = useQuery(GetIP)

  const org = searchParams?.get('org')
  return (
    <div className="flex flex-col justify-between w-full h-screen">
      <OnboardingNavbar />

      <div className="flex flex-col mx-auto my-auto w-full max-w-3xl gap-y-8">
        <div className="flex justify-center">
          <PiNetworkSlashBold className="text-neutral-500 text-7xl" />
        </div>
        <div className="text-zinc-900 dark:text-zinc-100 font-mono font-semibold text-2xl text-center">
          IP_RESTRICTED
        </div>
        <p className="text-neutral-600 dark:text-neutral-400 text-center text-lg">
          You are not allowed to access the{' '}
          <span className="text-zinc-900 dark:text-zinc-100 font-medium">{org}</span> Organisation
          from your current IP address:{' '}
          <CopyButton value={data?.clientIp}>
            <span className="font-medium">{data?.clientIp}</span>
          </CopyButton>
          Please contact your organisation admin to get access.
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
