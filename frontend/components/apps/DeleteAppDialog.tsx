'use client'

import { AppType, MutationDeleteAppArgs } from '@/apollo/graphql'
import { Transition, Dialog } from '@headlessui/react'
import { Fragment, useState } from 'react'
import { FaTrash, FaTimes, FaExclamationTriangle } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { DeleteApplication } from '@/graphql/mutations/deleteApp.gql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { Alert } from '../common/Alert'

export default function DeleteAppDialog(props: {
  organisationId: string
  appId: string
  appName: string
  teamName: string
}) {
  const { organisationId, appId, appName, teamName } = props
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [typedName, setTypedName] = useState<string>('')
  const [deleteApp, { loading }] = useMutation(DeleteApplication)
  const router = useRouter()

  const reset = () => {
    setTypedName('')
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleDeleteApp = async () => {
    return new Promise<boolean>(async (resolve, reject) => {
      setTimeout(async () => {
        try {
          await deleteApp({
            variables: {
              id: appId,
            } as MutationDeleteAppArgs,
            refetchQueries: [
              {
                query: GetApps,
                variables: {
                  organisationId,
                },
              },
            ],
          })
          resolve(true)
        } catch (error) {
          console.log(error)
          reject()
        }
      }, 500)
    })
  }

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (typedName !== appName) {
      toast.error('The typed app name is incorrect!')
      return false
    }
    toast
      .promise(handleDeleteApp, {
        pending: 'Deleting your app',
        success: 'App deleted!',
        error: 'Something went wrong!',
      })
      .then(() => router.push(`/${teamName}/apps`))
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="danger" onClick={openModal}>
          <FaTrash /> Delete
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
                      Delete App
                    </h3>
                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <form onSubmit={handleSubmit}>
                    <div className="mt-2 space-y-6">
                      <p className="text-sm text-gray-500">Permanently delete this App</p>

                      <Alert variant="danger" icon={true}>
                        <div className="space-y-1">
                          <p className="font-bold">Warning: This is permanent!</p>

                          <p>
                            Deleting this App will permanently delete all environments and secrets
                            associated with it.
                          </p>

                          <p>
                            Once you delete this App, you will not be able to decrypt any data that
                            was encrypted with this App&apos;s KMS keys.
                          </p>
                        </div>
                      </Alert>

                      <div className="flex flex-col justify-center max-w-md mx-auto">
                        <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                          Please enter the App name <span className="text-gray-900 dark:text-white font-mono font-medium">{appName}</span> to confirm:
                        </div>
                        <input
                          id="appname"
                          className="text-lg"
                          required
                          maxLength={64}
                          value={typedName}
                          onChange={(e) => setTypedName(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="mt-8 flex items-center w-full justify-between">
                      <Button
                        variant="secondary"
                        type="button"
                        onClick={closeModal}
                        disabled={loading}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" variant="danger" isLoading={loading}>
                        Delete
                      </Button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
