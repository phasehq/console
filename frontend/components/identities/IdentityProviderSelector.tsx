import { useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { Button } from '../common/Button'
import { FaTimes } from 'react-icons/fa'
import { AwsIamIdentityDialog } from './providers/aws/iam'
import { ProviderCards } from './ProviderCards'

interface IdentityProviderSelectorProps {
  isOpen: boolean
  onClose: () => void
  organisationId: string
  onSuccess: () => void
}

export const IdentityProviderSelector = ({
  isOpen,
  onClose,
  organisationId,
  onSuccess,
}: IdentityProviderSelectorProps) => {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [awsIamDialogOpen, setAwsIamDialogOpen] = useState(false)

  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId)
    if (providerId === 'aws_iam') {
      setAwsIamDialogOpen(true)
      onClose()
    }
    // Future providers can be handled here
  }

  const handleAwsIamSuccess = () => {
    setAwsIamDialogOpen(false)
    setSelectedProvider(null)
    onSuccess()
  }

  const handleAwsIamClose = () => {
    setAwsIamDialogOpen(false)
    setSelectedProvider(null)
  }

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
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
                <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <div className="flex items-start justify-between">
                    <div>
                      <Dialog.Title
                        as="h3"
                        className="text-2xl font-semibold text-black dark:text-white"
                      >
                        Add Identity Provider
                      </Dialog.Title>
                      <div className="text-neutral-500 text-sm">
                        Select a provider below to create a new identity.
                      </div>
                    </div>
                    <Button variant="text" onClick={onClose} title="Close">
                      <FaTimes className="text-zinc-900 dark:text-zinc-400" />
                    </Button>
                  </div>

                  <div className="space-y-8 py-8">
                    <ProviderCards onProviderSelect={handleProviderSelect} />
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {/* AWS IAM Identity Dialog */}
      <AwsIamIdentityDialog
        isOpen={awsIamDialogOpen}
        onClose={handleAwsIamClose}
        organisationId={organisationId}
        onSuccess={handleAwsIamSuccess}
      />
    </>
  )
}
