import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment, useEffect } from 'react'
import { FaPlus, FaTimes } from 'react-icons/fa'
import { Button } from '../common/Button'
import { CreateProviderCredentials } from './CreateProviderCredentials'
import { ProviderType } from '@/apollo/graphql'

export const CreateProviderCredentialsDialog = (props: {
  buttonVariant?: 'primary' | 'secondary'
  defaultOpen?: boolean
  provider: ProviderType | null
  closeDialogCallback: () => void
  showButton: boolean
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(props.defaultOpen || false)

  const closeModal = () => {
    props.closeDialogCallback()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  useEffect(() => {
    if (props.defaultOpen) openModal()
  }, [props.defaultOpen])

  useEffect(() => {
    if (props.provider) openModal()
  }, [props.provider])

  return (
    <>
      {props.showButton && (
        <div className="flex items-center justify-center">
          <Button
            type="button"
            variant={props.buttonVariant || 'primary'}
            onClick={openModal}
            title="Store a new credential"
          >
            <FaPlus /> Add credentials
          </Button>
        </div>
      )}

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
                <Dialog.Panel className="w-full max-w-3xl lg:max-w-5xl transform rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      {/* Create new {provider && <span>{provider.name}</span>} service credentials */}
                      Create new service credentials
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-6">
                    <p className="text-neutral-500">
                      Add a new set of credentials for third party integrations.
                    </p>
                    <CreateProviderCredentials provider={props.provider} onComplete={closeModal} />
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
