import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { userHasPermission } from '@/utils/access/permissions'
import { Disclosure, Switch, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaChevronRight,
  FaCircle,
  FaCheckCircle,
  FaTimesCircle,
  FaCopy,
  FaExternalLinkAlt,
  FaRegEye,
  FaRegEyeSlash,
  FaTrash,
  FaTrashAlt,
  FaUndo,
  FaChevronDown,
  FaPlus,
  FaExclamationCircle,
} from 'react-icons/fa'
import { AppSecret } from '../types'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useEffect, useState } from 'react'
import { Button } from '@/components/common/Button'
import { copyToClipBoard } from '@/utils/clipboard'
import { useMutation } from '@apollo/client'
import Link from 'next/link'
import { toast } from 'react-toastify'
import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'
import { usePathname } from 'next/navigation'
import { arraysEqual } from '@/utils/crypto'
import { toggleBooleanKeepingCase } from '@/utils/secrets'
import CopyButton from '@/components/common/CopyButton'

const INPUT_BASE_STYLE =
  'w-full font-mono custom bg-transparent group-hover:bg-zinc-400/20 dark:group-hover:bg-zinc-400/10 transition ease ph-no-capture'

const EnvSecret = ({
  appSecretId,
  clientEnvSecret,
  serverEnvSecret,
  sameAsProd,
  stagedForDelete,
  updateEnvValue,
  addEnvValue,
  deleteEnvValue,
}: {
  clientEnvSecret: {
    env: Partial<EnvironmentType>
    secret: SecretType | null
  }
  serverEnvSecret?: {
    env: Partial<EnvironmentType>
    secret: SecretType | null
  }
  appSecretId: string
  sameAsProd: boolean
  stagedForDelete?: boolean
  updateEnvValue: (id: string, envId: string, value: string | undefined) => void
  addEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteEnvValue: (appSecretId: string, environment: EnvironmentType) => void
}) => {
  const pathname = usePathname()
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [readSecret] = useMutation(LogSecretReads)

  const valueIsNew = clientEnvSecret.secret?.id.includes('new')

  const [showValue, setShowValue] = useState<boolean>(false)

  const isBoolean = clientEnvSecret?.secret
    ? ['true', 'false'].includes(clientEnvSecret.secret.value.toLowerCase())
    : false
  const booleanValue = clientEnvSecret.secret?.value.toLowerCase() === 'true'

  // Permisssions
  const userCanUpdateSecrets =
    userHasPermission(organisation?.role?.permissions, 'Secrets', 'update', true) ||
    !serverEnvSecret
  const userCanDeleteSecrets =
    userHasPermission(organisation?.role?.permissions, 'Secrets', 'delete', true) ||
    !serverEnvSecret

  const handleRevealSecret = async () => {
    setShowValue(true)
    if (serverEnvSecret?.secret?.id)
      await readSecret({ variables: { ids: [serverEnvSecret.secret!.id] } })
  }

  const handleToggleBoolean = () => {
    const toggledValue = toggleBooleanKeepingCase(clientEnvSecret.secret!.value)
    updateEnvValue(appSecretId, clientEnvSecret.env.id!, toggledValue)
  }

  // Reveal boolean values on mount for boolean secrets
  useEffect(() => {
    if (isBoolean) setShowValue(true)
  }, [isBoolean])

  // Reveal newly added values
  useEffect(() => {
    if (valueIsNew) setShowValue(true)
  }, [valueIsNew])

  const handleHideSecret = () => setShowValue(false)

  const toggleShowValue = () => {
    showValue ? handleHideSecret() : handleRevealSecret()
  }

  const handleDeleteValue = () =>
    deleteEnvValue(appSecretId, clientEnvSecret!.env as EnvironmentType)

  const handleAddValue = () => addEnvValue(appSecretId, clientEnvSecret.env as EnvironmentType)

  const valueIsModified = () => {
    if (serverEnvSecret) {
      if (serverEnvSecret.secret?.value !== clientEnvSecret.secret?.value) return true
    }

    return false
  }

  const inputTextColor = () => {
    if (valueIsNew) return 'text-emerald-700 dark:text-emerald-200'
    else if (stagedForDelete) return 'text-red-700 dark:text-red-400 line-through'
    else if (valueIsModified()) return 'text-amber-700 dark:text-amber-300'
    else return 'text-zinc-900 dark:text-zinc-100'
  }

  const bgColor = () => {
    if (stagedForDelete) return 'bg-red-400/20 dark:bg-red-400/10'
    else if (valueIsNew) return 'bg-emerald-400/10'
    else if (valueIsModified()) return 'bg-amber-400/20 dark:bg-amber-400/10'
    else return ''
  }

  return (
    <div className={`px-4 rounded-md ${bgColor()}`}>
      <div>
        <Link
          className={`flex items-center gap-2 w-min group font-medium text-xs ${inputTextColor()} opacity-60`}
          href={`${pathname}/environments/${clientEnvSecret.env.id}${
            clientEnvSecret.secret ? `?secret=${clientEnvSecret.secret?.id}` : ``
          }`}
          title={
            clientEnvSecret.secret
              ? `View this secret in ${clientEnvSecret.env.name}`
              : `Manage ${clientEnvSecret.env.name}`
          }
        >
          <div>{clientEnvSecret.env.name}</div>
          <FaExternalLinkAlt className="opacity-0 group-hover:opacity-100 transition ease" />
          {sameAsProd && (
            <FaCheckCircle
              className="text-amber-500"
              title="This value is the same as Production"
            />
          )}
        </Link>
      </div>

      {clientEnvSecret.secret === null ? (
        <div className="flex items-center gap-2">
          <span className="text-red-500 font-mono uppercase">missing</span>
          <Button variant="secondary" onClick={handleAddValue}>
            <FaPlus />
            Add value
          </Button>{' '}
        </div>
      ) : (
        <div className="flex justify-between items-center w-full">
          <div className="relative w-full group">
            <div className="flex items-center gap-2">
              {isBoolean && !stagedForDelete && (
                <div className="flex items-center px-2">
                  <Switch
                    title="Toggle value"
                    checked={booleanValue}
                    onChange={handleToggleBoolean}
                    disabled={stagedForDelete || !userCanUpdateSecrets}
                    className={`${
                      booleanValue
                        ? 'bg-emerald-400/10 ring-emerald-400/20'
                        : 'bg-neutral-500/40 ring-neutral-500/30'
                    } relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
                  >
                    <span className="sr-only">Toggle</span>
                    <span
                      className={`${
                        booleanValue
                          ? 'translate-x-6 bg-emerald-400'
                          : 'translate-x-1 bg-neutral-500'
                      } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
                    ></span>
                  </Switch>
                </div>
              )}
              <input
                className={clsx(
                  INPUT_BASE_STYLE,
                  inputTextColor(),
                  'rounded-sm font-mono text-sm font-medium'
                )}
                type={showValue ? 'text' : 'password'}
                value={clientEnvSecret.secret.value}
                placeholder="VALUE"
                onChange={(e) =>
                  updateEnvValue(appSecretId, clientEnvSecret.env.id!, e.target.value)
                }
              />
            </div>
            {clientEnvSecret.secret !== null && (
              <div className="flex items-center gap-2 absolute inset-y-0 right-2 opacity-0 group-hover:opacity-100 transition ease">
                <Button variant="outline" onClick={toggleShowValue}>
                  {showValue ? <FaRegEyeSlash /> : <FaRegEye />}
                  {showValue ? 'Hide' : 'Show'}
                </Button>
                <CopyButton value={clientEnvSecret.secret!.value}></CopyButton>
                <Button variant="danger" onClick={handleDeleteValue}>
                  {stagedForDelete ? <FaUndo /> : <FaTrashAlt />}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const AppSecretRow = ({
  index,
  clientAppSecret,
  serverAppSecret,
  stagedForDelete,
  secretsStagedForDelete,
  updateKey,
  updateValue,
  addEnvValue,
  deleteEnvValue,
  deleteKey,
}: {
  index: number
  clientAppSecret: AppSecret
  serverAppSecret?: AppSecret
  stagedForDelete?: boolean
  secretsStagedForDelete: string[]
  updateKey: (id: string, v: string) => void
  updateValue: (id: string, envId: string, v: string | undefined) => void
  addEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteKey: (id: string) => void
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const newEnvValueAdded = clientAppSecret.envs.some((env) => env?.secret?.id.includes('new'))
  const secretIsNew = !serverAppSecret

  const [key, setKey] = useState(clientAppSecret.key)
  const [isOpen, setIsOpen] = useState(false)

  const toggleAccordion = () => setIsOpen(!isOpen)

  const handleUpdateKey = (k: string) => {
    const sanitizedK = k.replace(/ /g, '_').toUpperCase()
    setKey(sanitizedK)
    updateKey(clientAppSecret.id, sanitizedK)
  }

  // Permisssions
  const userCanUpdateSecrets =
    userHasPermission(organisation?.role?.permissions, 'Secrets', 'update', true) || secretIsNew
  const userCanDeleteSecrets =
    userHasPermission(organisation?.role?.permissions, 'Secrets', 'delete', true) || secretIsNew

  const prodSecret = clientAppSecret.envs.find(
    (env) => env.env.envType?.toLowerCase() === 'prod'
  )?.secret

  const secretIsSameAsProd = (env: { env: Partial<EnvironmentType>; secret: SecretType | null }) =>
    prodSecret !== null &&
    env.secret?.value === prodSecret?.value &&
    env.env.envType?.toLowerCase() !== 'prod'

  const keyIsBlank = clientAppSecret.key === ''
  const keyIsDuplicate = false // TODO implement

  const tooltipText = (env: { env: Partial<EnvironmentType>; secret: SecretType | null }) => {
    if (env.secret === null) return `This secret is missing in ${env.env.name}`
    else if (env.secret.value.length === 0) return `This secret is blank in ${env.env.name}`
    else if (secretIsSameAsProd(env)) return `This secret is the same as Production.`
    else return 'This secret is present'
  }

  const envValuesAreStagedForDelete = () => {
    const envSecretIds = clientAppSecret.envs.map((env) => env.secret?.id)
    return envSecretIds.some((id) => (id ? secretsStagedForDelete.includes(id) : false))
  }

  const secretIsModified = () => {
    if (serverAppSecret) {
      const serverEnvVales = serverAppSecret.envs.map((env) => env.secret?.value)
      const clientEnvVales = clientAppSecret.envs.map((env) => env.secret?.value)
      if (
        serverAppSecret.key !== clientAppSecret.key ||
        !arraysEqual(serverEnvVales, clientEnvVales) ||
        envValuesAreStagedForDelete() ||
        newEnvValueAdded
      ) {
        return true
      }
    }

    return false
  }

  const rowBgColorOpen = () => {
    if (stagedForDelete) return 'bg-red-400/20 dark:bg-red-400/10'
    else if (secretIsNew) return 'bg-emerald-400/40'
    else if (secretIsModified()) return 'bg-amber-400/20 dark:bg-amber-400/10'
    else return 'bg-zinc-100 dark:bg-zinc-800'
  }

  const rowBgColorClosed = () => {
    if (stagedForDelete) return 'bg-red-400/20 dark:bg-red-400/10'
    if (secretIsNew) return 'bg-emerald-400/20 dark:bg-emerald-400/ hover:bg-emerald-400/40'
    else if (secretIsModified()) return 'bg-amber-400/20 dark:bg-amber-400/10'
    else return 'bg-zinc-100 dark:bg-zinc-800'
  }

  const rowInputColor = () => {
    if (stagedForDelete) return 'text-red-700 dark:text-red-400 line-through'
    else if (secretIsNew) return 'text-emerald-700 dark:text-emerald-200'
    else if (secretIsModified()) return 'text-amber-700 dark:text-amber-300'
    else return 'text-zinc-900 dark:text-zinc-100'
  }

  const rowBorderColor = () => {
    if (stagedForDelete) return '!border-l-red-700 !dark:border-l-red-400'
    else if (secretIsNew) return '!border-l-emerald-700 !dark:border-l-emerald-200'
    else if (secretIsModified()) return '!border-l-amber-700 !dark:border-l-amber-300'
    else return '!border-l-neutral-500/40 !dark:border-l-neutral-500/40'
  }

  const serverEnvSecret = (id: string) => serverAppSecret?.envs.find((env) => env.env.id === id)

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <tr
            className={clsx(
              'group divide-x divide-neutral-500/20 border-l transition ease duration-100',
              isOpen
                ? `${rowBgColorOpen()} ${rowBorderColor()} !border-r-neutral-500/20`
                : `${rowBgColorClosed()}  border-neutral-500/20`
            )}
          >
            <td
              className={clsx(
                `px-2 py-0.5 whitespace-nowrap font-mono ${rowInputColor()} flex items-center gap-2 ph-no-capture`,
                isOpen ? 'font-bold' : 'font-medium'
              )}
            >
              <button
                onClick={toggleAccordion}
                className="relative flex items-center justify-center"
              >
                <FaChevronRight
                  className={clsx(
                    'transform transition ease font-light cursor-pointer',
                    isOpen ? 'opacity-100 rotate-90' : 'opacity-0 group-hover:opacity-100 rotate-0'
                  )}
                />
                <span
                  className={clsx(
                    'text-neutral-500 font-mono absolute transition ease',
                    isOpen ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
                  )}
                >
                  {index + 1}
                </span>
              </button>
              <div className="relative w-full group">
                <input
                  disabled={stagedForDelete || !userCanUpdateSecrets}
                  className={clsx(
                    INPUT_BASE_STYLE,
                    rowInputColor(),
                    'rounded-sm',
                    keyIsBlank
                      ? 'ring-1 ring-inset ring-red-500'
                      : keyIsDuplicate
                        ? 'ring-1 ring-inset ring-amber-500'
                        : 'focus:ring-1 focus:ring-inset focus:ring-zinc-500'
                  )}
                  value={key}
                  onChange={(e) => handleUpdateKey(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                />
                <div className="absolute inset-y-0 right-2 flex gap-1 items-center opacity-0 group-hover:opacity-100 transition ease">
                  {userCanDeleteSecrets && (
                    <Button
                      title={stagedForDelete ? 'Restore this secret' : 'Delete this secret'}
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteKey(clientAppSecret.id)
                      }}
                    >
                      {stagedForDelete ? <FaUndo /> : <FaTrashAlt />}
                    </Button>
                  )}
                </div>
              </div>
            </td>
            {clientAppSecret.envs.map((env) => (
              <td
                key={env.env.id}
                className={'px-6 whitespace-nowrap group cursor-pointer'}
                onClick={toggleAccordion}
              >
                <div className="flex items-center justify-center" title={tooltipText(env)}>
                  {env.secret !== null ? (
                    env.secret.value.length === 0 ? (
                      <FaCircle className="text-neutral-500 shrink-0" />
                    ) : (
                      <FaCheckCircle
                        className={clsx(
                          'shrink-0',
                          secretIsSameAsProd(env) ? 'text-amber-500' : 'text-emerald-500'
                        )}
                      />
                    )
                  ) : (
                    <FaTimesCircle className="text-red-500 shrink-0" />
                  )}
                </div>
              </td>
            ))}
          </tr>
          <Transition
            as="tr"
            show={isOpen}
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
            className={clsx(
              'border-x',
              isOpen
                ? `${rowBorderColor()} !border-r-neutral-500/40 shadow-xl`
                : 'border-neutral-500/40'
            )}
          >
            {isOpen && (
              <td
                colSpan={clientAppSecret.envs.length + 1}
                className={clsx('p-2 space-y-6 ', rowBgColorOpen())}
              >
                <Disclosure.Panel static={true}>
                  <div className={clsx('grid gap-2 divide-y divide-neutral-500/10')}>
                    {clientAppSecret.envs.map((envSecret) => (
                      <EnvSecret
                        key={envSecret.env.id}
                        clientEnvSecret={envSecret}
                        serverEnvSecret={serverEnvSecret(envSecret.env?.id!)}
                        sameAsProd={secretIsSameAsProd(envSecret)}
                        appSecretId={clientAppSecret.id}
                        updateEnvValue={updateValue}
                        stagedForDelete={
                          envSecret.secret
                            ? secretsStagedForDelete.includes(envSecret.secret?.id)
                            : false
                        }
                        addEnvValue={addEnvValue}
                        deleteEnvValue={deleteEnvValue}
                      />
                    ))}
                  </div>
                </Disclosure.Panel>
              </td>
            )}
          </Transition>
        </>
      )}
    </Disclosure>
  )
}
