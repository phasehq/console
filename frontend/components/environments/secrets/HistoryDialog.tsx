import { SecretType, ApiSecretEventEventTypeChoices } from '@/apollo/graphql'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'

import { useState, Fragment } from 'react'
import { FaHistory, FaTimes, FaKey } from 'react-icons/fa'
import { SecretPropertyDiffs } from './SecretPropertyDiffs'
import { Button } from '../../common/Button'
import { Dialog, Transition } from '@headlessui/react'
import { Avatar } from '../../common/Avatar'

export const HistoryDialog = (props: { secret: SecretType; handlePropertyChange: Function }) => {
  const { secret, handlePropertyChange } = props

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

  const secretHistory = secret.history

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="outline" onClick={openModal} title="View secret history" tabIndex={-1}>
          <FaHistory /> <span className="hidden 2xl:block text-xs">History</span>
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
                  <Dialog.Title as="div" className="flex w-full justify-between items-start">
                    <div>
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                          {secret.key}
                        </span>{' '}
                        history
                      </h3>
                      <div className="text-neutral-500 text-sm">
                        View the chronological history of changes made to this secret.
                      </div>
                    </div>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-8 py-4">
                    <div className="max-h-[800px] overflow-y-auto px-2">
                      <div className="space-y-4 pb-4 border-l border-zinc-300 dark:border-zinc-700">
                        {secretHistory?.map((historyItem, index) => (
                          <div key={historyItem!.timestamp} className="pb-8 space-y-2">
                            <div className="flex flex-row items-center gap-2 -ml-1">
                              <span
                                className={clsx(
                                  'h-2 w-2 rounded-full',
                                  getEventTypeColor(historyItem!.eventType)
                                )}
                              ></span>
                              <div className="text-zinc-800 dark:text-zinc-200 font-semibold">
                                {getEventTypeText(historyItem!.eventType)}
                              </div>
                              <div className="text-neutral-500 text-sm">
                                {relativeTimeFromDates(new Date(historyItem!.timestamp))}
                              </div>{' '}
                              <div className="text-sm flex items-center gap-2 text-neutral-500">
                                {historyItem!.user && (
                                  <div className="flex items-center gap-1 text-sm">
                                    by <Avatar imagePath={historyItem!.user.avatarUrl!} size="sm" />
                                    {historyItem?.user.fullName || historyItem?.user.email}
                                  </div>
                                )}
                              </div>
                            </div>
                            {index > 0 && (
                              <SecretPropertyDiffs
                                secret={secret}
                                historyItem={historyItem!}
                                index={index}
                                handlePropertyChange={handlePropertyChange}
                              />
                            )}
                          </div>
                        ))}
                      </div>
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
