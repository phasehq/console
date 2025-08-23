import { ServiceAccountType } from '@/apollo/graphql'
import { useMutation, useQuery } from '@apollo/client'
import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment, useContext } from 'react'
import { FaTimes, FaCog, FaUsers } from 'react-icons/fa'
import { FaServer, FaArrowDownUpLock } from 'react-icons/fa6'
import { MdMenuBook } from 'react-icons/md'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { Alert } from '../common/Alert'
import { Button } from '../common/Button'
import { KeyringContext } from '@/contexts/keyringContext'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
import { GetServiceAccountDetail } from '@/graphql/queries/service-accounts/getServiceAccountDetail.gql'
import { organisationContext } from '@/contexts/organisationContext'
import {
  unwrapServiceAccountSecretsForUser,
  wrapServiceAccountSecretsForServer,
} from '@/utils/crypto/service-accounts'
import { userHasPermission } from '@/utils/access/permissions'
import Link from 'next/link'
import EnableServerSide from '@/graphql/mutations/service-accounts/enableServiceAccountServerSideKeyManagement.gql'
import EnableClientSide from '@/graphql/mutations/service-accounts/enableServiceAccountClientSideKeyManagement.gql'

interface KeyManagementDialogProps {
  serviceAccount: ServiceAccountType
  trigger?: React.ReactNode
  mode?: 'enable' | 'manage'
}

