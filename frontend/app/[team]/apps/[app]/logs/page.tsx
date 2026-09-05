'use client'

import Spinner from '@/components/common/Spinner'
import SecretLogs from '@/components/logs/SecretLogs'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext } from 'react'

export default function Logs({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  if (!organisation)
    return (
      <div className="h-full max-h-screen overflow-y-auto w-full flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="h-full min-h-0 overflow-y-auto w-full text-black dark:text-white flex flex-col px-3 sm:px-4 lg:px-6">
      <SecretLogs app={params.app} />
    </div>
  )
}
