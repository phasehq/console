import { EnvironmentSyncType, ProviderCredentialsType } from '@/apollo/graphql'
import DeleteProviderCreds from '@/graphql/mutations/syncing/deleteProviderCredentials.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment } from 'react'
import { FaTrashAlt, FaTimes } from 'react-icons/fa'
import { Button } from '../common/Button'
import { useMutation } from '@apollo/client'

export const DeleteProviderCredentialDialog = (props: {
  credential: ProviderCredentialsType
  orgId: string
}) => {
  const { credential, orgId } = props

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const [deleteCredential, { loading: deleteLoading }] = useMutation(DeleteProviderCreds)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleDelete = async () => {
    await deleteCredential({
      variables: { credentialId: credential.id },
      refetchQueries: [
        {
          query: GetSavedCredentials,
          variables: { orgId },
        },
      ],
    })
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="danger" onClick={openModal} title="Delete invite">
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

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <p className="text-neutral-500">
                      Are you sure you want to delete this authentication credential?
                    </p>
                    {credential.syncCount! > 0 && (
                      <p className="text-neutral-500">
                        Doing so will disrupt {credential.syncCount} syncs. You will need to assign
                        new credentials to these syncs to make sure they continue to work.
                      </p>
                    )}
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Cancel
                      </Button>
                      <Button variant="danger" onClick={handleDelete}>
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
