'use client'

import AppsHomeCard from '@/components/apps/AppsHomeCard'
import { useQuery } from '@apollo/client'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'
import Link from 'next/link'
import { useContext } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import MembersHomeCard from '@/components/users/MembersHomeCard'
import IntegrationsHomeCard from '@/components/syncing/IntegrationsHomeCard'

export default function AppsHome({ params }: { params: { team: string } }) {
  //const { loading, error, data } = useQuery(GetOrganisations)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  return (
    <>
      <div className="w-full p-8 text-black dark:text-white flex flex-col gap-16">
        <h1 className="text-3xl font-bold capitalize">{organisation?.name} Home</h1>
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
    </>
  )
}
