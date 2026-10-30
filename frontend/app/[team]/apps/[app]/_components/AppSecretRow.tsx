import { ApiSecretTypeChoices, EnvironmentType, SecretTagType } from '@/apollo/graphql'
import clsx from 'clsx'
import { FaExclamationTriangle, FaTrashAlt, FaUndo } from 'react-icons/fa'
import { FaCircle, FaHashtag } from 'react-icons/fa6'
import { AppSecret } from '../types'
import { organisationContext } from '@/contexts/organisationContext'
import { useCallback, useContext, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Button } from '@/components/common/Button'
import { TypeSelector } from '@/components/environments/secrets/TypeSelector'
import { TagsDialog } from '@/components/environments/secrets/TagsDialog'
import { CommentDialog } from '@/components/environments/secrets/CommentDialog'
import { areTagsAreSame } from '@/utils/tags'
import { EnvEntry, EnvValueCell, SecretWithFlags, focusNextGridField } from './EnvValueCell'
import {
  GRID_CELL_BASE,
  GRID_KEY_CELL,
  GRID_KEY_ROW_HOVER,
  GRID_ROW_BG,
  GRID_TRAILING_CELL,
  NEW_ENV_CELL,
  GROUP_ACCENT,
  GridColumn,
} from './gridColumns'
import { envColor } from '@/utils/environment'

// Transparent and square: the key's part of the cell is the field (it lights up on hover/focus)
const KEY_INPUT_STYLE =
  'w-full font-mono custom bg-transparent transition ease ph-no-capture text-2xs 2xl:text-xs'
// On the group/key element itself, so plain hover/focus-within (group-* only reaches descendants)
const KEY_FIELD_FILL =
  'hover:bg-zinc-200 focus-within:bg-zinc-200 dark:hover:bg-zinc-700 dark:focus-within:bg-zinc-700'

type AppSecretWithFlags = Omit<AppSecret, 'envs'> & { envs: EnvEntry[] }

interface AppSecretRowProps {
  index: number
  /** Folder depth below the grid's root, for the tree indent */
  depth: number
  clientAppSecret: AppSecretWithFlags
  serverAppSecret?: AppSecret
  /** Every env column (checked and slim), in header order */
  columns: GridColumn[]
  /** Another row has the same key in one of this row's envs */
  isDuplicate: boolean
  revealOnHover: boolean
  globallyRevealed: boolean
  /** Env whose value cell should flash (deep links) */
  highlightedEnvId: string | null
  /** Base app-level permissions, computed once by the grid */
  canUpdateSecrets: boolean
  canDeleteSecrets: boolean
  updateKey: (id: string, key: string) => void
  updateType: (id: string, type: ApiSecretTypeChoices) => void
  updateTags: (id: string, tags: SecretTagType[]) => void
  updateComment: (id: string, comment: string) => void
  updateValue: (id: string, envId: string, value: string) => void
  addEnvValue: (id: string, env: EnvironmentType) => void
  deleteEnvValue: (id: string, env: EnvironmentType) => void
  deleteKey: (id: string) => void
  /** Checks a slim (hidden) env column */
  showEnv: (envId: string) => void
  /** Logs reveals of saved values */
  logReads: (ids: string[]) => void
}

