import { ProviderCredentialsType } from '@/apollo/graphql'
import { FaCog, FaCube, FaTimes } from 'react-icons/fa'
import { SiCloudflare } from 'react-icons/si'
import { UpdateProviderCredentials } from './UpdateProviderCredentials'
import { Dialog, Transition } from '@headlessui/react'
import { useState, Fragment, useContext } from 'react'
import { Button } from '../common/Button'
import { relativeTimeFromDates } from '@/utils/time'
import { organisationContext } from '@/contexts/organisationContext'
import { DeleteProviderCredentialDialog } from './DeleteProviderCredentialDialog'

export const ProviderCredentialCard = (props: { credential: ProviderCredentialsType }) => {
  const { credential } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const providerIcon = (providerName: string) => {
    if (providerName.toLowerCase().includes('cloudflare'))
      return <SiCloudflare className="shrink-0" />
    else return <FaCube />
  }

  return (
    <div className="flex flex-wrap gap-4 justify-between p-2 rounded-lg border border-neutral-500/40 bg-zinc-100 dark:bg-zinc-800 text-sm font-medium">
      <div className="flex gap-2 items-center">
        {providerIcon(credential.provider!.name)}
        <div>{credential.provider!.name}</div>
      </div>

      <div className="flex gap-2 items-center">
        Used with {credential.syncCount} sync{credential.syncCount !== 1 && 's'}
      </div>

      <div className="flex gap-2 items-center">
        Created {relativeTimeFromDates(new Date(credential.createdAt))}
      </div>

      <div className="flex items-center justify-center">
        <Button type="button" variant="secondary" onClick={openModal} title="Manage credential">
          <FaCog /> Manage
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
                      Manage authentication credentials
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <UpdateProviderCredentials credential={credential} />

                  <div className="flex justify-end">
                    <DeleteProviderCredentialDialog
                      credential={credential}
                      orgId={organisation!.id}
                    />
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}
