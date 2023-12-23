import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment, ReactNode, ReactElement } from 'react'
import { FaTimes } from 'react-icons/fa'
import { Button } from '../common/Button'
import { CreateCloudflarePagesSync } from './Cloudflare/CreateCloudflarePagesSync'
import React from 'react'

type SyncPanelContentProps = {
  children: ReactElement
  closeModal: Function
}

const SyncPanelContent: React.FC<SyncPanelContentProps> = ({ children, closeModal }) => {
  return React.cloneElement(children, { closeModal })
}

export const CreateSyncDialog = (props: {
  appId: string
  button: ReactElement
  children: ReactElement
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  return (
    <>
      <div onClick={openModal}>{props.button}</div>
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
                <Dialog.Panel className="w-full max-w-screen-md transform rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg leading-6 text-neutral-500">Create a Sync</h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="py-4">
                    {/* <CreateCloudflarePagesSync appId={props.appId} onComplete={closeModal} /> */}
                    <SyncPanelContent closeModal={closeModal}>{props.children}</SyncPanelContent>
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
