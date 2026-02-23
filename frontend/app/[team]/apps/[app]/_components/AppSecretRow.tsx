import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { userHasPermission } from '@/utils/access/permissions'
import { Disclosure, Switch, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaChevronRight,
  FaCheckCircle,
  FaExternalLinkAlt,
  FaRegEye,
  FaRegEyeSlash,
  FaTrashAlt,
  FaUndo,
  FaPlus,
} from 'react-icons/fa'
import { AppSecret } from '../types'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Button } from '@/components/common/Button'
import { useMutation } from '@apollo/client'
import Link from 'next/link'
import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'
import { usePathname } from 'next/navigation'
import { arraysEqual } from '@/utils/crypto'
import { toggleBooleanKeepingCase } from '@/utils/secrets'
import CopyButton from '@/components/common/CopyButton'
import { MaskedTextarea } from '@/components/common/MaskedTextarea'
import {
  PresentIndicator,
  SameAsProdIndicator,
  BlankIndicator,
  MissingIndicator,
} from './SecretInfoLegend'

const INPUT_BASE_STYLE =
  'w-full flex-1 font-mono custom bg-transparent group-hover:bg-zinc-400/20 dark:group-hover:bg-zinc-400/10 transition ease ph-no-capture text-2xs 2xl:text-sm'

// Allow client-side flags on secrets (not part of the GraphQL type)
type SecretWithFlags = SecretType & { stagedForDelete?: boolean }

type AppSecretWithFlags = Omit<AppSecret, 'envs'> & {
  envs: Array<{
    env: Partial<EnvironmentType>
    secret: SecretWithFlags | null
  }>
}