const AppSecretRowComponent = ({
  index,
  depth,
  clientAppSecret,
  serverAppSecret,
  columns,
  isDuplicate,
  revealOnHover,
  globallyRevealed,
  highlightedEnvId,
  canUpdateSecrets,
  canDeleteSecrets,
  updateKey,
  updateType,
  updateTags,
  updateComment,
  updateValue,
  addEnvValue,
  deleteEnvValue,
  deleteKey,
  showEnv,
  logReads,
}: AppSecretRowProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  // The key menu (type, tags and comment dialogs) mounts on first hover/focus, like the value menus
  const [keyTrayMounted, setKeyTrayMounted] = useState(false)

  const clientByEnv = useMemo(
    () => new Map(clientAppSecret.envs.map((entry) => [entry.env.id!, entry])),
    [clientAppSecret.envs]
  )
  const serverByEnv = useMemo(
    () => new Map((serverAppSecret?.envs ?? []).map((entry) => [entry.env.id!, entry])),
    [serverAppSecret]
  )

  const checkedColumns = columns.filter((column) => column.checked)
  const checkedEntries = checkedColumns
    .map((column) => clientByEnv.get(column.env.id))
    .filter((entry): entry is EnvEntry => Boolean(entry?.secret))

  const secretIsNew = !serverAppSecret
  const isRotating = checkedEntries.some((entry) => Boolean(entry.secret!.rotatingSecretId))

  // Type, tags and comment are edited for every checked env at once, shown from the first one
  const leadSecret = checkedEntries[0]?.secret
  const secretType = leadSecret?.type ?? ApiSecretTypeChoices.Secret
  const secretTags = leadSecret?.tags ?? []
  const secretComment = leadSecret?.comment ?? ''

  // Saved sealed values can't change type; the selector locks once every checked value is sealed
  const checkedServerSecrets = checkedColumns
    .map((column) => serverByEnv.get(column.env.id)?.secret)
    .filter(Boolean)
  const isSealedAndSaved =
    checkedServerSecrets.length > 0 &&
    checkedServerSecrets.every((secret) => secret!.type === ApiSecretTypeChoices.Sealed)

  const stagedForDelete =
    checkedEntries.length > 0 &&
    checkedEntries.every((entry) => (entry.secret as SecretWithFlags).stagedForDelete)

  const modified =
    !secretIsNew &&
    (serverAppSecret!.key !== clientAppSecret.key ||
      checkedColumns.some((column) => {
        const client = clientByEnv.get(column.env.id)?.secret as SecretWithFlags | null
        const server = serverByEnv.get(column.env.id)?.secret
        if (!client || !server) return Boolean(client) !== Boolean(server)
        return (
          client.value !== server.value ||
          client.type !== server.type ||
          (client.comment ?? '') !== (server.comment ?? '') ||
          !areTagsAreSame(client.tags ?? [], server.tags ?? []) ||
          Boolean(client.stagedForDelete)
        )
      }))

  // A rename only touches the checked envs; hidden envs holding the key keep the old name
  const renameSkipsEnvs =
    !secretIsNew && serverAppSecret!.key !== clientAppSecret.key
      ? columns
          .filter((column) => !column.checked && serverByEnv.get(column.env.id)?.secret)
          .map((column) => column.env.name)
      : []

  const userCanUpdateSecrets = canUpdateSecrets || secretIsNew
  // Rotating values belong to the engine; delete them through its manage dialog
  const userCanDeleteSecrets = !isRotating && (canDeleteSecrets || secretIsNew)

  const prodSecret = clientAppSecret.envs.find(
    (entry) => entry.env.envType?.toLowerCase() === 'prod'
  )?.secret
  const isSameAsProd = (entry: EnvEntry) =>
    Boolean(prodSecret) &&
    entry.env.envType?.toLowerCase() !== 'prod' &&
    entry.secret?.value === prodSecret!.value

  const keyInputRef = useRef<HTMLInputElement>(null)

  // Focus new keys right away (imports arrive in bulk, so they don't steal focus)
  useEffect(() => {
    if (secretIsNew && !clientAppSecret.isImported) keyInputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleUpdateKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { selectionStart } = e.target
    updateKey(clientAppSecret.id, e.target.value.replace(/ /g, '_').toUpperCase())
    requestAnimationFrame(() => {
      if (keyInputRef.current) {
        keyInputRef.current.selectionStart = selectionStart
        keyInputRef.current.selectionEnd = selectionStart
      }
    })
  }

  // Adapter for the shared Tags/Comment dialogs, which report handlePropertyChange(id, property, value)
  const handleKeyLevelPropertyChange = useCallback(
    (secretId: string, property: string, value: any) => {
      if (property === 'tags') updateTags(secretId, value)
      else if (property === 'comment') updateComment(secretId, value)
    },
    [updateTags, updateComment]
  )

  const rowTint = stagedForDelete
    ? 'bg-red-400/20 dark:bg-red-400/10'
    : secretIsNew
      ? 'bg-emerald-400/20 dark:bg-emerald-400/10'
      : modified
        ? 'bg-amber-400/20 dark:bg-amber-400/10'
        : ''

  const keyTextColor = stagedForDelete
    ? 'text-red-700 dark:text-red-400 line-through'
    : secretIsNew
      ? 'text-emerald-700 dark:text-emerald-200'
      : modified
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-zinc-900 dark:text-zinc-100'

  return (
    <tr className="group bg-zinc-100 dark:bg-zinc-800">
      <td
        className={clsx(
          GRID_CELL_BASE,
          GRID_KEY_CELL,
          GRID_ROW_BG,
          GRID_KEY_ROW_HOVER,
          'align-top',
          // Rotating rows carry the group header's emerald accent
          isRotating && GROUP_ACCENT
        )}
      >
        <div className={clsx('flex h-full items-start gap-2 pl-2', rowTint)}>
          <div className="flex h-9 w-6 shrink-0 items-center justify-end font-mono text-2xs text-neutral-500">
            {index + 1}
          </div>
          {/* group/key: the row is an unnamed `group`, so the key menu is scoped to this area */}
          <div
            className={clsx(
              'group/key relative min-w-0 flex-1 self-stretch py-0.5 ring-inset transition-colors',
              KEY_FIELD_FILL,
              clientAppSecret.key === ''
                ? 'ring-1 ring-red-500'
                : isDuplicate
                  ? 'ring-1 ring-amber-500'
                  : 'ring-zinc-500 focus-within:ring-1'
            )}
            style={depth ? { marginLeft: `${depth}rem` } : undefined}
            onMouseEnter={() => setKeyTrayMounted(true)}
            onFocus={() => setKeyTrayMounted(true)}
          >
            <input
              ref={keyInputRef}
              disabled={stagedForDelete || !userCanUpdateSecrets}
              className={clsx(
                KEY_INPUT_STYLE,
                keyTextColor,
                // Medium weight + slight tracking keep JetBrains Mono legible at 12px
                'font-medium tracking-wide'
              )}
              value={clientAppSecret.key}
              onChange={handleUpdateKey}
              onKeyDown={(e) => {
                // Skip the hover menu's controls, like the single-env key field
                if (e.key === 'Tab' && !e.shiftKey && focusNextGridField(e.currentTarget))
                  e.preventDefault()
              }}
              title={isDuplicate ? 'Another secret uses this key in the same environment' : undefined}
            />

            <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 text-2xs opacity-100 group-focus-within/key:opacity-0 group-hover/key:opacity-0">
              <div className="flex items-center gap-0.5">
                {secretTags.map((tag) => (
                  <FaCircle key={`tag-indicator-${tag.id}`} className="text-[8px]" color={tag.color} />
                ))}
              </div>
              {secretComment.length > 0 && <FaHashtag className="text-emerald-500" />}
            </div>

            {/* Rises above the row on hover so it never covers the key. The key column
                hugs its content, so the menu may overhang into the first env column */}
            {keyTrayMounted && (
            <div
              className={clsx(
                'absolute bottom-full left-0 flex w-max min-w-full items-center gap-1 rounded-t-lg bg-zinc-200 px-1 pt-1 font-sans dark:bg-zinc-700',
                // Hidden, it sits over the key — it must not take clicks meant for the field
                'pointer-events-none translate-y-full opacity-0 transition ease group-focus-within/key:pointer-events-auto group-focus-within/key:translate-y-0 group-focus-within/key:opacity-100 group-hover/key:pointer-events-auto group-hover/key:translate-y-0 group-hover/key:opacity-100'
              )}
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
                  compact
                />
              )}
              {!stagedForDelete && userCanUpdateSecrets && (
                <CommentDialog
                  secretName={clientAppSecret.key}
                  secretId={clientAppSecret.id}
                  comment={secretComment}
                  handlePropertyChange={handleKeyLevelPropertyChange}
                  compact
                />
              )}
              {userCanDeleteSecrets && (
                <Button
                  title={
                    stagedForDelete
                      ? 'Restore this secret'
                      : checkedColumns.length < columns.length
                        ? 'Delete this secret from the shown environments'
                        : 'Delete this secret'
                  }
                  variant="danger"
                  onClick={() => deleteKey(clientAppSecret.id)}
                >
                  <div className="p-1">{stagedForDelete ? <FaUndo /> : <FaTrashAlt />}</div>
                </Button>
              )}
            </div>
            )}

            {renameSkipsEnvs.length > 0 && (
              <div
                className="mt-0.5 flex items-center gap-1 text-3xs text-amber-600 dark:text-amber-400"
                title={`Renamed in the shown environments only — ${renameSkipsEnvs.join(', ')} keep ${serverAppSecret!.key}`}
              >
                <FaExclamationTriangle className="shrink-0" />
                <span className="truncate">
                  {renameSkipsEnvs.join(', ')} keep{renameSkipsEnvs.length === 1 ? 's' : ''}{' '}
                  {serverAppSecret!.key}
                </span>
              </div>
            )}
          </div>
        </div>
      </td>

      {columns.map((column) => {
        const { env } = column
        const clientEntry = clientByEnv.get(env.id) ?? { env, secret: null }
        const serverEntry = serverByEnv.get(env.id)

        if (!column.checked) {
          const present = Boolean(clientEntry.secret ?? serverEntry?.secret)
          const hiddenKey = clientEntry.secret?.key
          const title = column.pending
            ? `Loading ${env.name}…`
            : present
              ? hiddenKey && hiddenKey !== clientAppSecret.key
                ? `${env.name} has this as ${hiddenKey} — click to show ${env.name}`
                : `Set in ${env.name} — click to show ${env.name}`
              : `Missing in ${env.name} — click to show ${env.name}`
          return (
            <td key={env.id} className={clsx(GRID_CELL_BASE, 'text-center align-middle')}>
              <button
                type="button"
                onClick={() => showEnv(env.id)}
                title={title}
                className="flex h-full min-h-9 w-full items-center justify-center transition-colors hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
              >
                {column.pending ? (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500/40" />
                ) : present ? (
                  <FaCircle className="text-[7px]" style={{ color: envColor(env) }} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full ring-1 ring-inset ring-neutral-500/60" />
                )}
              </button>
            </td>
          )
        }

        return (
          <td key={env.id} className={clsx(GRID_CELL_BASE, 'align-top')}>
            <EnvValueCell
              rowId={clientAppSecret.id}
              entry={clientEntry}
              serverEntry={serverEntry}
              rowKey={clientAppSecret.key}
              keyIsStagedForDelete={stagedForDelete}
              sameAsProd={isSameAsProd(clientEntry)}
              inRotatingGroup={isRotating}
              globallyRevealed={globallyRevealed}
              revealOnHover={revealOnHover}
              highlighted={highlightedEnvId === env.id}
              canUpdateSecrets={canUpdateSecrets}
              canDeleteSecrets={canDeleteSecrets}
              updateValue={updateValue}
              addValue={addEnvValue}
              deleteValue={deleteEnvValue}
              logReads={logReads}
            />
          </td>
        )
      })}

      <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, GRID_ROW_BG)} {...NEW_ENV_CELL} />
    </tr>
  )
}

