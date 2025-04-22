'use client'

import { UserTokenType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import DeleteUserToken from '@/graphql/mutations/users/deleteUserToken.gql'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { useMutation } from '@apollo/client'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState } from 'react'
import { FaTimes, FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const DeleteUserTokenDialog = (props: { token: UserTokenType; organisationId: string }) => {
  const { token, organisationId } = props

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [deleteToken, { loading }] = useMutation(DeleteUserToken)

  const closeModal = () => setIsOpen(false)
  const openModal = () => setIsOpen(true)

  const handleDelete = async () => {
    try {
      await deleteToken({
        variables: { tokenId: token.id },
        refetchQueries: [
          {
            query: GetOrganisationMembers,
            variables: { organisationId: organisationId, role: null },
          },
        ],
      })
      toast.success(`Token "${token.name}" deleted successfully!`)
      closeModal()
    } catch (error: any) {
      toast.error(`Failed to delete token: ${error.message}`)
      console.error(error)
    }
  }

  return (
    <>
      <Button
        variant="danger"
        onClick={openModal}
        title="Delete token"
        disabled={loading}
        className="flex items-center gap-1"
      >
        <FaTrashAlt /> Delete
      </Button>

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
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between items-center">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white">
                      Delete Token
                    </h3>
                    <Button variant="text" onClick={closeModal} disabled={loading}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="mt-4 space-y-4">
                    <p className="text-sm text-neutral-500">
                      Are you sure you want to delete the token{' '}
                      <span className="font-medium text-black dark:text-white">{token.name}</span>?
                      This action cannot be undone.
                    </p>
                  </div>

                  <div className="mt-6 flex justify-end gap-2">
                    <Button variant="secondary" onClick={closeModal} disabled={loading}>
                      Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDelete} isLoading={loading}>
                      {loading ? 'Deleting...' : 'Delete Token'}
                    </Button>
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
