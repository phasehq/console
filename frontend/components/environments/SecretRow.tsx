import {
  ApiEnvironmentEnvTypeChoices,
  ApiSecretEventEventTypeChoices,
  SecretType,
} from '@/apollo/graphql'
import { Fragment, useState } from 'react'
import { FaEyeSlash, FaEye, FaTimes, FaRegCommentDots, FaTrashAlt, FaHistory } from 'react-icons/fa'
import { Button } from '../common/Button'
import { Dialog, Transition } from '@headlessui/react'

import clsx from 'clsx'
import { relativeTimeFromDates } from '@/utils/time'

const HistoryDialog = (props: { secret: SecretType }) => {
  const { secret } = props

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const getEventTypeColor = (eventType: ApiSecretEventEventTypeChoices) => {
    if (eventType === ApiSecretEventEventTypeChoices.C) return 'bg-emerald-500'
    if (eventType === ApiSecretEventEventTypeChoices.U) return 'bg-yellow-500'
    if (eventType === ApiSecretEventEventTypeChoices.R) return 'bg-blue-500'
    if (eventType === ApiSecretEventEventTypeChoices.D) return 'bg-red-500'
  }

  const getEventTypeText = (eventType: ApiSecretEventEventTypeChoices) => {
    if (eventType === ApiSecretEventEventTypeChoices.C) return 'Created'
    if (eventType === ApiSecretEventEventTypeChoices.U) return 'Updated'
    if (eventType === ApiSecretEventEventTypeChoices.R) return 'Read'
    if (eventType === ApiSecretEventEventTypeChoices.D) return 'Deleted'
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="outline" onClick={openModal} title="Update comment">
          <FaHistory /> History
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
                      <span className="text-zinc-300 font-mono">{secret.key}</span> history
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 py-4">
                    <div className="space-y-4 py-4 border-l border-zinc-700">
                      {secret.history?.map((historyItem) => (
                        <div key={historyItem!.timestamp} className="pb-8 ">
                          <div className="flex flex-row items-center gap-2 -ml-1">
                            <span
                              className={clsx(
                                'h-2 w-2 rounded-full',
                                getEventTypeColor(historyItem!.eventType)
                              )}
                            ></span>
                            {/* <span>{historyItem!.version}</span> */}
                            <div>{getEventTypeText(historyItem!.eventType)}</div>
                            <div className="text-neutral-500 text-sm">
                              {relativeTimeFromDates(new Date(historyItem!.timestamp))}
                            </div>
                            {/* <div>{historyItem!.value}</div> */}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Close
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

const CommentDialog = (props: {
  secretId: string
  secretName: string
  comment: string
  handlePropertyChange: Function
}) => {
  const { secretId, secretName, comment, handlePropertyChange } = props

  const [commentValue, setCommentValue] = useState<string>(comment)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleClose = () => {
    handlePropertyChange(secretId, 'comment', commentValue)
    closeModal()
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="outline" onClick={openModal} title="Update comment">
          <FaRegCommentDots className={clsx(comment && 'text-emerald-500')} /> Comment
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
                      Update <span className="text-zinc-300 font-mono">{secretName}</span> comment
                    </h3>

                    <Button variant="text" onClick={handleClose}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <textarea
                      value={commentValue}
                      className="w-full"
                      onChange={(e) => setCommentValue(e.target.value)}
                    ></textarea>
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" type="button" onClick={handleClose}>
                        Close
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

const DeleteConfirmDialog = (props: {
  secretId: string
  secretName: string
  onDelete: Function
}) => {
  const { secretName, secretId, onDelete } = props

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
        <Button variant="outline" onClick={openModal}>
          <div className="text-red-500 flex items-center gap-1">
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
                      Delete <span className="text-zinc-300 font-mono">{secretName}</span>
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6 p-4">
                    <p>Are you sure you want to delete this secret?</p>
                    <div className="flex items-center gap-4">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Cancel
                      </Button>
                      <Button variant="primary" onClick={() => onDelete(secretId)}>
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

export default function SecretRow(props: {
  secret: SecretType
  handlePropertyChange: Function
  handleDelete: Function
}) {
  const { secret, handlePropertyChange, handleDelete } = props

  const [isRevealed, setIsRevealed] = useState<boolean>(false)

  const toggleReveal = () => setIsRevealed(!isRevealed)

  return (
    <div className="flex flex-row w-full gap-2 group">
      <div className="w-1/3">
        <input
          className="w-full text-zinc-300 font-mono"
          value={secret.key}
          onChange={(e) => handlePropertyChange(secret.id, 'key', e.target.value.toUpperCase())}
        />
      </div>
      <div className="w-2/3 relative">
        <input
          className="w-full text-zinc-300 font-mono"
          value={secret.value}
          type={isRevealed ? 'text' : 'password'}
          onChange={(e) => handlePropertyChange(secret.id, 'value', e.target.value)}
        />
        <div className="absolute inset-y-0 right-2 flex gap-1 items-center opacity-0 group-hover:opacity-100 transition ease">
          <Button
            variant="outline"
            onClick={toggleReveal}
            title={isRevealed ? 'Mask value' : 'Reveal value'}
          >
            <span className="py-1">{isRevealed ? <FaEyeSlash /> : <FaEye />}</span>{' '}
            {isRevealed ? 'Mask' : 'Reveal'}
          </Button>
          <CommentDialog
            secretName={secret.key}
            secretId={secret.id}
            comment={secret.comment}
            handlePropertyChange={handlePropertyChange}
          />
          <HistoryDialog secret={secret} />
          <DeleteConfirmDialog
            secretName={secret.key}
            secretId={secret.id}
            onDelete={handleDelete}
          />
        </div>
      </div>
    </div>
  )
}
