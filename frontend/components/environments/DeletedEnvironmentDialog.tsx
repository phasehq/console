'use client'

import { Fragment, useRef } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { FaTimes, FaUndo } from 'react-icons/fa'
import { DeletedEnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import {
  DeleteNowDialog,
  isBeingDeleted,
  PendingDeletion,
  StatusLine,
} from '@/components/common/PendingDeletionList'
import { DELETION_GRACE_PERIOD } from '@/constants'

const about = (environment: DeletedEnvironmentType) => {
  if (environment.deletionDelayed)
    return 'A credential that could not be revoked is holding up the deletion. This Environment can still be restored.'
  if (isBeingDeleted(environment))
    return 'This Environment is being deleted. It can no longer be restored.'
  return `This Environment is kept for ${DELETION_GRACE_PERIOD}, then permanently deleted. Its secrets are unavailable until it is restored.`
}

/** An environment that is scheduled for deletion, opened from its column: when it goes, and the way back. */
export const DeletedEnvironmentDialog = ({
  environment,
  allowRestore,
  restoring,
  onRestore,
  onDeleteNow,
  onClose,
}: {
  environment: DeletedEnvironmentType | null
  /** Whoever may delete an environment may restore it, or delete it now */
  allowRestore: boolean
  restoring: boolean
  onRestore: (environment: PendingDeletion) => void
  onDeleteNow: (environment: PendingDeletion) => Promise<void>
  onClose: () => void
}) => {
  // Keeps the content in place while the dialog animates out
  const lastRef = useRef<DeletedEnvironmentType | null>(null)
  if (environment) lastRef.current = environment
  const shown = environment ?? lastRef.current

  return (
    <Transition appear show={environment !== null} as={Fragment}>
      <Dialog as="div" className="relative z-10" onClose={onClose}>
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
              <Dialog.Panel className="w-full max-w-lg transform rounded-2xl bg-neutral-100 p-4 text-left align-middle shadow-xl transition-all dark:bg-neutral-900">
                {shown && (
                  <>
                    <Dialog.Title
                      as="div"
                      className="flex w-full items-start justify-between gap-2"
                    >
                      <div className="min-w-0 space-y-1">
                        <h3 className="truncate text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
                          {shown.name}
                        </h3>
                        <StatusLine item={shown} />
                      </div>
                      <Button variant="text" onClick={onClose}>
                        <FaTimes className="text-zinc-900 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-4 pt-3">
                      <p className="text-xs text-neutral-500">{about(shown)}</p>
                      {shown.canRestore && allowRestore && (
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="secondary"
                            icon={FaUndo}
                            isLoading={restoring}
                            onClick={() => onRestore(shown)}
                          >
                            Restore
                          </Button>
                          {/* A delayed deletion is already past its time: there is nothing to bring forward */}
                          {!shown.deletionDelayed && (
                            <DeleteNowDialog
                              item={shown}
                              kind="Environment"
                              disabled={restoring}
                              onConfirm={onDeleteNow}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
