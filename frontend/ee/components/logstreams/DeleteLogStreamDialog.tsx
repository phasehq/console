import { Fragment, useContext, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaTimes, FaTrashAlt } from 'react-icons/fa'
import { LogStreamType } from '@/apollo/graphql'
import { DeleteLogStreamOp } from '@/graphql/mutations/logstreams/deleteLogStream.gql'
import { GetLogStreams } from '@/graphql/queries/logstreams/getLogStreams.gql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'

export const DeleteLogStreamDialog = (props: {
  stream: LogStreamType
  onDeleted?: () => void
}) => {
  const { stream, onDeleted } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [isOpen, setIsOpen] = useState(false)
  const [deleteLogStream, { loading }] = useMutation(DeleteLogStreamOp)

  const closeModal = () => setIsOpen(false)

  const handleDelete = async () => {
    try {
      await deleteLogStream({
        variables: { streamId: stream.id },
        refetchQueries: [
          { query: GetLogStreams, variables: { organisationId: organisation?.id } },
        ],
      })
      toast.success('Log Stream deleted')
      closeModal()
      onDeleted?.()
    } catch (error: any) {
      toast.error(error.message || 'Could not delete the Log Stream')
    }
  }

  return (
    <>
      <Button variant="danger" type="button" onClick={() => setIsOpen(true)} title="Delete log stream">
        <FaTrashAlt /> Delete
      </Button>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-20" onClose={closeModal}>
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
                <Dialog.Panel className="w-full max-w-md transform rounded-2xl bg-zinc-100 dark:bg-zinc-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between items-center">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white">
                      Delete Log Stream
                    </h3>
                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="py-4 text-sm text-neutral-500 space-y-2">
                    <p>
                      Are you sure you want to delete the{' '}
                      <span className="font-semibold text-black dark:text-white">
                        {stream.name}
                      </span>{' '}
                      Log Stream?
                    </p>
                    <p>
                      Shipping will stop immediately and its delivery history will no longer be
                      available. Events already stored in Phase are not affected.
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <Button variant="secondary" type="button" onClick={closeModal}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      type="button"
                      onClick={handleDelete}
                      isLoading={loading}
                    >
                      <FaTrashAlt /> Delete
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
