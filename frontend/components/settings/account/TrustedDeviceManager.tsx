import { Button } from '@/components/common/Button'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { getDevicePassword, deleteDevicePassword } from '@/utils/localStorage'
import { Dialog, Transition } from '@headlessui/react'
import { useContext, useState, useEffect, Fragment } from 'react'
import { FaShieldAlt, FaTimes } from 'react-icons/fa'

export const TrustedDeviceManager = () => {
  const { activeOrganisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const [isTrusted, setIsTrusted] = useState(false)

  useEffect(() => {
    if (keyring !== null) {
      const devicePassword = getDevicePassword(activeOrganisation?.memberId!)
      if (devicePassword) setIsTrusted(true)
    }
  }, [activeOrganisation?.memberId, keyring])

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleRemovePassword = () => {
    deleteDevicePassword(activeOrganisation?.memberId!)
    setIsTrusted(false)
    closeModal()
  }

  return (
    <>
      {isTrusted && (
        <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
          <div className="text-lg font-medium">Device</div>
          <div>
            <div className="flex items-center gap-2 text-emerald-500 text-lg font-medium">
              <FaShieldAlt /> This device is trusted
            </div>
            <div className="text-neutral-500">
              Your <code>sudo</code> password is stored locally on this device.
            </div>
          </div>
          <div>
            <Button variant="danger" onClick={openModal}>
              <FaTimes /> Remove stored password
            </Button>
          </div>
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
                <Dialog.Panel className="w-full max-w-screen-md transform overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Remove stored password
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="py-4">
                    <div className="text-neutral-500">
                      Are you sure you want to remove your password from this device? Doing so will
                      require manually unlocking your user keyring on this device when logging in.{' '}
                    </div>
                    <div className="flex justify-end">
                      <Button variant="danger" onClick={handleRemovePassword}>
                        Remove
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
