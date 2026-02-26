'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { UpdateEnvOrder } from '@/graphql/mutations/environments/updateEnvironmentOrder.gql'
import { EnvironmentType, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { CreateEnvironmentDialog } from '@/components/environments/CreateEnvironmentDialog'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation } from '@apollo/client'
import { LayoutGroup, motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useContext, useState } from 'react'
import { FaArrowLeft, FaArrowRight, FaBan, FaExchangeAlt, FaFolder, FaKey } from 'react-icons/fa'
import { EmptyState } from '@/components/common/EmptyState'
import { useAppSecrets } from '../_hooks/useAppSecrets'
import { EnvironmentCardSkeleton } from './EnvironmentCardSkeleton'

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

  const [updateEnvOrder] = useMutation(UpdateEnvOrder)

  const [isReordering, setIsReordering] = useState(false)
  const [localEnvOrder, setLocalEnvOrder] = useState<EnvironmentType[]>([])
  const [saving, setSaving] = useState(false)

  const handleStartReordering = () => {
    if (appEnvironments) {
      setLocalEnvOrder([...appEnvironments])
      setIsReordering(true)
    }
  }

  const handleLocalSwap = (index1: number, index2: number) => {
    setLocalEnvOrder((prev) => {
      const next = [...prev]
      ;[next[index1], next[index2]] = [next[index2], next[index1]]
      return next
    })
  }

  const handleCancel = () => {
    setIsReordering(false)
    setLocalEnvOrder([])
  }

  const handleDone = async () => {
    setSaving(true)

    await updateEnvOrder({
      variables: {
        appId,
        environmentOrder: localEnvOrder.map((e) => e.id),
      },
      refetchQueries: [{ query: GetAppEnvironments, variables: { appId } }],
      awaitRefetchQueries: true,
    })

    setSaving(false)
    setIsReordering(false)
    setLocalEnvOrder([])
  }

  return (
    <section className="space-y-4 pt-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="h3 font-semibold text-xl">Environments</h1>
            {userCanReadEnvironments ? (
              <p className="text-neutral-500 text-sm">
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
          {allowReordering && appEnvironments && appEnvironments.length > 1 && (
            <div className="flex items-center gap-2">
              {isReordering ? (
                <>
                  <Button variant="ghost" onClick={handleCancel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={handleDone} isLoading={saving}>
                    Done
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={handleStartReordering}>
                  <FaExchangeAlt className="text-xs" />
                  Reorder
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <LayoutGroup>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 1080p:grid-cols-6 gap-4 pt-4">
          {fetching && !appEnvironments?.length
            ? [...Array(3)].map((_, index) => (
                <EnvironmentCardSkeleton key={`env-skeleton-${index}`} />
              ))
            : null}
          {(isReordering ? localEnvOrder : appEnvironments)?.map(
            (env: EnvironmentType, index: number) => {
              const envList = isReordering ? localEnvOrder : appEnvironments!
              return (
                <motion.div key={env.id} layout layoutId={env.id} transition={{ duration: 0.2 }}>
                  <Card padding="p-3">
                    <div className="group flex flex-col h-full">
                      {/* Stretched link makes the entire card clickable (disabled during reordering) */}
                      {!isReordering && (
                        <Link
                          href={`${pathname}/environments/${env.id}`}
                          className="absolute inset-0 z-0"
                          aria-label={`Open ${env.name} environment`}
                        />
                      )}
                      <div className="flex gap-2 xl:gap-4">
                        <div className="w-full min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-base truncate min-w-0">
                              {env.name}
                            </div>
                            {!isReordering && (
                              <div className="relative z-10 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <ManageEnvironmentDialog environment={env} />
                              </div>
                            )}
                          </div>
                          <div className="text-neutral-500 text-xs">
                            {/* Text-based secrets and folder count on wider screens */}
                            <div className="hidden lg:block">
                              {env.secretCount} secrets{' '}
                              {env.folderCount! > 0 ? `across ${env.folderCount} folders` : ''}
                            </div>
                            {/* Icon-based secrets and folder count on narrower screens */}
                            <div className="flex items-center gap-3 lg:hidden">
                              <div
                                className="flex items-center gap-1.5"
                                title={`${env.secretCount} secrets`}
                              >
                                <FaKey className="text-sm" />
                                <span>{env.secretCount}</span>
                              </div>
                              <div
                                className="flex items-center gap-1.5"
                                title={`${env.folderCount} folders`}
                              >
                                <FaFolder className="text-sm" />
                                <span>{env.folderCount}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                      {!isReordering && (
                        <div className="flex items-center gap-1 text-xs text-emerald-500 mt-auto pt-2">
                          Explore <FaArrowRight />
                        </div>
                      )}
                      {isReordering && (
                        <div className="flex justify-between items-center mt-2">
                          <div>
                            {index !== 0 && (
                              <Button
                                variant="secondary"
                                disabled={saving}
                                title={`Move before ${envList[index - 1].name}`}
                                onClick={() => handleLocalSwap(index, index - 1)}
                              >
                                <FaArrowLeft className="text-xs shrink-0 my-0.5" />
                              </Button>
                            )}
                          </div>
                          <div>
                            {index !== envList.length - 1 && (
                              <Button
                                variant="secondary"
                                disabled={saving}
                                title={`Move after ${envList[index + 1].name}`}
                                onClick={() => handleLocalSwap(index, index + 1)}
                              >
                                <FaArrowRight className="text-xs shrink-0 my-0.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
              )
            }
          )}

          {userCanCreateEnvironments && (
            <Card>
              <div className="flex flex-col w-full h-full min-w-0">
                <div className="mx-auto my-auto max-w-full">
                  <CreateEnvironmentDialog appId={appId} />
                </div>
              </div>
            </Card>
          )}
        </div>
      </LayoutGroup>
    </section>
  )
}
