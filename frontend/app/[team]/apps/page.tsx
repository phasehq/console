'use client'

import { useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { AppType } from '@/apollo/graphql'
import NewAppDialog from '@/components/apps/NewAppDialog'
import { useContext } from 'react'
import Link from 'next/link'
import Spinner from '@/components/common/Spinner'
import { AppCard } from '@/components/apps/AppCard'
import { organisationContext } from '@/contexts/organisationContext'

export default function AppsHome({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data, loading } = useQuery(GetApps, {
    variables: {
      organisationId: organisation?.id,
      skip: !organisation,
    },
  })

  const apps = data?.apps as AppType[]

  return (
    <div
      className="w-full p-8 text-black dark:text-white flex flex-col gap-16 overflow-y-auto"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      <h1 className="text-3xl font-bold capitalize col-span-4">Apps</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-8">
        {apps?.map((app) => (
          <Link href={`/${params.team}/apps/${app.id}`} key={app.id}>
            <AppCard app={app} />
          </Link>
        ))}
        {organisation && apps && (
          <div className="bg-zinc-100 dark:bg-neutral-800 opacity-80 hover:opacity-100 transition-opacity ease-in-out shadow-lg rounded-xl flex flex-col gap-y-20 min-h-[252px]">
            <NewAppDialog organisation={organisation} appCount={apps.length} />
          </div>
        )}
      </div>
      {loading && (
        <div className="mx-auto my-auto">
          <Spinner size="xl" />
        </div>
      )}
    </div>
  )
}