const EnvSecretComponent = ({
  appSecretId,
  keyIsStagedForDelete,
  clientEnvSecret,
  serverEnvSecret,
  sameAsProd,
  updateEnvValue,
  addEnvValue,
  deleteEnvValue,
  revealOnHover,
}: {
  clientEnvSecret: {
    env: Partial<EnvironmentType>
    secret: SecretWithFlags | null
  }
  serverEnvSecret?: {
    env: Partial<EnvironmentType>
    secret: SecretType | null
  }
  appSecretId: string
  keyIsStagedForDelete?: boolean
  sameAsProd: boolean
  updateEnvValue: (id: string, envId: string, value: string | undefined) => void
  addEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  revealOnHover?: boolean
}) => {
  const pathname = usePathname()
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [readSecret] = useMutation(LogSecretReads)

  const valueIsNew = clientEnvSecret.secret?.id.includes('new')
  const isEmptyValue = clientEnvSecret.secret?.value === ''

  const [showValue, setShowValue] = useState<boolean>(
    valueIsNew || !serverEnvSecret || isEmptyValue || false
  )

  const isBoolean = clientEnvSecret?.secret
    ? ['true', 'false'].includes(clientEnvSecret.secret.value.toLowerCase())
    : false
  const booleanValue = clientEnvSecret.secret?.value.toLowerCase() === 'true'

  // Permissions
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

  const handleHideSecret = () => setShowValue(false)

  const toggleShowValue = () => {
    showValue ? handleHideSecret() : handleRevealSecret()
  }

  const handleDeleteValue = () =>
    deleteEnvValue(appSecretId, clientEnvSecret!.env as EnvironmentType)

  const handleAddValue = () => {
    addEnvValue(appSecretId, clientEnvSecret.env as EnvironmentType)
    // Ensure the value is visible after adding it
    setShowValue(true)
  }

  const valueIsModified = () => {
    if (serverEnvSecret) {
      if (serverEnvSecret.secret?.value !== clientEnvSecret.secret?.value) return true
    }

    return false
  }

  const envStagedForDelete = !!clientEnvSecret.secret?.stagedForDelete

  const stagedForDelete = envStagedForDelete || keyIsStagedForDelete

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

  const EnvLabel = () => (
    <div
      className={`flex items-center gap-2 w-min group font-medium text-xs ${inputTextColor()} opacity-60`}
    >
      <div>{clientEnvSecret.env.name}</div>
      {!valueIsNew && (
        <FaExternalLinkAlt className="opacity-0 group-hover:opacity-100 transition ease" />
      )}
      {sameAsProd && clientEnvSecret?.secret?.value && (
        <FaCheckCircle className="text-amber-500" title="This value is the same as Production" />
      )}
    </div>
  )

  return (
    <div
      className={clsx(
        'px-4 py-2 rounded-md group transition-colors',
        bgColor(),
        !stagedForDelete && 'hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50'
      )}
      onMouseEnter={revealOnHover && !showValue ? handleRevealSecret : undefined}
    >
      <div>
        {valueIsNew ? (
          <EnvLabel />
        ) : (
          <Link
            href={`${pathname}/environments/${clientEnvSecret.env.id}${
              clientEnvSecret.secret ? `?secret=${clientEnvSecret.secret?.id}` : ``
            }`}
            title={
              clientEnvSecret.secret
                ? `View this secret in ${clientEnvSecret.env.name}`
                : `Manage ${clientEnvSecret.env.name}`
            }
          >
            <EnvLabel />
          </Link>
        )}
      </div>

      {clientEnvSecret.secret === null ? (
        <div className="flex items-center gap-2">
          <span className="text-red-500 font-mono uppercase">missing</span>
          <Button variant="secondary" disabled={keyIsStagedForDelete} onClick={handleAddValue}>
            <FaPlus />
            Add value
          </Button>
        </div>
      ) : (
        <div className="flex justify-between items-center w-full">
          <div className="relative w-full">
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
              <MaskedTextarea
                className={clsx(
                  INPUT_BASE_STYLE,
                  inputTextColor(),
                  'rounded-sm focus:outline-none py-2 pl-2'
                )}
                value={clientEnvSecret.secret.value}
                onChange={(v) => updateEnvValue(appSecretId, clientEnvSecret.env.id!, v)}
                isRevealed={showValue}
                expanded={true}
              />
            </div>
            {clientEnvSecret.secret !== null && (
              <div className="flex items-center gap-2 absolute inset-y-0 right-0 pl-32 pr-2 opacity-0 group-hover:opacity-100 transition ease bg-gradient-to-r from-transparent via-zinc-100/90 to-zinc-100 dark:via-zinc-800/90 dark:to-zinc-800 group-hover:via-zinc-200/90 group-hover:to-zinc-200 dark:group-hover:via-zinc-700/90 dark:group-hover:to-zinc-700">
                <Button variant="outline" onClick={toggleShowValue}>
                  {showValue ? <FaRegEyeSlash /> : <FaRegEye />}
                  {showValue ? 'Hide' : 'Show'}
                </Button>
                <CopyButton value={clientEnvSecret.secret!.value}></CopyButton>
                {userCanDeleteSecrets && (
                  <Button variant="danger" onClick={handleDeleteValue}>
                    <span className="py-1">{envStagedForDelete ? <FaUndo /> : <FaTrashAlt />}</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const areEnvSecretEqual = (
  prev: React.ComponentProps<typeof EnvSecretComponent>,
  next: React.ComponentProps<typeof EnvSecretComponent>
) => {
  const p = prev.clientEnvSecret.secret
  const n = next.clientEnvSecret.secret
  return (
    prev.appSecretId === next.appSecretId &&
    prev.keyIsStagedForDelete === next.keyIsStagedForDelete &&
    prev.sameAsProd === next.sameAsProd &&
    prev.revealOnHover === next.revealOnHover &&
    prev.clientEnvSecret.env.id === next.clientEnvSecret.env.id &&
    (p?.id ?? null) === (n?.id ?? null) &&
    (p?.value ?? '') === (n?.value ?? '') &&
    (p?.stagedForDelete ?? false) === (n?.stagedForDelete ?? false) &&
    prev.serverEnvSecret?.secret?.value === next.serverEnvSecret?.secret?.value
  )
}

const EnvSecret = memo(EnvSecretComponent, areEnvSecretEqual)

interface AppSecretRowProps {
  index: number
  isExpanded: boolean
  expand: (id: string) => void
  collapse: (id: string) => void
  clientAppSecret: AppSecretWithFlags // changed
  serverAppSecret?: AppSecret
  stagedForDelete?: boolean // key-level delete
  updateKey: (id: string, v: string) => void
  updateValue: (id: string, envId: string, v: string | undefined) => void
  addEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteKey: (id: string) => void
  revealOnHover?: boolean
}

const AppSecretRowComponent = ({
  index,
  isExpanded,
  expand,
  collapse,
  clientAppSecret,
  serverAppSecret,
  stagedForDelete,
  updateKey,
  updateValue,
  addEnvValue,
  deleteEnvValue,
  deleteKey,
  revealOnHover,
}: AppSecretRowProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { id } = clientAppSecret
  const handleOpen = () => expand(id)
  const handleClose = () => collapse(id)

  const newEnvValueAdded = clientAppSecret.envs.some((env) => env?.secret?.id.includes('new'))
  const secretIsNew = !serverAppSecret

  const keyInputRef = useRef<HTMLInputElement>(null)

  const toggleAccordion = () => (isExpanded ? handleClose() : handleOpen())

  const handleUpdateKey = (k: string) => {
    const sanitizedK = k.replace(/ /g, '_').toUpperCase()
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
    // Check each env secret for a stagedForDelete flag (some secrets may attach this flag at runtime)
    return clientAppSecret.envs.some((env) => (env.secret as any)?.stagedForDelete)
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

  // Reveal newly created secrets by default
  useEffect(() => {
    if (secretIsNew && !clientAppSecret.isImported) {
      handleOpen()
      if (keyInputRef.current) {
        keyInputRef.current.focus()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretIsNew])

  const envs = useMemo(
    () => [...clientAppSecret.envs].sort((a, b) => a.env.index! - b.env.index!),
    [clientAppSecret.envs]
  )

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <tr
            className={clsx(
              'group divide-x divide-neutral-500/20 border-l transition ease duration-100',
              isExpanded
                ? `${rowBgColorOpen()} ${rowBorderColor()} !border-r-neutral-500/20`
                : `${rowBgColorClosed()}  border-neutral-500/20`
            )}
          >
            <td
              className={clsx(
                `px-2 py-0.5 whitespace-nowrap font-mono ${rowInputColor()} flex items-center gap-2 ph-no-capture`,
                isExpanded ? 'font-bold' : 'font-medium'
              )}
            >
              <button
                onClick={toggleAccordion}
                className="relative flex items-center justify-center"
              >
                <FaChevronRight
                  className={clsx(
                    'transform transition ease font-light cursor-pointer',
                    isExpanded
                      ? 'opacity-100 rotate-90'
                      : 'opacity-0 group-hover:opacity-100 rotate-0'
                  )}
                />
                <span
                  className={clsx(
                    'text-neutral-500 font-mono absolute transition ease',
                    isExpanded ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
                  )}
                >
                  {index + 1}
                </span>
              </button>
              <div className="relative group flex-1 min-w-60 md:min-w-80">
                <input
                  ref={keyInputRef}
                  disabled={stagedForDelete || !userCanUpdateSecrets}
                  className={clsx(
                    INPUT_BASE_STYLE,
                    rowInputColor(),
                    'rounded-sm ',
                    keyIsBlank
                      ? 'ring-1 ring-inset ring-red-500'
                      : keyIsDuplicate
                        ? 'ring-1 ring-inset ring-amber-500'
                        : 'focus:ring-1 focus:ring-inset focus:ring-zinc-500'
                  )}
                  value={clientAppSecret.key}
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
            {envs.map((env) => (
              <td
                key={env.env.id}
                className="px-6 whitespace-nowrap group cursor-pointer"
                onClick={toggleAccordion}
              >
                <div
                  className="flex items-center justify-center"
                  title={tooltipText(env)}
                >
                  {env.secret !== null ? (
                    env.secret.value.length === 0 ? (
                      <BlankIndicator />
                    ) : secretIsSameAsProd(env) ? (
                      <SameAsProdIndicator />
                    ) : (
                      <PresentIndicator />
                    )
                  ) : (
                    <MissingIndicator />
                  )}
                </div>
              </td>
            ))}
          </tr>
          <Transition
            as="tr"
            show={isExpanded}
            enter="transition duration-150 ease-out"
            enterFrom="transform  opacity-0"
            enterTo="transform  opacity-100"
            leave="transition duration-100 ease-out"
            leaveFrom="transform  opacity-100"
            leaveTo="transform  opacity-0"
            className={clsx(
              'border-x',
              isExpanded
                ? `${rowBorderColor()} !border-r-neutral-500/40 shadow-xl`
                : 'border-neutral-500/40'
            )}
          >
            {isExpanded && (
              <td
                colSpan={clientAppSecret.envs.length + 1}
                className={clsx('p-2 space-y-6 ', rowBgColorOpen())}
              >
                <Disclosure.Panel static={true}>
                  <div className={clsx('grid gap-2 divide-y divide-neutral-500/10')}>
                    {envs.map((envSecret) => (
                      <EnvSecret
                        key={envSecret.env.id}
                        keyIsStagedForDelete={stagedForDelete}
                        clientEnvSecret={envSecret}
                        serverEnvSecret={serverEnvSecret(envSecret.env?.id!)}
                        sameAsProd={secretIsSameAsProd(envSecret)}
                        appSecretId={clientAppSecret.id}
                        updateEnvValue={updateValue}
                        addEnvValue={addEnvValue}
                        deleteEnvValue={deleteEnvValue}
                        revealOnHover={revealOnHover}
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

const areAppSecretRowEqual = (prev: AppSecretRowProps, next: AppSecretRowProps) => {
  if (prev.isExpanded !== next.isExpanded) return false
  if (prev.stagedForDelete !== next.stagedForDelete) return false
  if (prev.revealOnHover !== next.revealOnHover) return false
  if (prev.clientAppSecret.id !== next.clientAppSecret.id) return false
  if (prev.clientAppSecret.key !== next.clientAppSecret.key) return false

  const prevEnv = prev.clientAppSecret.envs
  const nextEnv = next.clientAppSecret.envs
  if (prevEnv.length !== nextEnv.length) return false
  for (let i = 0; i < prevEnv.length; i++) {
    const p = prevEnv[i].secret
    const n = nextEnv[i].secret
    if ((p?.id ?? null) !== (n?.id ?? null)) return false
    if ((p?.value ?? '') !== (n?.value ?? '')) return false
    if ((p?.stagedForDelete ?? false) !== (n?.stagedForDelete ?? false)) return false
  }
  return true
}

export const AppSecretRow = memo(AppSecretRowComponent, areAppSecretRowEqual)
