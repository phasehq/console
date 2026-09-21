'use client'

import AppsHomeCard from '@/components/apps/AppsHomeCard'
import Link from 'next/link'
import { useContext, use } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import MembersHomeCard from '@/components/users/MembersHomeCard'
import IntegrationsHomeCard from '@/components/syncing/IntegrationsHomeCard'
import { GetStarted } from '@/components/dashboard/GetStarted'

export default function AppsHome(props: { params: Promise<{ team: string }> }) {
  const params = use(props.params)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  return (
    <>
      <div className="text-black dark:text-white">
        <div className="flex h-full w-full gap-3 sm:gap-4 lg:gap-6">
          <div className="w-full space-y-6 sm:space-y-8 lg:space-y-12 p-3 sm:p-4 lg:p-6">
            <h1 className="text-lg sm:text-xl font-bold capitalize text-wrap">
              {organisation?.name} Home
            </h1>

            {organisation && (
              <div className="w-full">
                <GetStarted organisation={organisation} />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
              {organisation && (
                <Link href={`/${params.team}/apps`}>
                  <AppsHomeCard organisation={organisation} />
                </Link>
              )}
              {organisation && (
                <Link href={`/${params.team}/access/members`}>
                  <MembersHomeCard organisation={organisation} />
                </Link>
              )}
              {organisation && (
                <Link href={`/${params.team}/integrations/syncs`}>
                  <IntegrationsHomeCard organisation={organisation} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
