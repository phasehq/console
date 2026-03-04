import { Switch } from '@headlessui/react'
import { Button } from '../../common/Button'
import { EnvironmentType, Maybe, PersonalSecretType } from '@/apollo/graphql'
import { encryptAsymmetric } from '@/utils/crypto'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { useState, useEffect, useRef } from 'react'
import { FaUserEdit, FaTrash } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { CreateNewPersonalSecret } from '@/graphql/mutations/environments/createPersonalSecret.gql'
import { RemovePersonalSecret } from '@/graphql/mutations/environments/removePersonalSecret.gql'
import GenericDialog from '@/components/common/GenericDialog'

export const OverrideDialog = (props: {
  secretId: string
  secretName: string
  environment: EnvironmentType
  override: Maybe<PersonalSecretType>
}) => {
  const { secretId, secretName, environment, override } = props

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [createOverride, { loading: createLoading }] = useMutation(CreateNewPersonalSecret)
  const [removeOverride, { loading: removeLoading }] = useMutation(RemovePersonalSecret)

  const [value, setValue] = useState<string>(override?.value || '')
  const [isActive, setIsActive] = useState<boolean>(override ? override.isActive : true)

  const [saved, setSaved] = useState<boolean>(true)

  const reset = () => {
    setValue(override?.value || '')
    setIsActive(override?.isActive || true)
  }

  const clear = () => {
    setValue('')
    setIsActive(true)
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
    setSaved(true)
    dialogRef.current?.closeModal()
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
    dialogRef.current?.closeModal()
  }

  const activeOverride = override && override?.isActive

  return (
    <GenericDialog
      ref={dialogRef}
      title={
        activeOverride ? 'A Personal Secret is overriding this value' : 'Override this value'
      }
      dialogTitle={
        <div>
          <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
            Override{' '}
            <span className="font-mono ph-no-capture">
              {secretName}
            </span>
          </h3>
          <div className="text-neutral-500 text-xs">
            Override this value with a Personal Secret. This value will only be visible
            to you, and will not alter the value of this secret for other users or 3rd
            party services.
          </div>
        </div>
      }
      buttonVariant="outline"
      buttonContent={
        <>
          <span className="py-1">
            <FaUserEdit className={clsx('shrink-0', activeOverride && 'text-amber-500')} />
          </span>
          <span className={clsx('hidden 2xl:block text-xs', activeOverride && 'text-amber-500')}>
            Override
          </span>
        </>
      }
      buttonProps={{ tabIndex: -1 }}
      onClose={() => {
        if (saveRequired && !saved) reset()
      }}
    >
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <div className="text-xs font-medium text-black dark:text-white">
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
          <div className="text-xs text-black dark:text-white font-medium">
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
    </GenericDialog>
  )
}
