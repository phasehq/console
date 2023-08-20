'use client'

import { useLazyQuery, useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { AppType, OrganisationType } from '@/apollo/graphql'
import NewAppDialog from '@/components/apps/NewAppDialog'
import { FaPlus } from 'react-icons/fa'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Spinner from '@/components/common/Spinner'
import { AppCard } from '@/components/apps/AppCard'

export default function AppsHome({ params }: { params: { team: string } }) {
  const [organisation, setOrganisation] = useState<OrganisationType | undefined>(undefined)

  const { data: orgsData } = useQuery(GetOrganisations)

  const [getApps, { data, loading }] = useLazyQuery(GetApps)

  useEffect(() => {
    if (orgsData?.organisations) {
      const fetchData = async () => {
        const org = orgsData.organisations[0]
        setOrganisation(org)
        const organisationId = org.id
        getApps({
          variables: {
            organisationId,
            appId: '',
          },
        })
      }

      fetchData()
    }
  }, [getApps, orgsData])

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
        {organisation && !loading && (
          <div className="bg-white/50 dark:bg-neutral-800 opacity-40 hover:opacity-100 transition-opacity ease-in-out shadow-lg rounded-xl p-8 flex flex-col gap-y-20">
            <div className="mx-auto my-auto">
              <NewAppDialog
                buttonLabel={
                  <div className="w-full flex mx-auto my-auto items-center">
                    <FaPlus size="32" className="text-neutral-800 dark:text-neutral-300" />
                  </div>
                }
                buttonVariant="text"
                organisation={organisation}
                appCount={apps.length}
              />
            </div>
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
