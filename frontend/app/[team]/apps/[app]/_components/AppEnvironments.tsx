'use client'

import { EnvironmentType, ApiOrganisationPlanChoices } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { CreateEnvironmentDialog } from '@/components/environments/CreateEnvironmentDialog'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useContext } from 'react'
import { BsListColumnsReverse } from 'react-icons/bs'
import { FaArrowRight, FaBan, FaExchangeAlt, FaFolder, FaKey } from 'react-icons/fa'
import { EmptyState } from '@/components/common/EmptyState'
import { useAppSecrets } from '../_hooks/useAppSecrets'
import { motion } from 'framer-motion'

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

  const { appEnvironments, swapEnvironments, fetching } = useAppSecrets(
    appId,
    userCanReadEnvironments,
    10000 // Poll every 10 seconds
  )

  const allowReordering =
    organisation?.plan !== ApiOrganisationPlanChoices.Fr && userCanUpdateEnvironments

  const pathname = usePathname()

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
          <motion.div
            key={env.id}
            layout
            transition={{ duration: 0.25, ease: 'easeOut', delay: 0.15 }}
          >
            <Card>
              <div className="group">
                <div className="flex gap-4">
                  <div className="pt-1.5">
                    <BsListColumnsReverse className="text-black dark:text-white text-2xl" />
                  </div>
                  <div className="space-y-6 w-full min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`${pathname}/environments/${env.id}`} className="group min-w-0">
                        <div className="font-semibold text-lg truncate">{env.name}</div>
                        <div className="text-neutral-500">
                          {/* Text-based secrets and folder count on wider screens */}
                          <div className="hidden lg:block">
                            {env.secretCount} secrets across {env.folderCount} folders
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
                          disabled={fetching}
                          title={`Swap with ${appEnvironments[index - 1].name}`}
                          onClick={() => swapEnvironments(env.id, appEnvironments[index - 1].id)}
                        >
                          <FaExchangeAlt className="text-xs shrink-0" />
                        </Button>
                      )}
                    </div>
                    <div>
                      {index !== appEnvironments.length - 1 && (
                        <Button
                          variant="secondary"
                          disabled={fetching}
                          title={`Swap with ${appEnvironments[index + 1].name}`}
                          onClick={() => swapEnvironments(env.id, appEnvironments[index + 1].id)}
                        >
                          <FaExchangeAlt className="text-xs shrink-0" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
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
