import { EnvironmentType } from '@/apollo/graphql'
import { useMutation, useLazyQuery, useQuery } from '@apollo/client'
import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment, useContext } from 'react'
import { FaTimes, FaUsers } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { Alert } from '../common/Alert'
import { Button } from '../common/Button'
import { KeyringContext } from '@/contexts/keyringContext'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import InitAppSyncing from '@/graphql/mutations/syncing/initAppSync.gql'
import GetEnvironmentKey from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { FaServer } from 'react-icons/fa6'
import { organisationContext } from '@/contexts/organisationContext'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForServer } from '@/utils/crypto'
import { userHasPermission, userIsAdmin } from '@/utils/access/permissions'
import Link from 'next/link'

export const EnableSSEDialog = (props: { appId: string }) => {
  const { appId } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const { data } = useQuery(GetServerKey)
  const [enableSse, { loading }] = useMutation(InitAppSyncing)
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  const userCanEnableSSE = organisation
    ? userHasPermission(organisation.role?.permissions, 'EncryptionMode', 'update', true)
    : false

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleEnableSse = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

    const envKeyPromises = appEnvironments.map(async (env: EnvironmentType) => {
      const { data: envKeyData } = await getEnvKey({
        variables: {
          envId: env.id,
          appId,
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
      enableSse({
        variables: { appId, envKeys: envKeyInputs },
        refetchQueries: [
          {
            query: GetAppSyncStatus,
            variables: { appId },
          },
          {
            query: GetAppDetail,
            variables: { appId, organisationId: organisation!.id },
          },
        ],
      }),
      {
        pending: 'Enabling SSE...',
        success: 'SSE enabled for this App!',
      }
    )
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="primary" onClick={openModal} title="Manage access">
          <FaServer /> Enable SSE
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
                      Enable SSE
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  {userCanEnableSSE ? (
                    <form className="space-y-6 py-4" onSubmit={handleEnableSse}>
                      <p className="text-neutral-500">
                        Enable server-side encryption (SSE) for this App if you want to:
                      </p>
                      <ul className="text-neutral-500 list-disc list-inside">
                        <li>Set up automatic syncing of secrets via third-party integrations</li>
                        <li>Create and manage dynamic secrets</li>
                        <li>Access and update secrets over the API</li>
                      </ul>

                      <Alert variant="info" icon={true}>
                        Enabling server-side encryption for this App will allow the server to access
                        secrets in all environments.
                      </Alert>

                      <div className="flex items-center gap-4 justify-between">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="primary" type="submit" isLoading={loading}>
                          Enable
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="py-4 space-y-4">
                      <Alert variant="info" icon={true}>
                        Only Organisation Owners and Admins can enable SSE for this App. Please
                        contact the Organisation Owner or Admins to enable SSE.
                      </Alert>

                      <div className="flex items-center justify-end">
                        <Link href={`/${organisation?.name}/apps/${appId}/members`}>
                          <Button variant="secondary">
                            <FaUsers /> View App Members
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
