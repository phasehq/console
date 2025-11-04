import { Dialog, Transition } from '@headlessui/react'
import { forwardRef, Fragment, useContext, useState, useImperativeHandle, useRef } from 'react'
import { FaPlus, FaTimes } from 'react-icons/fa'
import { FaArrowDownUpLock } from 'react-icons/fa6'
import { toast } from 'react-toastify'
import { Button } from '../common/Button'
import { GetGlobalAccessUsers } from '@/graphql/queries/organisation/getGlobalAccessUsers.gql'
import { useQuery } from '@apollo/client'
import { ApiOrganisationPlanChoices, OrganisationType } from '@/apollo/graphql'
import { KeyringContext } from '@/contexts/keyringContext'
import { MAX_INPUT_STRING_LENGTH } from '@/constants'
import { Alert } from '../common/Alert'
import { createApplication } from '@/utils/app'
import { userHasPermission } from '@/utils/access/permissions'
import { Input } from '../common/Input'

interface NewAppDialogProps {
  appCount: number
  organisation: OrganisationType
  showButton: boolean
}

const NewAppDialog = forwardRef(
  ({ organisation, appCount, showButton }: NewAppDialogProps, ref) => {
    const userCanCreateEnvs = userHasPermission(
      organisation.role?.permissions,
      'Environments',
      'create',
      true
    )
    // This is unused as we are not longer creating example secrets when creating an application
    const userCanCreateSecrets = userHasPermission(
      organisation.role?.permissions,
      'Secrets',
      'create',
      true
    )

    const [isOpen, setIsOpen] = useState<boolean>(false)
    const [name, setName] = useState<string>('')
    const [appCreating, setAppCreating] = useState<boolean>(false)
    const [error, setError] = useState<Error | null>(null)
    const nameInputRef = useRef(null)
    const [createSuccess, setCreateSuccess] = useState(false)

    const { keyring } = useContext(KeyringContext)

    const { data: orgAdminsData } = useQuery(GetGlobalAccessUsers, {
      variables: {
        organisationId: organisation?.id,
      },
      skip: !organisation,
    })

    const reset = () => {
      setName('')
      setError(null)
      setTimeout(() => {
        setCreateSuccess(false)
      }, 2000)
    }

    const closeModal = () => {
      if (!appCreating) {
        reset()
      }
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    useImperativeHandle(ref, () => ({
      openModal,
    }))

    const handleCreateApp = async () => {
      setAppCreating(true)
      try {
        await createApplication({
          name,
          organisation,
          keyring: keyring!,
          globalAccessUsers: orgAdminsData.organisationGlobalAccessUsers,
          createExampleSecrets: false,
        })
        setAppCreating(false)
        setCreateSuccess(true)
        closeModal()
        return true
      } catch (err) {
        console.error(err)
        setError(err as Error)
        setAppCreating(false)
        throw err
      }
    }

    const handleSubmit = async (event: { preventDefault: () => void }) => {
      event.preventDefault()

      toast.promise(handleCreateApp, {
        pending: 'Setting up your app',
        success: 'App created!',
        error: 'Something went wrong!',
      })
    }

    const allowNewApp = () => {
      if (!organisation.planDetail?.maxApps) return true
      return appCount < organisation.planDetail?.maxApps
    }

    const planDisplay = () => {
      if (organisation.plan === ApiOrganisationPlanChoices.Fr)
        return {
          planName: 'Free',
          dialogTitle: 'Upgrade to Pro',
          description: `The Free plan is limited to ${organisation.planDetail?.maxApps} Apps. To create more Apps, please upgrade to Pro.`,
        }
      else if (organisation.plan === ApiOrganisationPlanChoices.Pr)
        return {
          planName: 'Pro',
          dialogTitle: 'Upgrade to Enterprise',
          description: `The Pro plan is limited to ${organisation.planDetail?.maxApps} Apps. To create more Apps, please upgrade to Enterprise.`,
        }
    }

    return (
      <>
        {showButton && (
          <Button variant="primary" onClick={openModal}>
            <FaPlus />
            Create an App
          </Button>
        )}

        <Transition appear show={isOpen} as={Fragment}>
          <Dialog as="div" className="relative z-10" onClose={() => {}} initialFocus={nameInputRef}>
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
                      <div className="flex items-center gap-4">
                        <h3 className="text-lg font-medium leading-6 text-black dark:text-white">
                          {allowNewApp() && 'Create an App'}
                          {!allowNewApp() && !createSuccess && planDisplay()?.dialogTitle}
                        </h3>
                        <div
                          className="rounded-md px-2 text-2xs font-semibold flex items-center gap-1 text-emerald-500 bg-emerald-400/10 cursor-help"
                          title="Secrets (keys, values, comments) will be encrypted with end-to-end encryption"
                        >
                          <FaArrowDownUpLock />
                          End-to-End Encrypted
                        </div>
                      </div>
                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>
                    {allowNewApp() &&
                      (createSuccess ? (
                        <div>
                          <div className="font-semibold text-lg">App Created!</div>
                        </div>
                      ) : (
                        <form onSubmit={handleSubmit}>
                          <div className="mt-2 space-y-6">
                            <p className="text-sm text-gray-500">
                              Create a new App by entering an App name below.
                            </p>
                            {error && (
                              <Alert variant="danger" icon={true}>
                                {error.message}
                              </Alert>
                            )}
                            {userCanCreateEnvs && (
                              <div className="space-y-4">
                                <Alert variant="info" icon={true} size="sm">
                                  Your app will be initialized with Development, Staging, and
                                  Production environments.
                                </Alert>
                              </div>
                            )}
                            <Input
                              value={name}
                              setValue={setName}
                              placeholder="MyApp"
                              label="App name"
                              id="appName"
                              maxLength={MAX_INPUT_STRING_LENGTH}
                              ref={nameInputRef}
                              required
                            />
                          </div>

                          <div className="mt-8 flex items-center w-full justify-between">
                            <Button
                              variant="secondary"
                              type="button"
                              onClick={closeModal}
                              disabled={appCreating}
                            >
                              Cancel
                            </Button>
                            <Button type="submit" variant="primary" isLoading={appCreating}>
                              Create
                            </Button>
                          </div>
                        </form>
                      ))}
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </>
    )
  }
)

NewAppDialog.displayName = 'NewAppDialog'

export default NewAppDialog
