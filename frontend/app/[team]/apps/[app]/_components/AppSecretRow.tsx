import { ApiSecretTypeChoices, EnvironmentType, SecretTagType, SecretType } from '@/apollo/graphql'
import { Disclosure, Switch, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaChevronRight,
  FaCheckCircle,
  FaExternalLinkAlt,
  FaEye,
  FaEyeSlash,
  FaTrashAlt,
  FaUndo,
  FaPlus,
  FaLock,
} from 'react-icons/fa'
import { FaCircle, FaHashtag } from 'react-icons/fa6'
import { AppSecret } from '../types'
import { organisationContext } from '@/contexts/organisationContext'
import { useCallback, useContext, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Button } from '@/components/common/Button'
import { useMutation } from '@apollo/client'
import Link from 'next/link'
import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'
import { arraysEqual } from '@/utils/crypto'
import { areTagsAreSame } from '@/utils/tags'
import { toggleBooleanKeepingCase } from '@/utils/secrets'
import CopyButton from '@/components/common/CopyButton'
import { MaskedTextarea } from '@/components/common/MaskedTextarea'
import { TypeSelector } from '@/components/environments/secrets/TypeSelector'
import { TagsDialog } from '@/components/environments/secrets/TagsDialog'
import { CommentDialog } from '@/components/environments/secrets/CommentDialog'
import {
  SecretCellStatus,
  STATUS_CELL_HOVER_STYLES,
  STATUS_CELL_STYLES,
  STATUS_FLASH_STYLES,
} from './SecretInfoLegend'
import { useSecretReferenceAutocomplete } from '@/hooks/useSecretReferenceAutocomplete'
import { ReferenceAutocompleteDropdown } from '@/components/secrets/ReferenceAutocompleteDropdown'
import { SecretReferenceHighlight } from '@/components/secrets/SecretReferenceHighlight'

