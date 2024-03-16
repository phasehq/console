import { Dialog, Switch, Transition } from '@headlessui/react'
import { Button } from '../../common/Button'
import { EnvironmentType, PersonalSecretType } from '@/apollo/graphql'
import { encryptAsymmetric } from '@/utils/crypto'
import { useMutation } from '@apollo/client'
import { Maybe } from '@graphql-tools/utils'
import clsx from 'clsx'
import { useState, useEffect, Fragment } from 'react'
import { FaUserEdit, FaTimes, FaTrash } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { CreateNewPersonalSecret } from '@/graphql/mutations/environments/createPersonalSecret.gql'
import { RemovePersonalSecret } from '@/graphql/mutations/environments/removePersonalSecret.gql'

export const OverrideDialog = (props: {
  secretId: string
  secretName: string
  environment: EnvironmentType
  override: Maybe<PersonalSecretType>
}) => {
  const { secretId, secretName, environment, override } = props

  const [createOverride, { loading: createLoading }] = useMutation(CreateNewPersonalSecret)
  const [removeOverride, { loading: removeLoading }] = useMutation(RemovePersonalSecret)

  const [value, setValue] = useState<string>(override?.value || '')
  const [isActive, setIsActive] = useState<boolean>(override ? override.isActive : true)

  const [saved, setSaved] = useState<boolean>(true)
  const [isOpen, setIsOpen] = useState<boolean>(false)

  const reset = () => {
    setValue(override?.value || '')
    setIsActive(override?.isActive || true)
  }

  const clear = () => {
    setValue('')
    setIsActive(true)
  }

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const valueUpdated = () => {
    if (override === null && value === '') return false
    else {
      return override?.value !== value
    }
  }

  const isActiveUpdated = () => {
    if (override === null && value === '') return false
    else {
      return isActive !== override?.isActive
    }
  }

  const saveRequired = valueUpdated() || isActiveUpdated()

  useEffect(() => {
    if (saveRequired) setSaved(false)
  }, [saveRequired])

  const toggleIsActive = () => setIsActive(!isActive)

  const handleDeleteOverride = async () => {
    await removeOverride({
      variables: {
        secretId,
      },
    })
    clear()
    toast.success('Removed personal secret')
    closeModal()
  }

  const handleUpdateOverride = async () => {
    const encryptedValue = await encryptAsymmetric(value, environment.identityKey)

    await createOverride({
      variables: {
        newPersonalSecret: {
          secretId,
          value: encryptedValue,
          isActive,
        },
      },
    })
    toast.success('Saved personal secret')
    setSaved(true)
    closeModal()
  }

  const handleClose = () => {
    if (saveRequired && !saved) reset()
    closeModal()
  }

  const activeOverride = override && override?.isActive

  return (
    <>
      <div className="flex items-center justify-center">
        <Button
          variant="outline"
          tabIndex={-1}
          onClick={openModal}
          title={
            activeOverride ? 'A Personal Secret is overriding this value' : 'Override this value'
          }
        >
          <FaUserEdit className={clsx(activeOverride && 'text-amber-500')} />{' '}
          <span className={clsx('hidden 2xl:block text-xs', activeOverride && 'text-amber-500')}>
            Override
          </span>
        </Button>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={handleClose}>
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
                        Override{' '}
                        <span className="text-zinc-700 dark:text-zinc-200 font-mono ph-no-capture">
                          {secretName}
                        </span>{' '}
                      </h3>
                      <div className="text-neutral-500 text-sm">
                        Override this value with a Personal Secret. This value will only be visible
                        to you, and will not alter the value of this secret for other users or 3rd
                        party services.
                      </div>
                    </div>

                    <Button variant="text" onClick={handleClose}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-4 py-8">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-black dark:text-white">
                        Override Value
                      </div>
                      <textarea
                        rows={5}
                        value={value}
                        className="w-full ph-no-capture font-mono"
                        onChange={(e) => setValue(e.target.value)}
                      ></textarea>
                    </div>
                    <div className="flex items-center justify-start gap-2">
                      <div className="text-sm text-black dark:text-white font-medium">
                        Activate Secret Override
                      </div>
                      <Switch
                        checked={isActive}
                        onChange={toggleIsActive}
                        className={`${
                          isActive
                            ? 'bg-emerald-400/10 ring-emerald-400/20'
                            : 'bg-neutral-500/40 ring-neutral-500/30'
                        } relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
                      >
                        <span className="sr-only">Set as active</span>
                        <span
                          className={`${
                            isActive ? 'translate-x-6 bg-emerald-400' : 'translate-x-1 bg-black'
                          } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
                        ></span>
                      </Switch>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <div>
                      {override && (
                        <Button
                          variant="danger"
                          onClick={handleDeleteOverride}
                          isLoading={removeLoading}
                        >
                          <FaTrash />
                          Remove
                        </Button>
                      )}
                    </div>
                    <Button
                      variant="primary"
                      onClick={handleUpdateOverride}
                      isLoading={createLoading}
                      disabled={!saveRequired}
                    >
                      Save
                    </Button>
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
