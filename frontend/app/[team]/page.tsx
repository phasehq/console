'use client'

import AppsHomeCard from '@/components/apps/AppsHomeCard'
import Link from 'next/link'
import { useContext, useState } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import MembersHomeCard from '@/components/users/MembersHomeCard'
import IntegrationsHomeCard from '@/components/syncing/IntegrationsHomeCard'
import { GetStarted } from '@/components/dashboard/GetStarted'
import clsx from 'clsx'
import { FaChevronRight } from 'react-icons/fa'
import { Button } from '@/components/common/Button'

export default function AppsHome({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  return (
    <>
      <div className="overflow-x-hidden text-black dark:text-white">
        <div className="flex h-full w-full gap-8 ">
          <div className="w-full space-y-16 p-8">
            <h1 className="text-3xl font-bold capitalize">{organisation?.name} Home</h1>

            {organisation && (
              <div className="w-full">
                <GetStarted organisation={organisation} />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-8">
              {organisation && (
                <Link href={`/${params.team}/apps`}>
                  <AppsHomeCard organisationId={organisation.id} />
                </Link>
              )}
              {organisation && (
                <Link href={`/${params.team}/members`}>
                  <MembersHomeCard organisationId={organisation.id} />
                </Link>
              )}
              {organisation && (
                <Link href={`/${params.team}/integrations`}>
                  <IntegrationsHomeCard organisationId={organisation.id} />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
