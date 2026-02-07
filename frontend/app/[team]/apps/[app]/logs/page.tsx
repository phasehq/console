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
    <div className="h-screen overflow-y-auto w-full text-black dark:text-white flex flex-col">
      <SecretLogs app={params.app} />
    </div>
  )
}
