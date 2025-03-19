'use client'

import { useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { AppType } from '@/apollo/graphql'
import NewAppDialog from '@/components/apps/NewAppDialog'
import { useContext, useEffect, useRef } from 'react'
import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { useSearchParams } from 'next/navigation'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'
import { FaBan, FaPlus } from 'react-icons/fa'
import { FaBoxOpen } from 'react-icons/fa6'
import { Button } from '@/components/common/Button'
import { AppsView } from '@/components/apps/AppsView'

export default function AppsHome({ params }: { params: { team: string } }) {
  type ViewMode = 'grid' | 'list'

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

      {userCanCreateApps && organisation && (
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
                {organisation && apps && userCanCreateApps && (
                  <Button variant="primary" onClick={openNewAppDialog}>
                    <FaPlus />
                    Create an App{' '}
                  </Button>
                )}
              </div>
            </div>
          )}

          <AppsView apps={apps} />

          {apps?.length === 0 && userCanCreateApps && (
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
      {loading && (
        <div className="mx-auto my-auto">
          <Spinner size="xl" />
        </div>
      )}
    </div>
  )
}