const INPUT_BASE_STYLE =
  'w-full flex-1 font-mono custom bg-transparent group-hover:bg-zinc-400/20 dark:group-hover:bg-zinc-400/10 transition ease ph-no-capture text-2xs 2xl:text-xs'

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
  currentSecretKey,
  inRotatingGroup,
  envHref,
  highlighted,
  canUpdateSecrets,
  canDeleteSecrets,
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
  currentSecretKey?: string
  /** True when the parent row is rotating-owned in at least one env — used
   *  to label the "Add value" affordance as "Add static value" to make the
   *  divergence from the rotation explicit. */
  inRotatingGroup?: boolean
  /** Link to this env's single-env editor at the current folder path */
  envHref: string
  /** Set when this env was targeted via its status cell in the collapsed
   *  row: scroll into view and flash with the status color */
  highlighted?: boolean
  /** Base app-level permissions, computed once in AppSecrets — permission
   *  hooks are too heavy to run per env value editor */
  canUpdateSecrets: boolean
  canDeleteSecrets: boolean
}) => {
  const [readSecret] = useMutation(LogSecretReads)

  const valueIsNew = clientEnvSecret.secret?.id.includes('new')
  const isEmptyValue = clientEnvSecret.secret?.value === ''

  const isSealed = clientEnvSecret.secret?.type === ApiSecretTypeChoices.Sealed
  const isConfig = clientEnvSecret.secret?.type === ApiSecretTypeChoices.Config
  const isSealedAndSaved = serverEnvSecret?.secret?.type === ApiSecretTypeChoices.Sealed

  const getInitialShowValue = () => {
    if (valueIsNew) return true
    if (isSealedAndSaved) return false
    if (isConfig) return true
    if (!serverEnvSecret || isEmptyValue) return true
    return false
  }

  const [showValue, setShowValue] = useState<boolean>(getInitialShowValue())

  // Secret reference autocomplete
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const handleValueChange = useCallback(
    (v: string) => updateEnvValue(appSecretId, clientEnvSecret.env.id!, v),
    [updateEnvValue, appSecretId, clientEnvSecret.env.id]
  )

  const autocomplete = useSecretReferenceAutocomplete({
    value: clientEnvSecret.secret?.value ?? '',
    isRevealed: showValue,
    textareaRef,
    onChange: handleValueChange,
    currentSecretKey,
  })

  const secretValue = clientEnvSecret.secret?.value ?? ''
  const highlightContent =
    showValue && secretValue.includes('${') ? (
      <SecretReferenceHighlight value={secretValue} />
    ) : undefined

  const isBoolean = clientEnvSecret?.secret
    ? ['true', 'false'].includes(clientEnvSecret.secret.value.toLowerCase())
    : false
  const booleanValue = clientEnvSecret.secret?.value.toLowerCase() === 'true'

  const isRotating = Boolean(clientEnvSecret.secret?.rotatingSecretId)

  // Permissions — rotating rows are read-only regardless of perms.
  const userCanUpdateSecrets = !isRotating && (canUpdateSecrets || !serverEnvSecret)
  const userCanDeleteSecrets = !isRotating && (canDeleteSecrets || !serverEnvSecret)

  const handleRevealSecret = async () => {
    if (isSealedAndSaved) return
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

  // Sync reveal state when the client type is toggled: config → reveal,
  // non-config → mask (booleans stay revealed). Only reacts to an actual
  // change (both prev/next defined) so it doesn't clobber the mount rules
  // from getInitialShowValue() or the explicit reveal in handleAddValue.
  const prevTypeRef = useRef<ApiSecretTypeChoices | undefined | null>(
    clientEnvSecret.secret?.type
  )
  useEffect(() => {
    const nextType = clientEnvSecret.secret?.type
    const prevType = prevTypeRef.current
    prevTypeRef.current = nextType
    if (prevType == null || nextType == null || prevType === nextType) return
    if (isSealedAndSaved) return
    if (nextType === ApiSecretTypeChoices.Config) setShowValue(true)
    else if (!isBoolean) setShowValue(false)
  }, [clientEnvSecret.secret?.type, isSealedAndSaved, isBoolean])

  const handleHideSecret = () => {
    if (isSealedAndSaved) return
    setShowValue(false)
  }

  const toggleShowValue = () => {
    if (isSealedAndSaved) return
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

  // Scroll into view when targeted via a status-cell click. The expanded
  // panel's Transition is opacity-only, so layout is final by the time this
  // runs (including the freshly-mounted case).
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlighted) {
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlighted])

  const status: SecretCellStatus =
    clientEnvSecret.secret === null
      ? 'missing'
      : clientEnvSecret.secret.value.length === 0
        ? 'blank'
        : sameAsProd
          ? 'sameAsProd'
          : 'present'

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
      ref={rootRef}
      className={clsx(
        'px-2 py-1.5 rounded-md group transition-colors duration-300',
        highlighted ? STATUS_FLASH_STYLES[status] : bgColor(),
        !highlighted && !stagedForDelete && 'hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50'
      )}
      onMouseEnter={revealOnHover && !showValue ? handleRevealSecret : undefined}
    >
      <div>
        {valueIsNew ? (
          <EnvLabel />
        ) : (
          <Link
            href={`${envHref}${
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
          <span className="text-red-500 font-mono uppercase text-xs">missing</span>
          <Button variant="secondary" disabled={keyIsStagedForDelete} onClick={handleAddValue}>
            <FaPlus />
            {inRotatingGroup ? 'Add static value' : 'Add value'}
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
                ref={textareaRef}
                className={clsx(
                  INPUT_BASE_STYLE,
                  inputTextColor(),
                  'rounded-sm focus:outline-none group-hover:rounded-tr-none'
                )}
                value={isSealedAndSaved ? '' : clientEnvSecret.secret.value}
                onChange={(v) => {
                  handleValueChange(v)
                  autocomplete.handleChange()
                }}
                onKeyDown={autocomplete.handleKeyDown}
                onSelect={autocomplete.handleSelect}
                onBlur={autocomplete.handleBlur}
                onFocus={autocomplete.handleFocus}
                isRevealed={showValue}
                expanded={true}
                readOnly={isRotating}
                disabled={isSealedAndSaved}
                placeholder={isSealedAndSaved ? 'Sealed secret' : undefined}
                highlightContent={highlightContent}
              />
            </div>
            <ReferenceAutocompleteDropdown
              suggestions={autocomplete.suggestions}
              activeIndex={autocomplete.activeIndex}
              onSelect={autocomplete.acceptSuggestion}
              onNavigate={autocomplete.navigateToSuggestion}
              visible={autocomplete.isOpen}
            />
            {clientEnvSecret.secret !== null && (
              // Same rise-above tray as the single-env valueActionMenu
              <div
                className={clsx(
                  'flex gap-1 items-start pt-1 rounded-t-lg right-0 px-1 transition ease',
                  'bg-zinc-200 dark:bg-zinc-700',
                  'z-10 absolute bottom-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 translate-y-full group-hover:translate-y-0 group-focus-within:translate-y-0'
                )}
              >
                {!isBoolean && !isSealedAndSaved && (
                  <Button
                    variant="outline"
                    tabIndex={-1}
                    onClick={toggleShowValue}
                    title={showValue ? 'Mask value' : 'Reveal value'}
                  >
                    <span className="py-1">{showValue ? <FaEyeSlash /> : <FaEye />}</span>{' '}
                    <span className="hidden 2xl:block text-xs">{showValue ? 'Mask' : 'Reveal'}</span>
                  </Button>
                )}
                {isSealedAndSaved && (
                  <span
                    className="text-xs text-neutral-500 px-2 py-1 flex items-center gap-1"
                    title="This secret is sealed and cannot be revealed"
                  >
                    <FaLock /> Sealed
                  </span>
                )}
                {!isSealedAndSaved && <CopyButton value={clientEnvSecret.secret!.value} />}
                {userCanDeleteSecrets && (
                  <Button
                    variant="danger"
                    tabIndex={-1}
                    onClick={handleDeleteValue}
                    title={envStagedForDelete ? 'Restore this value' : 'Delete this value'}
                  >
                    <div className="p-1">{envStagedForDelete ? <FaUndo /> : <FaTrashAlt />}</div>
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
  const ps = prev.serverEnvSecret?.secret
  const ns = next.serverEnvSecret?.secret
  return (
    prev.appSecretId === next.appSecretId &&
    prev.keyIsStagedForDelete === next.keyIsStagedForDelete &&
    prev.sameAsProd === next.sameAsProd &&
    prev.revealOnHover === next.revealOnHover &&
    prev.currentSecretKey === next.currentSecretKey &&
    prev.inRotatingGroup === next.inRotatingGroup &&
    prev.envHref === next.envHref &&
    (prev.highlighted ?? false) === (next.highlighted ?? false) &&
    prev.canUpdateSecrets === next.canUpdateSecrets &&
    prev.canDeleteSecrets === next.canDeleteSecrets &&
    prev.clientEnvSecret.env.id === next.clientEnvSecret.env.id &&
    (p?.id ?? null) === (n?.id ?? null) &&
    (p?.value ?? '') === (n?.value ?? '') &&
    (p?.type ?? null) === (n?.type ?? null) &&
    (p?.stagedForDelete ?? false) === (n?.stagedForDelete ?? false) &&
    (p?.rotatingSecretId ?? null) === (n?.rotatingSecretId ?? null) &&
    // Server-side fields matter too: isSealedAndSaved and the modified
    // highlight derive from them, and a deploy+refetch only changes the
    // server copy.
    (ps?.id ?? null) === (ns?.id ?? null) &&
    (ps?.value ?? '') === (ns?.value ?? '') &&
    (ps?.type ?? null) === (ns?.type ?? null)
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
  updateType: (id: string, type: ApiSecretTypeChoices) => void
  updateTags: (id: string, tags: SecretTagType[]) => void
  updateComment: (id: string, comment: string) => void
  updateValue: (id: string, envId: string, v: string | undefined) => void
  addEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteEnvValue: (appSecretId: string, environment: EnvironmentType) => void
  deleteKey: (id: string) => void
  revealOnHover?: boolean
  basePath: string
  secretPath: string
  /** Base app-level permissions, computed once in AppSecrets */
  canUpdateSecrets: boolean
  canDeleteSecrets: boolean
  /** Env column order shared with the table headers (includes any optimistic
   *  reorder), so cells can never desync from the header row */
  envOrder: string[]
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
  updateType,
  updateTags,
  updateComment,
  updateValue,
  addEnvValue,
  deleteEnvValue,
  deleteKey,
  revealOnHover,
  basePath,
  secretPath,
  canUpdateSecrets,
  canDeleteSecrets,
  envOrder,
}: AppSecretRowProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { id } = clientAppSecret
  const handleOpen = () => expand(id)
  const handleClose = () => collapse(id)

  const newEnvValueAdded = clientAppSecret.envs.some((env) => env?.secret?.id.includes('new'))
  const secretIsNew = !serverAppSecret

  // Type, tags and comment are key-level in this view: derived from the first
  // non-null env secret and propagated to all envs on change.
  const secretType = clientAppSecret.envs.find((env) => env.secret !== null)?.secret?.type ?? ApiSecretTypeChoices.Config
  const serverSecretType = serverAppSecret?.envs.find((env) => env.secret !== null)?.secret?.type
  const isSealedAndSaved = serverSecretType === ApiSecretTypeChoices.Sealed

  const secretTags =
    clientAppSecret.envs.find((env) => env.secret !== null)?.secret?.tags ?? []
  const secretComment =
    clientAppSecret.envs.find((env) => env.secret !== null)?.secret?.comment ?? ''

  // Adapter for the shared Tags/Comment dialogs, which report changes via
  // handlePropertyChange(id, property, value)
  const handleKeyLevelPropertyChange = useCallback(
    (secretId: string, property: string, value: any) => {
      if (property === 'tags') updateTags(secretId, value)
      else if (property === 'comment') updateComment(secretId, value)
    },
    [updateTags, updateComment]
  )

  const keyInputRef = useRef<HTMLInputElement>(null)

  const toggleAccordion = () => (isExpanded ? handleClose() : handleOpen())

  // Clicking an env status cell expands the row and targets that env's value
  // field, which scrolls into view and flashes with the status color
  const [highlightedEnvId, setHighlightedEnvId] = useState<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const handleEnvCellClick = (envId: string) => {
    handleOpen()
    setHighlightedEnvId(envId)
    clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => setHighlightedEnvId(null), 2000)
  }

  useEffect(() => () => clearTimeout(highlightTimerRef.current), [])

  const handleUpdateKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { selectionStart } = e.target
    const sanitizedK = e.target.value.replace(/ /g, '_').toUpperCase()
    updateKey(clientAppSecret.id, sanitizedK)
    requestAnimationFrame(() => {
      if (keyInputRef.current) {
        keyInputRef.current.selectionStart = selectionStart
        keyInputRef.current.selectionEnd = selectionStart
      }
    })
  }

  const isRotating = clientAppSecret.envs.some((e) => Boolean(e.secret?.rotatingSecretId))

  // Permissions — rotating rows: key + type stay editable (engine syncs the
  // rename into key_map); value/path/delete are engine-owned (route delete
  // through the manage dialog).
  const userCanUpdateSecrets = canUpdateSecrets || secretIsNew
  const userCanDeleteSecrets = !isRotating && (canDeleteSecrets || secretIsNew)

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

  const envCellStatus = (env: {
    env: Partial<EnvironmentType>
    secret: SecretType | null
  }): SecretCellStatus => {
    if (env.secret === null) return 'missing'
    if (env.secret.value.length === 0) return 'blank'
    if (secretIsSameAsProd(env)) return 'sameAsProd'
    return 'present'
  }

  // Fixed-length mask (no length leak); sealed is checked before empty (sealed values arrive as '')
  const envCellContent = (env: { env: Partial<EnvironmentType>; secret: SecretType | null }) => {
    if (env.secret === null)
      return <span className="text-3xs uppercase tracking-wide text-red-500">missing</span>
    if (env.secret.type === ApiSecretTypeChoices.Sealed)
      return <FaLock className="inline text-3xs text-neutral-500" aria-label="Sealed" />
    if (env.secret.value.length === 0)
      return <span className="text-3xs uppercase tracking-wide text-neutral-500">empty</span>
    if (env.secret.type === ApiSecretTypeChoices.Config)
      return (
        <span className="font-mono text-3xs text-zinc-800 dark:text-zinc-200 ph-no-capture">
          {env.secret.value}
        </span>
      )
    return <span className="text-3xs tracking-widest text-neutral-500 select-none">••••••</span>
  }

  const envValuesAreStagedForDelete = () => {
    // Check each env secret for a stagedForDelete flag (some secrets may attach this flag at runtime)
    return clientAppSecret.envs.some((env) => (env.secret as any)?.stagedForDelete)
  }

  // Computed once per render — the row's four style helpers all consume it
  const secretIsModified = (): boolean => {
    if (serverAppSecret) {
      const serverEnvVales = serverAppSecret.envs.map((env) => env.secret?.value)
      const clientEnvVales = clientAppSecret.envs.map((env) => env.secret?.value)
      const serverEnvTypes = serverAppSecret.envs.map((env) => env.secret?.type)
      const clientEnvTypes = clientAppSecret.envs.map((env) => env.secret?.type)
      const serverEnvComments = serverAppSecret.envs.map((env) => env.secret?.comment ?? null)
      const clientEnvComments = clientAppSecret.envs.map((env) => env.secret?.comment ?? null)
      const tagsModified = serverAppSecret.envs.some(
        (env, i) =>
          !areTagsAreSame(env.secret?.tags ?? [], clientAppSecret.envs[i]?.secret?.tags ?? [])
      )
      if (
        serverAppSecret.key !== clientAppSecret.key ||
        !arraysEqual(serverEnvVales, clientEnvVales) ||
        !arraysEqual(serverEnvTypes, clientEnvTypes) ||
        !arraysEqual(serverEnvComments, clientEnvComments) ||
        tagsModified ||
        envValuesAreStagedForDelete() ||
        newEnvValueAdded
      ) {
        return true
      }
    }

    return false
  }

  const modified = secretIsModified()

  const rowBgColorOpen = () => {
    if (stagedForDelete) return 'bg-red-400/20 dark:bg-red-400/10'
    else if (secretIsNew) return 'bg-emerald-400/40'
    else if (modified) return 'bg-amber-400/20 dark:bg-amber-400/10'
    else return 'bg-zinc-100 dark:bg-zinc-800'
  }

  const rowBgColorClosed = () => {
    if (stagedForDelete) return 'bg-red-400/20 dark:bg-red-400/10'
    if (secretIsNew) return 'bg-emerald-400/20 dark:bg-emerald-400/ hover:bg-emerald-400/40'
    else if (modified) return 'bg-amber-400/20 dark:bg-amber-400/10'
    else return 'bg-zinc-100 dark:bg-zinc-800'
  }

  const rowInputColor = () => {
    if (stagedForDelete) return 'text-red-700 dark:text-red-400 line-through'
    else if (secretIsNew) return 'text-emerald-700 dark:text-emerald-200'
    else if (modified) return 'text-amber-700 dark:text-amber-300'
    else return 'text-zinc-900 dark:text-zinc-100'
  }

  const rowBorderColor = () => {
    if (stagedForDelete) return '!border-l-red-700 !dark:border-l-red-400'
    else if (secretIsNew) return '!border-l-emerald-700 !dark:border-l-emerald-200'
    else if (modified) return '!border-l-amber-700 !dark:border-l-amber-300'
    // Rotating members keep the group's emerald accent
    else if (isRotating) return '!border-l-emerald-500/60'
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

  const envs = useMemo(() => {
    const pos = new Map(envOrder.map((id, i) => [id, i]))
    return [...clientAppSecret.envs].sort(
      (a, b) =>
        (pos.get(a.env.id!) ?? Number.MAX_SAFE_INTEGER) -
        (pos.get(b.env.id!) ?? Number.MAX_SAFE_INTEGER)
    )
  }, [clientAppSecret.envs, envOrder])

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <tr
            className={clsx(
              'group divide-x divide-neutral-500/20 border-r transition ease duration-100',
              // Rotating members carry the group header's 2px emerald accent
              isRotating ? 'border-l-2' : 'border-l',
              isExpanded
                ? `${rowBgColorOpen()} ${rowBorderColor()} !border-r-neutral-500/20`
                : `${rowBgColorClosed()} border-neutral-500/20 ${
                    isRotating ? '!border-l-emerald-500/60' : ''
                  }`
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
                className="relative flex items-center justify-center text-xs"
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
                    'font-mono absolute transition ease text-neutral-500',
                    isExpanded ? 'opacity-0' : 'opacity-100 group-hover:opacity-0'
                  )}
                >
                  {index + 1}
                </span>
              </button>
              {/* group/key: the row itself is an unnamed `group`, so the hover
                  menu is scoped to the key area only */}
              <div className="relative group/key flex-1 min-w-60 md:min-w-80">
                <input
                  ref={keyInputRef}
                  disabled={stagedForDelete || !userCanUpdateSecrets}
                  className={clsx(
                    INPUT_BASE_STYLE,
                    rowInputColor(),
                    // Medium weight + slight tracking keep JetBrains Mono legible at 12px
                    'font-medium tracking-wide rounded-sm group-hover/key:rounded-tr-none',
                    keyIsBlank
                      ? 'ring-1 ring-inset ring-red-500'
                      : keyIsDuplicate
                        ? 'ring-1 ring-inset ring-amber-500'
                        : 'focus:ring-1 focus:ring-inset focus:ring-zinc-500'
                  )}
                  value={clientAppSecret.key}
                  onChange={handleUpdateKey}
                  onClick={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                />

                <div className="flex items-center gap-1 absolute right-1 top-1/2 -translate-y-1/2 opacity-100 group-hover/key:opacity-0 group-focus-within/key:opacity-0 text-2xs pointer-events-none">
                  <div className="flex items-center gap-0.5">
                    {secretTags.map((tag) => (
                      <FaCircle
                        key={`tag-indicator-${tag.id}`}
                        className="text-[8px]"
                        color={tag.color}
                      />
                    ))}
                  </div>
                  <div>
                    {secretComment.length > 0 && <FaHashtag className="text-emerald-500" />}
                  </div>
                </div>
                {/* Rises above the row on hover so it never covers the key,
                    mirroring the single-env keyActionMenu */}
                <div
                  className={clsx(
                    // font-sans: the td is font-mono for the key input
                    'flex gap-1 items-center pt-1 px-1 rounded-t-lg font-sans',
                    // Must never outgrow the key container and overlap the expand chevron
                    'max-w-full overflow-hidden',
                    'bg-zinc-200 dark:bg-zinc-700',
                    // Bottom-anchored so the tray height can vary per breakpoint
                    'z-10 absolute right-0 bottom-full translate-y-full group-hover/key:translate-y-0 group-focus-within/key:translate-y-0 opacity-0 group-hover/key:opacity-100 group-focus-within/key:opacity-100',
                    'transition ease'
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!stagedForDelete && userCanUpdateSecrets && (
                    <TypeSelector
                      currentType={secretType}
                      onChange={(type) => updateType(clientAppSecret.id, type)}
                      disabled={isSealedAndSaved}
                      condensed
                    />
                  )}
                  {organisation && (
                    <TagsDialog
                      orgId={organisation.id}
                      secretName={clientAppSecret.key}
                      secretId={clientAppSecret.id}
                      tags={secretTags}
                      handlePropertyChange={handleKeyLevelPropertyChange}
                      disabled={stagedForDelete || !userCanUpdateSecrets}
                    />
                  )}
                  {!stagedForDelete && userCanUpdateSecrets && (
                    <CommentDialog
                      secretName={clientAppSecret.key}
                      secretId={clientAppSecret.id}
                      comment={secretComment}
                      handlePropertyChange={handleKeyLevelPropertyChange}
                    />
                  )}
                  {userCanDeleteSecrets && (
                    <Button
                      title={stagedForDelete ? 'Restore this secret' : 'Delete this secret'}
                      variant="danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteKey(clientAppSecret.id)
                      }}
                    >
                      <div className="p-1">{stagedForDelete ? <FaUndo /> : <FaTrashAlt />}</div>
                    </Button>
                  )}
                </div>
              </div>
            </td>
            {envs.map((env) => {
              const status = envCellStatus(env)
              return (
                <td
                  key={env.env.id}
                  className={clsx(
                    'px-3 whitespace-nowrap cursor-pointer transition-colors ease text-center',
                    STATUS_CELL_STYLES[status],
                    STATUS_CELL_HOVER_STYLES[status]
                  )}
                  onClick={() => handleEnvCellClick(env.env.id!)}
                  title={`${tooltipText(env)} — click to view in ${env.env.name}`}
                >
                  <div className="truncate">{envCellContent(env)}</div>
                </td>
              )
            })}
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
              // Matches the row's left accent width for rotating members
              isRotating ? 'border-l-2 border-r' : 'border-x',
              isExpanded
                ? `${rowBorderColor()} !border-r-neutral-500/40 shadow-xl`
                : 'border-neutral-500/40'
            )}
          >
            {isExpanded && (
              <td
                colSpan={clientAppSecret.envs.length + 1}
                className={clsx('p-1.5', rowBgColorOpen())}
              >
                <Disclosure.Panel static={true}>
                  {/* Skips layout/paint for off-screen expanded panels */}
                  <div
                    className={clsx(
                      'grid gap-1 divide-y divide-neutral-500/10',
                      '[content-visibility:auto] [contain-intrinsic-size:auto_300px]'
                    )}
                  >
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
                        currentSecretKey={clientAppSecret.key}
                        inRotatingGroup={isRotating}
                        envHref={`${basePath}/environments/${envSecret.env.id}${
                          secretPath === '/' ? '' : secretPath
                        }`}
                        highlighted={highlightedEnvId === envSecret.env.id}
                        canUpdateSecrets={canUpdateSecrets}
                        canDeleteSecrets={canDeleteSecrets}
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
  if (prev.index !== next.index) return false
  if (prev.isExpanded !== next.isExpanded) return false
  if (prev.stagedForDelete !== next.stagedForDelete) return false
  if (prev.revealOnHover !== next.revealOnHover) return false
  if (prev.basePath !== next.basePath) return false
  if (prev.secretPath !== next.secretPath) return false
  if (prev.canUpdateSecrets !== next.canUpdateSecrets) return false
  if (prev.canDeleteSecrets !== next.canDeleteSecrets) return false
  // Reference compare: the parent content-keys envOrderIds
  if (prev.envOrder !== next.envOrder) return false
  if (prev.clientAppSecret.id !== next.clientAppSecret.id) return false
  if (prev.clientAppSecret.key !== next.clientAppSecret.key) return false

  const envSecretsDiffer = (
    a: { env: Partial<EnvironmentType>; secret: SecretType | null }[] | undefined,
    b: { env: Partial<EnvironmentType>; secret: SecretType | null }[] | undefined
  ) => {
    if ((a === undefined) !== (b === undefined)) return true
    if (!a || !b) return false
    if (a.length !== b.length) return true
    for (let i = 0; i < a.length; i++) {
      // Env identity matters: selection changes / reordering can leave
      // identical per-index secrets (e.g. both null) under different envs
      if (a[i].env?.id !== b[i].env?.id) return true
      const p = a[i].secret as (SecretType & { stagedForDelete?: boolean }) | null
      const n = b[i].secret as (SecretType & { stagedForDelete?: boolean }) | null
      if ((p?.id ?? null) !== (n?.id ?? null)) return true
      if ((p?.value ?? '') !== (n?.value ?? '')) return true
      if ((p?.type ?? null) !== (n?.type ?? null)) return true
      if ((p?.comment ?? '') !== (n?.comment ?? '')) return true
      if (!areTagsAreSame(p?.tags ?? [], n?.tags ?? [])) return true
      if ((p?.stagedForDelete ?? false) !== (n?.stagedForDelete ?? false)) return true
      if ((p?.rotatingSecretId ?? null) !== (n?.rotatingSecretId ?? null)) return true
    }
    return false
  }

  if (envSecretsDiffer(prev.clientAppSecret.envs, next.clientAppSecret.envs)) return false

  // The server copy drives isSealedAndSaved, secretIsNew and the modified
  // highlight, so compare it field-by-field too (reference comparison would
  // re-render every row on each poll cycle).
  if ((prev.serverAppSecret === undefined) !== (next.serverAppSecret === undefined)) return false
  if (prev.serverAppSecret && next.serverAppSecret) {
    if (prev.serverAppSecret.key !== next.serverAppSecret.key) return false
    if (envSecretsDiffer(prev.serverAppSecret.envs, next.serverAppSecret.envs)) return false
  }

  // Server state drives isSealedAndSaved and the modified highlight — compare it too
  if ((prev.serverAppSecret?.id ?? null) !== (next.serverAppSecret?.id ?? null)) return false
  if ((prev.serverAppSecret?.key ?? null) !== (next.serverAppSecret?.key ?? null)) return false
  const prevServerEnvs = prev.serverAppSecret?.envs ?? []
  const nextServerEnvs = next.serverAppSecret?.envs ?? []
  if (prevServerEnvs.length !== nextServerEnvs.length) return false
  for (let i = 0; i < prevServerEnvs.length; i++) {
    const p = prevServerEnvs[i].secret
    const n = nextServerEnvs[i].secret
    if ((p?.id ?? null) !== (n?.id ?? null)) return false
    if ((p?.value ?? '') !== (n?.value ?? '')) return false
    if ((p?.type ?? null) !== (n?.type ?? null)) return false
  }
  return true
}

export const AppSecretRow = memo(AppSecretRowComponent, areAppSecretRowEqual)
