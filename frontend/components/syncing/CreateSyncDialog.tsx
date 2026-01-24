import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment, ReactNode, ReactElement, useContext } from 'react'
import { FaBan, FaCheckCircle, FaTimes, FaTimesCircle } from 'react-icons/fa'
import { Button } from '../common/Button'
import { CreateCloudflarePagesSync } from './Cloudflare/CreateCloudflarePagesSync'
import React from 'react'
import { CreateAWSSecretsSync } from './AWS/CreateAWSSecretsSync'
import { CreateGhActionsSync } from './GitHub/CreateGhActionsSync'
import { CreateGhDependabotSync } from './GitHub/CreateGhDependabotSync'
import { CreateVaultSync } from './Vault/CreateVaultSync'
import { CreateNomadSync } from './Nomad/CreateNomadSync'
import { CreateGitLabCISync } from './GitLab/CreateGitLabCISync'
import { CreateRailwaySync } from './Railway/CreateRailwaySync'
import { CreateVercelSync } from './Vercel/CreateVercelSync'
import { CreateCloudflareWorkersSync } from './Cloudflare/CreateCloudflareWorkersSync'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '../common/EmptyState'
import clsx from 'clsx'
import { CreateRenderSync } from './Render/CreateRenderSync'

export const CreateSyncDialog = (props: {
  appId: string
  button: ReactElement

  service: string
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadEnvs = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'read',
    true
  )

  const userCanCreateIntegrations = userHasPermission(
    organisation?.role?.permissions,
    'Integrations',
    'create',
    true
  )

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const renderSyncPanel = (service: string) => {
    switch (service) {
      case 'aws_secrets_manager':
        return <CreateAWSSecretsSync appId={props.appId} closeModal={closeModal} />
      case 'cloudflare_pages':
        return <CreateCloudflarePagesSync appId={props.appId} closeModal={closeModal} />
      case 'github_actions':
        return <CreateGhActionsSync appId={props.appId} closeModal={closeModal} />
      case 'github_dependabot':
        return <CreateGhDependabotSync appId={props.appId} closeModal={closeModal} />
      case 'gitlab_ci':
        return <CreateGitLabCISync appId={props.appId} closeModal={closeModal} />
      case 'hashicorp_vault':
        return <CreateVaultSync appId={props.appId} closeModal={closeModal} />
      case 'hashicorp_nomad':
        return <CreateNomadSync appId={props.appId} closeModal={closeModal} />
      case 'railway':
        return <CreateRailwaySync appId={props.appId} closeModal={closeModal} />
      case 'vercel':
        return <CreateVercelSync appId={props.appId} closeModal={closeModal} />
      case 'cloudflare_workers':
        return <CreateCloudflareWorkersSync appId={props.appId} closeModal={closeModal} />
      case 'render':
        return <CreateRenderSync appId={props.appId} closeModal={closeModal} />

      default:
        return null
    }
  }

  return (
    <>
      <div onClick={openModal}>{props.button}</div>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={closeModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-screen-md transform rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg leading-6 text-neutral-500">Create a Sync</h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  {userCanReadEnvs && userCanCreateIntegrations ? (
                    <div className="pt-4">{isOpen && renderSyncPanel(props.service)}</div>
                  ) : (
                    <EmptyState
                      title="Access restricted"
                      subtitle="You don't have the permissions required to set up an Sync"
                      graphic={
                        <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                          <FaBan />
                        </div>
                      }
                    >
                      <div className="space-y-2 p-4 ring-1 ring-inset ring-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 rounded-md">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          The following permissions are required:
                        </div>
                        <ul className="text-sm">
                          <li className="flex items-center gap-2">
                            {userCanReadEnvs ? (
                              <FaCheckCircle className="text-emerald-500" />
                            ) : (
                              <FaTimesCircle className="text-red-500" />
                            )}
                            <code
                              className={clsx(
                                userCanReadEnvs
                                  ? 'text-neutral-500'
                                  : 'text-zinc-900 dark:text-zinc-100 font-medium'
                              )}
                            >
                              Environments:read
                            </code>
                          </li>
                          <li className="flex items-center gap-2">
                            {userCanCreateIntegrations ? (
                              <FaCheckCircle className="text-emerald-500" />
                            ) : (
                              <FaTimesCircle className="text-red-500" />
                            )}
                            <code
                              className={clsx(
                                userCanCreateIntegrations
                                  ? 'text-neutral-500'
                                  : 'text-zinc-900 dark:text-zinc-100 font-medium'
                              )}
                            >
                              Integrations:create
                            </code>
                          </li>
                        </ul>
                      </div>
                    </EmptyState>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