export const KeyManagementDialog = (props: KeyManagementDialogProps) => {
  const { serviceAccount, trigger, mode = 'manage' } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const { data: serverKeyData } = useQuery(GetServerKey)
  const [enableSSE, { loading: enableLoading }] = useMutation(EnableServerSide)
  const [disableSSE, { loading: disableLoading }] = useMutation(EnableClientSide)

  const userCanManageKeys = organisation
    ? userHasPermission(organisation.role?.permissions, 'ServiceAccounts', 'update')
    : false

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [selectedMode, setSelectedMode] = useState<'client' | 'server'>(
    serviceAccount.serverSideKeyManagementEnabled ? 'server' : 'client'
  )

  const closeModal = () => {
    setIsOpen(false)
    // Reset to current state when closing
    setSelectedMode(serviceAccount.serverSideKeyManagementEnabled ? 'server' : 'client')
  }

  const openModal = () => {
    // Always sync mode with latest account state on open
    setSelectedMode(serviceAccount.serverSideKeyManagementEnabled ? 'server' : 'client')
    setIsOpen(true)
  }

  const handleSave = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (selectedMode === 'server' && !serviceAccount.serverSideKeyManagementEnabled) {
      // Enable server-side encryption
      await handleEnableSSE()
    } else if (selectedMode === 'client' && serviceAccount.serverSideKeyManagementEnabled) {
      // Disable server-side encryption (switch to client-side)
      await handleDisableSSE()
    } else {
      // No change needed
      closeModal()
    }
  }

  const handleEnableSSE = async () => {
    if (!keyring || !serverKeyData?.serverPublicKey) {
      toast.error('Missing required keys')
      return
    }

    try {
      // Find the current user's handler for this service account
      const currentUserHandler = serviceAccount.handlers?.find(
        (handler) => handler?.user.self === true
      )

      if (!currentUserHandler) {
        toast.error('You do not have handler access to this service account')
        return
      }

      // Unwrap the service account secrets using the current user's keys
      const { keyringString, recoveryString } = await unwrapServiceAccountSecretsForUser(
        currentUserHandler.wrappedKeyring,
        currentUserHandler.wrappedRecovery,
        keyring
      )

      // Wrap the secrets for the server
      const { serverWrappedKeyring, serverWrappedRecovery } =
        await wrapServiceAccountSecretsForServer(
          keyringString,
          recoveryString,
          serverKeyData.serverPublicKey
        )

      await toast.promise(
        enableSSE({
          variables: {
            serviceAccountId: serviceAccount.id,
            serverWrappedKeyring,
            serverWrappedRecovery,
          },
          refetchQueries: [
            {
              query: GetServiceAccountDetail,
              variables: { orgId: organisation!.id, id: serviceAccount.id },
            },
          ],
        }),
        {
          pending: 'Enabling server-side key management...',
          success: 'Server-side key management enabled.',
          error: 'Failed to enable server-side key management',
        }
      )
      // Ensure local state reflects new server-side mode
      setSelectedMode('server')
      closeModal()
    } catch (error) {
      console.error('Error enabling SSE:', error)
      toast.error('Failed to enable server-side key management')
    }
  }

  const handleDisableSSE = async () => {
    try {
      await toast.promise(
        disableSSE({
          variables: {
            serviceAccountId: serviceAccount.id,
          },
          refetchQueries: [
            {
              query: GetServiceAccountDetail,
              variables: { orgId: organisation!.id, id: serviceAccount.id },
            },
          ],
        }),
        {
          pending: 'Switching to client-side key management...',
          success: 'Client-side key management enabled.',
          error: 'Failed to switch to client-side key management',
        }
      )
      // Ensure local state reflects new client-side mode
      setSelectedMode('client')
      closeModal()
    } catch (error) {
      console.error('Error disabling SSE:', error)
      toast.error('Failed to switch to client-side key management')
    }
  }

  const currentMode = serviceAccount.serverSideKeyManagementEnabled ? 'server' : 'client'
  const hasChanges = selectedMode !== currentMode

  return (
    <>
      {trigger ? (
        <div onClick={openModal} className="cursor-pointer">
          {trigger}
        </div>
      ) : (
        <div className="flex items-center justify-center">
          <Button variant="primary" onClick={openModal} title="Manage Key Settings">
            <FaCog /> Manage
          </Button>
        </div>
      )}

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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between items-center">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Key Management Settings
                    </h3>

                    <div className="flex items-center gap-2">
                      <Link
                        href="https://docs.phase.dev/access-control/service-accounts"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Button type="button" variant="outline">
                          <MdMenuBook className="my-1 shrink-0" />
                          Docs
                        </Button>
                      </Link>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </div>
                  </Dialog.Title>

                  {userCanManageKeys ? (
                    <form className="space-y-6 py-4" onSubmit={handleSave}>
                      <p className="text-neutral-500">
                        Choose where and how keys are managed for this Service Account:
                      </p>

                      <div className="space-y-4">
                        {/* Client-side option */}
                        <label
                          className={clsx(
                            'flex items-start gap-3 p-4 rounded-lg cursor-pointer transition-colors ring-1 ring-inset',
                            selectedMode === 'client'
                              ? 'bg-emerald-400/10 ring-emerald-400/30'
                              : 'ring-neutral-500/20 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                          )}
                        >
                          <input
                            type="radio"
                            name="keyManagement"
                            value="client"
                            checked={selectedMode === 'client'}
                            onChange={(e) => setSelectedMode('client')}
                            className="sr-only peer"
                          />
                          <span
                            className={clsx(
                              'mt-1 h-4 w-4 rounded-full border flex items-center justify-center shrink-0',
                              selectedMode === 'client'
                                ? 'border-emerald-500'
                                : 'border-neutral-400'
                            )}
                          >
                            <span
                              className={clsx(
                                'h-2.5 w-2.5 rounded-full transition-colors',
                                selectedMode === 'client' ? 'bg-emerald-500' : 'bg-transparent'
                              )}
                            />
                          </span>
                          <div className="flex-1">
                            <div
                              className={clsx(
                                'flex items-center gap-2 font-medium',
                                selectedMode === 'client'
                                  ? 'text-emerald-600'
                                  : 'text-black dark:text-white'
                              )}
                            >
                              <FaArrowDownUpLock
                                className={clsx(
                                  selectedMode === 'client' ? 'text-emerald-500' : ''
                                )}
                              />
                              Client-side key management
                            </div>
                            <p className="text-sm text-neutral-500 mt-1">
                              Handle all cryptographic operations such as token generation on the
                              client with end-to-end encryption. Requires manual intervention.
                            </p>
                          </div>
                        </label>

                        {/* Server-side option */}
                        <label
                          className={clsx(
                            'flex items-start gap-3 p-4 rounded-lg cursor-pointer transition-colors ring-1 ring-inset',
                            selectedMode === 'server'
                              ? 'bg-sky-400/10 ring-sky-400/30'
                              : 'ring-neutral-500/20 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                          )}
                        >
                          <input
                            type="radio"
                            name="keyManagement"
                            value="server"
                            checked={selectedMode === 'server'}
                            onChange={(e) => setSelectedMode('server')}
                            className="sr-only peer"
                          />
                          <span
                            className={clsx(
                              'mt-1 h-4 w-4 rounded-full border flex items-center justify-center shrink-0',
                              selectedMode === 'server' ? 'border-sky-500' : 'border-neutral-400'
                            )}
                          >
                            <span
                              className={clsx(
                                'h-2.5 w-2.5 rounded-full transition-colors',
                                selectedMode === 'server' ? 'bg-sky-500' : 'bg-transparent'
                              )}
                            />
                          </span>
                          <div className="flex-1">
                            <div
                              className={clsx(
                                'flex items-center gap-2 font-medium',
                                selectedMode === 'server'
                                  ? 'text-sky-600'
                                  : 'text-black dark:text-white'
                              )}
                            >
                              <FaServer
                                className={clsx(selectedMode === 'server' ? 'text-sky-500' : '')}
                              />
                              Server-side key management
                            </div>
                            <p className="text-sm text-neutral-500 mt-1">
                              Allow the server to manage keys on behalf of the Service Account.
                              Enables automated operations, token generation, and API access without
                              manual intervention.
                            </p>
                          </div>
                        </label>
                      </div>

                      {hasChanges &&
                        selectedMode === 'server' &&
                        !serviceAccount.serverSideKeyManagementEnabled && (
                          <Alert variant="info" icon={true}>
                            Enabling server-side key management will allow the server to securely
                            access keys and generate tokens on behalf of the Service Account.
                          </Alert>
                        )}

                      {hasChanges &&
                        selectedMode === 'client' &&
                        serviceAccount.serverSideKeyManagementEnabled && (
                          <Alert variant="warning" icon={true}>
                            Switching to client-side key management will remove server access to
                            this account&apos;s keys. All previously generated access tokens will
                            continue to work until they expire.
                          </Alert>
                        )}

                      <div className="flex items-center gap-4 justify-between">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          type="submit"
                          isLoading={enableLoading || disableLoading}
                          disabled={!hasChanges}
                        >
                          Save
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="py-4 space-y-4">
                      <Alert variant="info" icon={true}>
                        Only users with Service Account update permissions can manage key settings
                        for this Service Account. Please contact an Organization Owner or Admin.
                      </Alert>

                      <div className="flex items-center justify-end">
                        <Link href={`/${organisation?.name}/access/service-accounts`}>
                          <Button variant="secondary">
                            <FaUsers /> View Service Accounts
                          </Button>
                        </Link>
                      </div>
                    </div>
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
