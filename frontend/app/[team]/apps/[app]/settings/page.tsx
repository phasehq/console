'use client'

import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { useQuery } from '@apollo/client'
import { AppType } from '@/apollo/graphql'
import { useContext } from 'react'
import DeleteAppDialog from '@/components/apps/DeleteAppDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { FaCube } from 'react-icons/fa'

export default function AppSettings({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data } = useQuery(GetAppDetail, {
    variables: {
      organisationId: organisation!.id,
      appId: params.app,
    },
    skip: !organisation,
  })

  const app = data?.apps[0] as AppType

  const readableDate =
    app &&
    `${new Date(app.createdAt).toDateString()}, ${new Date(app.createdAt).toLocaleTimeString()}`

  return (
    <div className="max-w-screen-lg mx-auto space-y-10 divide-y divide-neutral-500/40 p-8 w-full text-black dark:text-white mt-6">
      <h1 className="text-3xl font-semibold">Settings</h1>
      {app && (
        <div className="space-y-6 py-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold">App</h2>
            <p className="text-neutral-500">App name and information</p>
          </div>
          <div className="flex items-center gap-4">
            <FaCube className="shrink-0 text-neutral-500" size={60} />
            <div className="flex flex-col gap-1">
              <span className="text-2xl font-medium">{app.name}</span>

              <div className="flex items-center gap-4 text-neutral-500">
                <div className="text-base ">Created</div>
                <span>{readableDate}</span>
              </div>
              <span className="text-neutral-500 text-sm">{app.id}</span>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-6 py-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-black dark:text-white">Danger Zone</h2>
          <p className="text-neutral-500">These actions may result in permanent loss of data</p>
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg ring-1 ring-inset ring-red-200 dark:ring-red-400/10">
          <div>
            <h3 className="text-red-500 dark:text-red-800 font-semibold">Delete App</h3>
            <p className="text-neutral-500">Permanently delete this App</p>
          </div>

          {organisation && app && (
            <DeleteAppDialog
              appId={app.id}
              appName={app.name}
              teamName={params.team}
              organisationId={organisation.id}
            />
          )}
        </div>
      </div>
    </div>
  )
}
