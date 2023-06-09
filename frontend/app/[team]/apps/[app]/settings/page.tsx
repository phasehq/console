'use client'

import { GetOrganisations } from '@/apollo/queries/getOrganisations.gql'
import { GetAppDetail } from '@/apollo/queries/getAppDetail.gql'
import { useLazyQuery, useQuery } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { useEffect } from 'react'
import DeleteAppDialog from '@/components/apps/DeleteAppDialog'

export default function AppSettings({ params }: { params: { team: string; app: string } }) {
  const { data: orgsData } = useQuery(GetOrganisations)

  const [getApp, { data, loading }] = useLazyQuery(GetAppDetail)

  useEffect(() => {
    if (orgsData) {
      const organisationId = orgsData.organisations[0].id
      getApp({
        variables: {
          organisationId,
          appId: params.app,
        },
      })
    }
  }, [getApp, orgsData, params.app])

  const app = data?.apps[0] as AppType

  return (
    <div className="h-screen w-full text-black dark:text-white flex flex-col gap-16 mt-6">
      {app && (
        <div className="flex w-full justify-between">
          <span className="text-gray-500 uppercase tracking-widest font-semibold text-sm">
            created
          </span>
          <span>{app.createdAt}</span>
        </div>
      )}
      <div className="flex items-center justify-between p-3 rounded-lg bg-red-200 dark:bg-red-400/10">
        <div>
          <h3 className="text-red-500 dark:text-red-800 font-semibold">Delete app</h3>
          <p className="text-neutral-500">Permanently delete this app</p>
        </div>

        {app && (
          <DeleteAppDialog
            appId={app.id}
            appName={app.name}
            teamName={params.team}
            organisationId={orgsData.organisations[0].id}
          />
        )}
      </div>
    </div>
  )
}
