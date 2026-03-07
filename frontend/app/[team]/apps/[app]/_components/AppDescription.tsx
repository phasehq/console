'use client'

import { useContext } from 'react'
import { useQuery } from '@apollo/client'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { AppType } from '@/apollo/graphql'
import { AppDescriptionViewer } from '@/components/apps/AppDescriptionViewer'

interface AppDescriptionProps {
  appId: string
}

export const AppDescription = ({ appId }: AppDescriptionProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data, loading } = useQuery(GetAppDetail, {
    variables: {
      organisationId: organisation?.id,
      appId,
    },
    skip: !organisation,
  })

  const app = data?.apps[0] as AppType

  if (loading) {
    return (
      <div className="w-full h-40 bg-neutral-100 dark:bg-neutral-800/50 rounded-lg animate-pulse" />
    )
  }

  if (!app?.description) return null

  return (
    <div className="space-y-4 flex flex-col h-40 lg:h-0 lg:min-h-full">
      <div className="shrink-0 pt-2">
        <h1 className="h3 font-semibold text-xl">Readme</h1>
        <p className="text-neutral-500 text-sm">App description and information.</p>
      </div>
      <AppDescriptionViewer
        appId={appId}
        description={app.description}
        className="flex-grow min-h-0"
        maxHeightClass="h-full"
        showEditButton
      />
    </div>
  )
}
