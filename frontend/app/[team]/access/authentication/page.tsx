'use client'

import { RevokeUserToken } from '@/graphql/mutations/users/deleteUserToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { ServiceTokenType, UserTokenType } from '@/apollo/graphql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useState, useEffect, useContext, Fragment } from 'react'
import { Button } from '@/components/common/Button'
import { FaKey, FaTimes, FaTrashAlt, FaUserSecret } from 'react-icons/fa'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Transition } from '@headlessui/react'

import clsx from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateUserTokenDialog } from '@/components/apps/tokens/CreateUserTokenDialog'
import { Avatar } from '@/components/common/Avatar'
import { FaUserShield } from 'react-icons/fa6'

export default function UserTokens({ params }: { params: { team: string } }) {
  const [deleteUserToken] = useMutation(RevokeUserToken)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const organisationId = organisation?.id

  const { data: userTokensData } = useQuery(GetUserTokens, {
    variables: {
      organisationId,
    },
    skip: !organisation,
    fetchPolicy: 'cache-and-network',
  })

  const handleDeleteUserToken = async (tokenId: string) => {
    await deleteUserToken({
      variables: { tokenId },
      refetchQueries: [
        {
          query: GetUserTokens,
          variables: {
            organisationId,
          },
        },
      ],
    })
  }

  const userTokens =
    [...(userTokensData?.userTokens || [])].sort((a: UserTokenType, b: UserTokenType) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }) || []

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
              <FaTrashAlt /> Delete
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

  const CreatedToken = (props: {
    token: ServiceTokenType | UserTokenType
    deleteHandler: Function
  }) => {
    const { token, deleteHandler } = props

    const isExpired = token.expiresAt === null ? false : new Date(token.expiresAt) < new Date()

    return (
      <div className="flex items-center w-full justify-between p-2 group bg-neutral-100 dark:bg-neutral-800 rounded-lg ring-1 ring-inset ring-neutral-500/20">
        <div className="grid grid-cols-3 gap-8 w-full">
          <div className="flex items-center gap-4">
            <FaUserShield className="text-neutral-500 text-2xl" />
            <div className="space-y-0">
              <div className="text-lg font-medium">{token.name}</div>
              <div className="flex items-center gap-8 text-sm text-neutral-500">
                <div className={clsx(isExpired && 'text-red-500')}>
                  {isExpired ? 'Expired' : 'Expires'}{' '}
                  {token.expiresAt ? relativeTimeFromDates(new Date(token.expiresAt)) : 'never'}
                </div>
              </div>
            </div>
          </div>
          <div className="text-neutral-500 text-sm flex items-center">
            Created {relativeTimeFromDates(new Date(token.createdAt))}
          </div>
        </div>

        <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
          <DeleteConfirmDialog token={token} onDelete={deleteHandler} />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full overflow-y-auto relative text-black dark:text-white space-y-16">
      <section className="overflow-y-auto max-w-screen-xl">
        <div className="w-full space-y-8 py-8 text-black dark:text-white">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Personal Access Tokens</h2>
            <p className="text-neutral-500">
              Tokens used to authenticate your user account with the CLI, SDKs or API from personal
              devices. Used for development and manual configuration.
            </p>
          </div>
          <div className="space-y-6 pb-6 divide-y-2 divide-neutral-500/40">
            <div className="space-y-4">
              <div className="flex justify-end py-4 border-b border-neutral-500/40">
                <CreateUserTokenDialog organisationId={organisationId!} />
              </div>
              {userTokens.length > 0 ? (
                <div className="space-y-4">
                  {userTokens.map((userToken: UserTokenType) => (
                    <CreatedToken
                      key={userToken.id}
                      token={userToken}
                      deleteHandler={handleDeleteUserToken}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-40 flex flex-col items-center justify-center border border-neutral-500/20 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                  <div className="text-black dark:text-white font-semibold text-2xl">No tokens</div>
                  <div className="text-neutral-500 text-lg">
                    You haven&apos;t created any Personal Accesss Tokens yet. Create one to get
                    started.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
