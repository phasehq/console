'use client'

import { useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { ApiOrganisationPlanChoices, AppType } from '@/apollo/graphql'
import NewAppDialog from '@/components/apps/NewAppDialog'
import { useContext, useEffect, useRef } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { useSearchParams } from 'next/navigation'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'
import { FaBan, FaPlus } from 'react-icons/fa'
import { FaBoxOpen } from 'react-icons/fa6'
import { Button } from '@/components/common/Button'
import { AppsView } from '@/components/apps/AppsView'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { isCloudHosted } from '@/utils/appConfig'

export default function AppsHome({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanViewApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')
  const userCanCreateApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'create')

  const dialogRef = useRef<{ openModal: () => void }>(null)

  const searchParams = useSearchParams()

  const openNewAppDialog = () => dialogRef.current?.openModal()

  useEffect(() => {
    if (searchParams?.get('new')) {
      openNewAppDialog()
    }
  }, [searchParams])

  const { data, loading } = useQuery(GetApps, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation || !userCanViewApps,
    fetchPolicy: 'cache-and-network',
  })

  const apps = (data?.apps as AppType[]) ?? []

  const allowNewApp = () => {
    if (!organisation?.planDetail?.maxApps) return true
    return userCanCreateApps && apps.length < organisation.planDetail?.maxApps
  }

  if (!organisation) return <></>

  return (
    <div
      className="w-full p-8 text-black dark:text-white flex flex-col gap-6 overflow-y-auto"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      <div className="space-y-1">
        <h1 className="text-3xl font-bold capitalize col-span-4">Apps</h1>
        <p className="text-neutral-500">
          All Apps that you have access to in the {organisation?.name} organisation
        </p>
      </div>

      {allowNewApp() && organisation && (
        <NewAppDialog
          organisation={organisation}
          appCount={apps?.length}
          ref={dialogRef}
          showButton={false}
        />
      )}
      {userCanViewApps ? (
        <>
          {apps?.length > 0 && (
            <div className="space-y-4">
              <div className="flex justify-end">
                {allowNewApp() && apps ? (
                  <Button variant="primary" onClick={openNewAppDialog}>
                    <FaPlus />
                    Create an App{' '}
                  </Button>
                ) : (
                  <UpsellDialog
                    buttonLabel={
                      <>
                        <FaPlus />
                        Create an App
                        <PlanLabel
                          plan={
                            isCloudHosted()
                              ? ApiOrganisationPlanChoices.Pr
                              : ApiOrganisationPlanChoices.En
                          }
                        />
                      </>
                    }
                  />
                )}
              </div>
            </div>
          )}

          <AppsView loading={loading} apps={apps} />

          {!loading && apps?.length === 0 && userCanCreateApps && (
            <div className="xl:col-span-2 1080p:col-span-3 justify-center p-20">
              <EmptyState
                title="No apps"
                subtitle="You don't have access to any apps yet. Create an App to get started."
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBoxOpen />
                  </div>
                }
              >
                <>
                  <Button variant="primary" onClick={openNewAppDialog}>
                    <FaPlus />
                    Create an App{' '}
                  </Button>
                </>
              </EmptyState>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Apps in this organisation."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      )}
    </div>
  )
}