// What a row renders from each env value: compared field by field because
// every data publish hands rows fresh objects
const rowEntrySecretEqual = (a: SecretWithFlags | null | undefined, b: SecretWithFlags | null | undefined) => {
  if (!a || !b) return !a && !b
  return (
    a.id === b.id &&
    a.key === b.key &&
    a.value === b.value &&
    a.type === b.type &&
    (a.comment ?? '') === (b.comment ?? '') &&
    areTagsAreSame(a.tags ?? [], b.tags ?? []) &&
    (a.stagedForDelete ?? false) === (b.stagedForDelete ?? false) &&
    (a.rotatingSecretId ?? null) === (b.rotatingSecretId ?? null) &&
    (a.override?.value ?? null) === (b.override?.value ?? null) &&
    (a.override?.isActive ?? null) === (b.override?.isActive ?? null)
  )
}

const rowEntriesEqual = (a: AppSecret['envs'] | undefined, b: AppSecret['envs'] | undefined) => {
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].env.id !== b[i].env.id) return false
    if (!rowEntrySecretEqual(a[i].secret, b[i].secret)) return false
  }
  return true
}

const areAppSecretRowsEqual = (prev: AppSecretRowProps, next: AppSecretRowProps) =>
  prev.index === next.index &&
  prev.depth === next.depth &&
  prev.isDuplicate === next.isDuplicate &&
  prev.revealOnHover === next.revealOnHover &&
  prev.globallyRevealed === next.globallyRevealed &&
  prev.highlightedEnvId === next.highlightedEnvId &&
  prev.canUpdateSecrets === next.canUpdateSecrets &&
  prev.canDeleteSecrets === next.canDeleteSecrets &&
  // Content-keyed by the grid, so a reference compare is enough
  prev.columns === next.columns &&
  prev.updateKey === next.updateKey &&
  prev.updateType === next.updateType &&
  prev.updateTags === next.updateTags &&
  prev.updateComment === next.updateComment &&
  prev.updateValue === next.updateValue &&
  prev.addEnvValue === next.addEnvValue &&
  prev.deleteEnvValue === next.deleteEnvValue &&
  prev.deleteKey === next.deleteKey &&
  prev.showEnv === next.showEnv &&
  prev.logReads === next.logReads &&
  prev.clientAppSecret.id === next.clientAppSecret.id &&
  prev.clientAppSecret.key === next.clientAppSecret.key &&
  rowEntriesEqual(prev.clientAppSecret.envs, next.clientAppSecret.envs) &&
  // The server copy drives isSealedAndSaved, new/modified tints and the rename hint
  (prev.serverAppSecret?.key ?? null) === (next.serverAppSecret?.key ?? null) &&
  rowEntriesEqual(prev.serverAppSecret?.envs, next.serverAppSecret?.envs)

export const AppSecretRow = memo(AppSecretRowComponent, areAppSecretRowsEqual)
