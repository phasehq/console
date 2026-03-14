'use client'

import Spinner from '@/components/common/Spinner'
import AuditLogs from '@/components/logs/AuditLogs'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext } from 'react'

export default function OrgLogs({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  if (!organisation)
    return (
      <div className="h-full max-h-screen overflow-y-auto w-full flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="h-screen overflow-y-auto w-full text-black dark:text-white flex flex-col px-8">
      <h1 className="text-3xl font-bold pt-8 pb-4">Logs</h1>
      <AuditLogs />
    </div>
  )
}
