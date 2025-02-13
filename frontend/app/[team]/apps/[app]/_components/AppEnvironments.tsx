'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { SwapEnvOrder } from '@/graphql/mutations/environments/swapEnvironmentOrder.gql'
import { EnvironmentType, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { CreateEnvironmentDialog } from '@/components/environments/CreateEnvironmentDialog'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation } from '@apollo/client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useContext } from 'react'
import { BsListColumnsReverse } from 'react-icons/bs'
import { FaArrowRight, FaBan, FaExchangeAlt, FaFolder, FaKey } from 'react-icons/fa'
import { EmptyState } from '@/components/common/EmptyState'
import { useAppSecrets } from '../_hooks/useAppSecrets'

export const AppEnvironments = ({ appId }: { appId: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanReadEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'read',
    true
  )

  const userCanCreateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'create',
    true
  )

  const userCanUpdateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'update',
    true
  )

  const { appEnvironments, fetching } = useAppSecrets(
    appId,
    userCanReadEnvironments,
    10000 // Poll every 10 seconds
  )

  const allowReordering =
    organisation?.plan !== ApiOrganisationPlanChoices.Fr && userCanUpdateEnvironments

  const pathname = usePathname()

  const [swapEnvs, { loading }] = useMutation(SwapEnvOrder)

  const handleSwapEnvironments = async (env1: EnvironmentType, env2: EnvironmentType) => {
    await swapEnvs({
      variables: { environment1Id: env1.id, environment2Id: env2?.id },
      refetchQueries: [{ query: GetAppEnvironments, variables: { appId } }],
    })
  }

  return (
    <section className="space-y-4 py-4">
      <div className="space-y-2">
        <div className="space-y-1">
          <h1 className="h3 font-semibold text-2xl">Environments</h1>
          {userCanReadEnvironments ? (
            <p className="text-neutral-500">
              You have access to {appEnvironments?.length} Environments in this App.
            </p>
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view Environments in this app."
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
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 py-4">
        {appEnvironments?.map((env: EnvironmentType, index: number) => (
          <Card key={env.id}>
            <div className="group">
              <div className="flex gap-4">
                <div className="pt-1.5">
                  <BsListColumnsReverse className="text-black dark:text-white text-2xl" />
                </div>
                <div className="space-y-6 w-full min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`${pathname}/environments/${env.id}`} className="group min-w-0">
                      <div className="font-semibold text-lg truncate">{env.name}</div>
                      <div className="text-neutral-500 flex items-center gap-3">
                        <div className="flex items-center gap-1.5" title={`${env.secretCount} secrets`}>
                          <FaKey className="text-sm" />
                          <span>{env.secretCount}</span>
                        </div>
                        <div className="flex items-center gap-1.5" title={`${env.folderCount} folders`}>
                          <FaFolder className="text-sm" />
                          <span>{env.folderCount}</span>
                        </div>
                      </div>
                    </Link>
                    <ManageEnvironmentDialog environment={env} />
                  </div>

                  <div className="flex items-center">
                    <Link href={`${pathname}/environments/${env.id}`}>
                      <Button variant="primary">
                        Explore <FaArrowRight />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
              {allowReordering && (
                <div className="flex justify-between items-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
                  <div>
                    {index !== 0 && (
                      <Button
                        variant="secondary"
                        disabled={loading}
                        title={`Swap with ${appEnvironments[index - 1].name}`}
                        onClick={() => handleSwapEnvironments(env, appEnvironments[index - 1])}
                      >
                        <FaExchangeAlt className="text-xs shrink-0" />
                      </Button>
                    )}
                  </div>
                  <div>
                    {index !== appEnvironments.length - 1 && (
                      <Button
                        variant="secondary"
                        disabled={loading}
                        title={`Swap with ${appEnvironments[index + 1].name}`}
                        onClick={() => handleSwapEnvironments(env, appEnvironments[index + 1])}
                      >
                        <FaExchangeAlt className="text-xs shrink-0" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        ))}

        {userCanCreateEnvironments && (
          <Card>
            <div className="flex flex-col w-full h-full">
              <div className="mx-auto my-auto">
                <CreateEnvironmentDialog appId={appId} />
              </div>
            </div>
          </Card>
        )}
      </div>
    </section>
  )
}
