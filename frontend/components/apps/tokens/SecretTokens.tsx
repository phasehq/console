import { RevokeServiceToken } from '@/graphql/mutations/environments/deleteServiceToken.gql'

import { GetServiceTokens } from '@/graphql/queries/secrets/getServiceTokens.gql'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { EnvironmentType, ServiceTokenType, UserTokenType } from '@/apollo/graphql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useState, useEffect, useContext, Fragment } from 'react'
import { Button } from '@/components/common/Button'
import { FaKey, FaTimes, FaTrashAlt } from 'react-icons/fa'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Transition } from '@headlessui/react'
import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import clsx from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import { userIsAdmin } from '@/utils/permissions'
import { Avatar } from '@/components/common/Avatar'
import { CreateServiceTokenDialog } from './CreateServiceTokenDialog'

export const SecretTokens = (props: { organisationId: string; appId: string }) => {
  const { organisationId, appId } = props

  const [getServiceTokens, { data: serviceTokensData }] = useLazyQuery(GetServiceTokens)

  const [deleteServiceToken] = useMutation(RevokeServiceToken)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const handleDeleteServiceToken = async (tokenId: string) => {
    await deleteServiceToken({
      variables: { tokenId },
      refetchQueries: [
        {
          query: GetServiceTokens,
          variables: {
            organisationId,
            appId,
          },
        },
      ],
    })
  }

  useEffect(() => {
    if (organisationId && appId) {
      getServiceTokens({
        variables: {
          appId,
        },
      })
    }
  }, [appId, getServiceTokens, organisationId])

  const DeleteConfirmDialog = (props: {
    token: UserTokenType | ServiceTokenType
    onDelete: Function
  }) => {
    const { token, onDelete } = props

    const [isOpen, setIsOpen] = useState<boolean>(false)

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="danger" onClick={openModal} title="Delete Token">
            <div className="text-white dark:text-red-500 flex items-center gap-1 p-1">
              <FaTrashAlt />
            </div>
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
                        Delete{' '}
                        <span className="text-zinc-700 dark:text-zinc-200 font-mono">
                          {token.name}
                        </span>
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-6 p-4">
                      <p className="text-neutral-500">
                        Are you sure you want to delete this token?
                      </p>
                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="danger" onClick={() => onDelete(token.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </>
    )
  }

  const CreatedToken = (props: { token: ServiceTokenType; deleteHandler: Function }) => {
    const { token, deleteHandler } = props

    const isExpired = token.expiresAt === null ? false : new Date(token.expiresAt) < new Date()

    const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

    const allowDelete = activeUserIsAdmin || token.createdBy!.self

    const identityKeys = token.keys.map((key) => key.identityKey)

    const { data } = useQuery(GetAppEnvironments, {
      variables: {
        appId,
      },
    })

    const tokenEnvironments = data?.appEnvironments.filter((env: EnvironmentType) =>
      identityKeys.includes(env.identityKey)
    )

    return (
      <div className="flex items-center w-full justify-between p-2 group bg-neutral-100 dark:bg-neutral-800 rounded-lg ring-1 ring-inset ring-neutral-500/20">
        <div className="flex items-center gap-4">
          <FaKey className="text-emerald-500 text-lg" />
          <div className="space-y-0">
            <div className="text-lg font-medium">{token.name}</div>
            <div className="flex items-center gap-8 text-sm text-neutral-500">
              <div className="flex items-center gap-2">
                <div>Created {relativeTimeFromDates(new Date(token.createdAt))}</div>
                {token.__typename === 'ServiceTokenType' && (
                  <div className="flex items-center gap-2">
                    <span>by</span>
                    <Avatar imagePath={token.createdBy?.avatarUrl!} size="sm" />
                    {token.createdBy?.self
                      ? 'You'
                      : token.createdBy?.fullName || token.createdBy?.email}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {tokenEnvironments?.map(({ envType }: { envType: string }) => (
                  <div
                    key={envType}
                    className="rounded-full py-0.5 px-2 text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:text-zinc-400 dark:ring-white/10 tracking-widest text-xs font-medium"
                  >
                    {envType}
                  </div>
                ))}
              </div>

              <div className={clsx(isExpired && 'text-red-500')}>
                {isExpired ? 'Expired' : 'Expires'}{' '}
                {token.expiresAt ? relativeTimeFromDates(new Date(token.expiresAt)) : 'never'}
              </div>
            </div>
          </div>
        </div>
        {allowDelete && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <DeleteConfirmDialog token={token} onDelete={deleteHandler} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-6 divide-y-2 divide-neutral-500/40">
      <div className="space-y-4 py-4">
        <div>
          <h3 className="text-2xl font-semibold border-neutral-500/40">Service tokens</h3>
          <p className="text-neutral-500">
            Tokens used to authenticate this app with the CLI, SDKs or API from automated machines.
            Used for CI and production environments.
          </p>
        </div>

        <div className="flex justify-end py-4">
          <CreateServiceTokenDialog organisationId={organisationId} appId={appId} />
        </div>

        <div className="space-y-4">
          {serviceTokensData?.serviceTokens.map((serviceToken: ServiceTokenType) => (
            <CreatedToken
              key={serviceToken.id}
              token={serviceToken}
              deleteHandler={handleDeleteServiceToken}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
