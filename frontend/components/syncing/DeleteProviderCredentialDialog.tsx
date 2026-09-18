import DeleteProviderCreds from '@/graphql/mutations/syncing/deleteProviderCredentials.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment } from 'react'
import { FaTrashAlt, FaTimes } from 'react-icons/fa'
import { Button } from '../common/Button'
import { useMutation } from '@apollo/client'
import type { IntegrationCredentialSummary } from '@/utils/integrationCredentials'

export const DeleteProviderCredentialDialog = (props: {
  credential: IntegrationCredentialSummary
  orgId: string
  onDeleted?: () => void | Promise<unknown>
}) => {
  const { credential, orgId } = props

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const agentConnectionCount = credential.agentConnectionCount ?? 0

  const [deleteCredential] = useMutation(DeleteProviderCreds)

  const closeModal = () => {
    setDeleteError('')
    setDeleteLoading(false)
    setIsOpen(false)
  }

  const openModal = () => {
    setDeleteError('')
    setIsOpen(true)
  }

  const handleDelete = async () => {
    if (agentConnectionCount > 0) return
    setDeleteLoading(true)
    setDeleteError('')
    try {
      await deleteCredential({
        variables: { credentialId: credential.id },
        refetchQueries: [
          {
            query: GetSavedCredentials,
            variables: { orgId },
          },
        ],
        awaitRefetchQueries: true,
      })
      await props.onDeleted?.()
      closeModal()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete credentials')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="danger" onClick={openModal} title="Delete authentication credentials">
          <div className="text-white dark:text-red-500 flex items-center gap-1 p-1">
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
                      Delete authentication credentials
                    </h3>

                    <Button
                      variant="text"
                      onClick={closeModal}
                      aria-label="Close delete credentials dialog"
                    >
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <p className="text-neutral-500">
                      Are you sure you want to delete this authentication credential?
                    </p>
                    {credential.syncCount! > 0 && (
                      <p className="text-neutral-500">
                        Doing so will disrupt {credential.syncCount} integration
                        {credential.syncCount !== 1 && 's'} (syncs or log streams). You will need to
                        assign new credentials for them to continue working.
                      </p>
                    )}
                    {agentConnectionCount > 0 && (
                      <p
                        role="alert"
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
                      >
                        These credentials are used by {agentConnectionCount} Agent connection
                        {agentConnectionCount === 1 ? '' : 's'}. Assign different credentials to
                        those Connections before deleting them.
                      </p>
                    )}
                    {deleteError && (
                      <p
                        role="alert"
                        className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
                      >
                        {deleteError}
                      </p>
                    )}
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        onClick={handleDelete}
                        isLoading={deleteLoading}
                        disabled={agentConnectionCount > 0}
                      >
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
