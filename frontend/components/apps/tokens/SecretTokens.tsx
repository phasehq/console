import { RevokeServiceToken } from '@/graphql/mutations/environments/deleteServiceToken.gql'
import { GetServiceTokens } from '@/graphql/queries/secrets/getServiceTokens.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { EnvironmentType, ServiceTokenType, UserTokenType } from '@/apollo/graphql'
import { useMutation, useQuery } from '@apollo/client'
import { useState, useContext, Fragment } from 'react'
import { Button } from '@/components/common/Button'
import { FaExclamationTriangle, FaTimes, FaTrashAlt } from 'react-icons/fa'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Transition } from '@headlessui/react'
import { clsx } from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { Avatar } from '@/components/common/Avatar'
import { CreateServiceTokenDialog } from './CreateServiceTokenDialog'
import { MdKey } from 'react-icons/md'
import { toast } from 'react-toastify'
import Spinner from '@/components/common/Spinner'
import { EmptyState } from '@/components/common/EmptyState'
import Link from 'next/link'
import { Alert } from '@/components/common/Alert'

export const SecretTokens = (props: { organisationId: string; appId: string }) => {
  const { organisationId, appId } = props

  const [deleteServiceToken] = useMutation(RevokeServiceToken)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadTokens = userHasPermission(
    organisation?.role?.permissions,
    'Tokens',
    'read',
    true
  )

  const usercanCreateTokens =
    userHasPermission(organisation?.role?.permissions, 'Tokens', 'create', true) &&
    userHasPermission(organisation?.role?.permissions, 'Environments', 'read', true)

  const { data: serviceTokensData, loading } = useQuery(GetServiceTokens, {
    variables: {
      appId,
    },
    skip: !userCanReadTokens,
  })

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
    toast.success('Service token deleted')
  }

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
            <div className="text-white dark:text-red-500 flex items-center gap-1">
              <FaTrashAlt /> Revoke
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

    const userCanReadEnvironments = organisation
      ? userHasPermission(organisation.role?.permissions, 'Environments', 'read', true)
      : false

    const userCanDeleteTokens = organisation
      ? userHasPermission(organisation.role?.permissions, 'Tokens', 'delete', true)
      : false

    const identityKeys = token.keys.map((key) => key.identityKey)

    const { data } = useQuery(GetAppEnvironments, {
      variables: {
        appId,
      },
      skip: !userCanReadEnvironments,
    })

    const tokenEnvironments = data?.appEnvironments.filter((env: EnvironmentType) =>
      identityKeys.includes(env.identityKey)
    )

    return (
      <div className="flex items-center w-full justify-between p-2 group bg-neutral-100 dark:bg-neutral-800 rounded-lg ring-1 ring-inset ring-neutral-500/20">
        <div className="flex items-center gap-4">
          <MdKey className="text-neutral-500 text-3xl" />
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
                {tokenEnvironments?.map(({ name }: { name: string }) => (
                  <div
                    key={name}
                    className="rounded-full py-0.5 px-2 text-zinc-700 ring-1 ring-inset ring-zinc-900/10 dark:text-zinc-400 dark:ring-white/10 text-xs font-medium"
                  >
                    {name}
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
        {userCanDeleteTokens && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <DeleteConfirmDialog token={token} onDelete={deleteHandler} />
          </div>
        )}
      </div>
    )
  }

  if (loading)
    return (
      <div className="w-full h-full flex items-center justify-center p-40">
        <Spinner size="md" />
      </div>
    )

  if (serviceTokensData?.serviceTokens.length === 0)
    return (
      <div>
        <EmptyState
          title="Deprecated"
          subtitle="Service tokens are deprecated. Please use a Service Account instead"
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaExclamationTriangle />
            </div>
          }
        >
          <div className="flex flex-col items-center gap-2">
            <div className="text-lg text-center">
              Service Accounts give you better control over access to secrets across apps, and let
              you manage permissions more easily via defined roles.
            </div>
            <Link href={`/${organisation?.name}/apps/${appId}/access/service-accounts`}>
              <Button variant="primary">Go to Service Accounts</Button>
            </Link>
          </div>
        </EmptyState>
      </div>
    )

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

        <Alert variant="warning" icon={true}>
          <div className="flex flex-col gap-2">
            <p className="text-lg font-semibold">
              Service Tokens are being deprecated in favour of Service Accounts.
            </p>
            <p>
              Service Accounts give you better control over access to secrets across apps, and let
              you manage permissions more easily via defined roles.
            </p>
            <Link href={`/${organisation?.name}/apps/${appId}/access/service-accounts`}>
              <Button variant="primary">Go to Service Accounts</Button>
            </Link>
          </div>
        </Alert>

        {usercanCreateTokens && (
          <div className="flex justify-end py-4 border-b border-neutral-500/40">
            <CreateServiceTokenDialog organisationId={organisationId} appId={appId} />
          </div>
        )}

        {serviceTokensData?.serviceTokens.length > 0 ? (
          <div className="space-y-4">
            {serviceTokensData?.serviceTokens.map((serviceToken: ServiceTokenType) => (
              <CreatedToken
                key={serviceToken.id}
                token={serviceToken}
                deleteHandler={handleDeleteServiceToken}
              />
            ))}
          </div>
        ) : (
          <div className="p-40 flex flex-col items-center justify-center border border-neutral-500/20 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <div className="text-black dark:text-white font-semibold text-2xl">No tokens</div>
            <div className="text-neutral-500 text-lg">
              You haven&apos;t created any Service Tokens yet. Create one to get started.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
