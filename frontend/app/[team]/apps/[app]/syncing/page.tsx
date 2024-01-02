'use client'

import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import InitAppSyncing from '@/graphql/mutations/syncing/initAppSync.gql'
import GetEnvironmentKey from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import GetCfPages from '@/graphql/queries/syncing/cloudflare/getPages.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForServer } from '@/utils/environments'
import { EnvironmentSyncType, EnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { OrganisationKeyring, cryptoUtils } from '@/utils/auth'
import { Dialog, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { useState, Fragment, useContext } from 'react'
import { FaTimes, FaEyeSlash, FaEye, FaSync } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { useSession } from 'next-auth/react'
import { Alert } from '@/components/common/Alert'
import { SyncCard } from '@/components/syncing/SyncCard'
import { ManageSyncDialog } from '@/components/syncing/ManageSyncDialog'
import { SyncOptions } from '@/components/syncing/SyncOptions'
import { useSearchParams } from 'next/navigation'
import { userIsAdmin } from '@/utils/permissions'

export default function Syncing({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring, setKeyring } = useContext(KeyringContext)

  const searchParams = useSearchParams()

  const openCreateSyncPanel = searchParams.get('newSync')

  const { data } = useQuery(GetAppSyncStatus, {
    variables: { appId: params.app },
    pollInterval: 10000,
  })

  const [getCloudflarePages] = useLazyQuery(GetCfPages)

  const { data: session } = useSession()

  const validateKeyring = async (password: string) => {
    return new Promise<OrganisationKeyring>(async (resolve) => {
      if (keyring) resolve(keyring)
      else {
        const decryptedKeyring = await cryptoUtils.getKeyring(
          session?.user?.email!,
          organisation!.id,
          password
        )
        setKeyring(decryptedKeyring)
        resolve(decryptedKeyring)
      }
    })
  }

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const EnableSyncingDialog = () => {
    const [enableSyncing, { loading }] = useMutation(InitAppSyncing)
    const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

    const { data: appEnvsData } = useQuery(GetAppEnvironments, {
      variables: {
        appId: params.app,
      },
    })

    const [isOpen, setIsOpen] = useState<boolean>(false)

    const [password, setPassword] = useState<string>('')
    const [showPw, setShowPw] = useState<boolean>(false)

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    const handleEnableSyncing = async (e: { preventDefault: () => void }) => {
      e.preventDefault()

      const keyring = await validateKeyring(password)

      const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

      const envKeyPromises = appEnvironments.map(async (env: EnvironmentType) => {
        const { data: envKeyData } = await getEnvKey({
          variables: {
            envId: env.id,
            appId: params.app,
          },
        })

        const {
          wrappedSeed: userWrappedSeed,
          wrappedSalt: userWrappedSalt,
          identityKey,
        } = envKeyData.environmentKeys[0]

        const { seed, salt } = await unwrapEnvSecretsForUser(
          userWrappedSeed,
          userWrappedSalt,
          keyring!
        )

        const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForServer(
          { seed, salt },
          data.serverPublicKey
        )

        return {
          envId: env.id,
          identityKey,
          wrappedSeed,
          wrappedSalt,
        }
      })

      const envKeyInputs = await Promise.all(envKeyPromises)

      toast.promise(
        enableSyncing({
          variables: { appId: params.app, envKeys: envKeyInputs },
          refetchQueries: [
            {
              query: GetAppSyncStatus,
              variables: { appId: params.app },
            },
          ],
        }),
        {
          pending: 'Enabling syncing...',
          success: 'Syncing enabled for this App!',
        }
      )
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="primary" onClick={openModal} title="Manage access">
            <FaSync /> Enable Syncing
          </Button>
        </div>

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
                    <Dialog.Title as="div" className="flex w-full justify-between">
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        Enable syncing for this app
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <form className={clsx('space-y-6 p-4')} onSubmit={handleEnableSyncing}>
                      <Alert variant="warning" icon={true}>
                        Enabling syncing for this App will allow the server to access secrets in all
                        environments.
                      </Alert>

                      {!keyring && (
                        <div className="space-y-2 w-full">
                          <label
                            className="block text-gray-700 text-sm font-bold mb-2"
                            htmlFor="password"
                          >
                            Sudo password
                          </label>
                          <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                            <input
                              id="password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              type={showPw ? 'text' : 'password'}
                              minLength={16}
                              required
                              autoFocus
                              className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
                            />
                            <button
                              className="bg-zinc-100 dark:bg-zinc-800 px-4 text-neutral-500 rounded-md"
                              type="button"
                              onClick={() => setShowPw(!showPw)}
                              tabIndex={-1}
                            >
                              {showPw ? <FaEyeSlash /> : <FaEye />}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="primary" type="submit" isLoading={loading}>
                          Enable
                        </Button>
                      </div>
                    </form>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </>
    )
  }

  return (
    <div className="w-full space-y-8 pt-8 text-black dark:text-white">
      {data?.syncEnabled === false && (
        <div className="flex flex-col gap-4 h-96 items-center justify-center">
          <div className="space-y-1 text-center">
            <div className="text-black dark:text-white text-3xl font-semibold">Enable syncing</div>
            <div className="text-neutral-500 text-lg">
              Syncing is not yet enabled for this app. Click the button below to enable syncing.
            </div>
          </div>
          <EnableSyncingDialog />
        </div>
      )}
      {data?.syncEnabled === true && (
        <>
          {data.syncs && data.syncs.length > 0 && (
            <div className="flex flex-col gap-4 border-b border-neutral-500/40 pb-8">
              <div className="text-2xl font-semibold pb-4">Active Syncs</div>
              {data.syncs.map((sync: EnvironmentSyncType) => (
                <SyncCard key={sync.id} sync={sync} showAppName={false} showManageButton={true} />
              ))}
            </div>
          )}

          {activeUserIsAdmin && (
            <SyncOptions
              appId={params.app}
              defaultOpen={openCreateSyncPanel || (data.syncs && data.syncs.length === 0)}
            />
          )}
        </>
      )}
    </div>
  )
}
