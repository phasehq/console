import {
  ApiSecretTypeChoices,
  EnvironmentSyncType,
  EnvironmentType,
  SecretTagType,
  SecretType,
} from '@/apollo/graphql'
import {
  forwardRef,
  Fragment,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Tab } from '@headlessui/react'
import {
  FaChevronRight,
  FaCloudUploadAlt,
  FaKey,
  FaLayerGroup,
  FaRedo,
  FaTimes,
  FaUndo,
} from 'react-icons/fa'
import { FaAnglesDown, FaAnglesUp, FaArrowRight, FaCircle, FaRotate } from 'react-icons/fa6'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import clsx from 'clsx'
import { arraysEqual } from '@/utils/crypto'
import { envColor } from '@/utils/environment'
import { Tag } from '../Tag'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { SECRET_TYPES } from './TypeSelector'

export type ChangeKind = 'Created' | 'Updated' | 'Deleted'

/** `old` is null when it isn't known (a saved sealed value never reaches the client) */
type ChangeDetail<T = string> = { old: T | null; new: T }

export type SecretChange = {
  id: string
  kind: ChangeKind
  secretName: string
  /** Set when `showPath` is on and the secret isn't at the root */
  folderPath?: string
  /** Set when `showEnvironment` is on */
  environment?: Partial<EnvironmentType>
  key?: ChangeDetail
  /** Set when the secret moves to another folder */
  folder?: ChangeDetail
  secretType?: ChangeDetail
  value?: ChangeDetail
  comment?: ChangeDetail
  tags?: ChangeDetail<SecretTagType[]>
}

export type ChangeGroup = { environment?: Partial<EnvironmentType>; changes: SecretChange[] }

export type SecretChanges = {
  changes: SecretChange[]
  /** One per environment, in env order (a single group when not grouping by env) */
  groups: ChangeGroup[]
  kindCounts: { kind: ChangeKind; count: number }[]
}

const secretTypeLabel = (type: string) => SECRET_TYPES.find((t) => t.value === type)?.label ?? type

const KIND_ORDER: Record<ChangeKind, number> = { Created: 0, Updated: 1, Deleted: 2 }

// A kind is always a label with its word: colored dots are the envs'
export const KIND_BADGE: Record<ChangeKind, string> = {
  Created: 'bg-emerald-400/15 text-emerald-700 dark:text-emerald-400',
  Updated: 'bg-amber-400/15 text-amber-700 dark:text-amber-400',
  Deleted: 'bg-red-400/15 text-red-700 dark:text-red-400',
}

const OLD_VALUE = 'rounded bg-red-400/15 px-1 text-red-700 line-through dark:text-red-400'
const NEW_VALUE = 'rounded bg-emerald-400/15 px-1 text-emerald-800 dark:text-emerald-300'
const PLAIN_VALUE = 'rounded bg-zinc-400/10 px-1 text-zinc-900 dark:text-zinc-100'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// Touch screens can't hover, so there they always show
export const REVEAL_IN_CHANGE =
  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/change:opacity-100 focus-visible:opacity-100'
const REVEAL_IN_ENV =
  '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/env:opacity-100 focus-visible:opacity-100'

export const byKindThenName = (a: SecretChange, b: SecretChange) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
  (a.folderPath ?? '').localeCompare(b.folderPath ?? '') ||
  a.secretName.localeCompare(b.secretName)

type KeyGroup = {
  id: string
  changes: SecretChange[]
  /** The changes that differ only in their env, together */
  variants: SecretChange[][]
}

const diffOf = (change: SecretChange) =>
  JSON.stringify([
    change.kind,
    change.key,
    change.folder,
    change.secretType,
    change.value,
    change.comment,
    change.tags && [change.tags.old?.map((tag) => tag.id), change.tags.new.map((tag) => tag.id)],
  ])

const firstKind = (changes: SecretChange[]) =>
  Math.min(...changes.map((change) => KIND_ORDER[change.kind]))

// The keys changed in the most envs first: they're what the list by env repeats
const byReach = (a: SecretChange[], b: SecretChange[]) =>
  b.length - a.length || firstKind(a) - firstKind(b) || byKindThenName(a[0], b[0])

/** One group per key (and folder), so a change made in several envs reads once */
const groupChangesByKey = (changes: SecretChange[]): KeyGroup[] => {
  const groups = new Map<string, SecretChange[]>()
  const inEnvOrder = [...changes].sort(
    (a, b) => (a.environment?.index ?? 0) - (b.environment?.index ?? 0)
  )
  for (const change of inEnvOrder) {
    const id = `${change.folderPath ?? ''}/${change.secretName}`
    const group = groups.get(id)
    if (group) group.push(change)
    else groups.set(id, [change])
  }
  return [...groups]
    .map(([id, group]) => {
      const variants = new Map<string, SecretChange[]>()
      for (const change of group) {
        const diff = diffOf(change)
        const variant = variants.get(diff)
        if (variant) variant.push(change)
        else variants.set(diff, [change])
      }
      return { id, changes: group, variants: [...variants.values()] }
    })
    .sort((a, b) => byReach(a.changes, b.changes))
}

const BY_KEY_MIN_ENVS = 3
const BY_KEY_MIN_REPEATS = 5

/** Grouping by key only earns its tab once the same keys repeat across several envs */
const worthGroupingByKey = (changes: SecretChange[], keyGroups: KeyGroup[]) =>
  changes.length - keyGroups.length >= BY_KEY_MIN_REPEATS &&
  keyGroups.some((group) => group.changes.length >= BY_KEY_MIN_ENVS)

export type ChangeSource = {
  clientSecrets: SecretType[]
  serverSecrets: SecretType[]
  secretsToDelete: string[]
  /** Group changes by environment (for the grid editor, where one key maps to a
   *  secret per env). */
  showEnvironment?: boolean
  /** Prefix keys outside the root with their folder (the grid spans folders) */
  showPath?: boolean
}

/** What deploying would change, secret by secret. Memoized: it runs on every keystroke */
export const useSecretChanges = ({
  clientSecrets,
  serverSecrets,
  secretsToDelete,
  showEnvironment,
  showPath,
}: ChangeSource): SecretChanges => {
  const serverSecretsById = useMemo(
    () => new Map(serverSecrets.map((secret) => [secret.id, secret])),
    [serverSecrets]
  )

  const changes = useMemo((): SecretChange[] => {
    const folderOf = (secret: SecretType) =>
      showPath && secret.path && secret.path !== '/' ? secret.path : undefined
    const environmentOf = (secret: SecretType) =>
      showEnvironment ? (secret.environment ?? undefined) : undefined

    // Keyed by secret id: in the grid several secrets (one per env) share a key
    const result: SecretChange[] = []

    for (const updated of clientSecrets) {
      const original = serverSecretsById.get(updated.id)

      if (!original) {
        result.push({
          id: updated.id,
          kind: 'Created',
          secretName: updated.key,
          folderPath: folderOf(updated),
          environment: environmentOf(updated),
          value: { old: '', new: updated.value },
          comment: { old: '', new: updated.comment ?? '' },
          tags: { old: [], new: updated.tags ?? [] },
        })
        continue
      }

      const change: SecretChange = {
        id: updated.id,
        kind: 'Updated',
        secretName: original.key,
        folderPath: folderOf(original),
        environment: environmentOf(updated),
      }
      if (original.key !== updated.key) change.key = { old: original.key, new: updated.key }
      if ((original.path || '/') !== (updated.path || '/'))
        change.folder = { old: original.path || '/', new: updated.path || '/' }
      if (original.type !== updated.type)
        change.secretType = { old: original.type, new: updated.type }
      if (original.value !== updated.value)
        change.value = {
          old: original.type === ApiSecretTypeChoices.Sealed ? null : original.value,
          new: updated.value,
        }
      if ((original.comment ?? '') !== (updated.comment ?? ''))
        change.comment = { old: original.comment ?? '', new: updated.comment ?? '' }
      if (!arraysEqual(original.tags, updated.tags))
        change.tags = { old: original.tags ?? [], new: updated.tags ?? [] }

      if (
        change.key ||
        change.folder ||
        change.secretType ||
        change.value ||
        change.comment ||
        change.tags
      )
        result.push(change)
    }

    for (const id of secretsToDelete) {
      const deleted = serverSecretsById.get(id)
      result.push({
        id,
        kind: 'Deleted',
        secretName: deleted?.key ?? '',
        folderPath: deleted ? folderOf(deleted) : undefined,
        environment: deleted ? environmentOf(deleted) : undefined,
      })
    }

    return result
  }, [clientSecrets, serverSecretsById, secretsToDelete, showEnvironment, showPath])

  const groups = useMemo((): ChangeGroup[] => {
    const sorted = [...changes].sort(byKindThenName)
    if (!showEnvironment) return [{ changes: sorted }]

    const byEnv = new Map<string, ChangeGroup>()
    for (const change of sorted) {
      const envId = change.environment?.id ?? ''
      const group = byEnv.get(envId)
      if (group) group.changes.push(change)
      else byEnv.set(envId, { environment: change.environment, changes: [change] })
    }
    return [...byEnv.values()].sort(
      (a, b) => (a.environment?.index ?? 0) - (b.environment?.index ?? 0)
    )
  }, [changes, showEnvironment])

  return useMemo(() => {
    const kindCounts = (['Created', 'Updated', 'Deleted'] as ChangeKind[])
      .map((kind) => ({ kind, count: changes.filter((change) => change.kind === kind).length }))
      .filter(({ count }) => count > 0)
    return { changes, groups, kindCounts }
  }, [changes, groups])
}

const TextValue = ({ text, className }: { text: string; className: string }) =>
  text === '' ? (
    <span className={clsx(className, 'font-sans italic opacity-70')}>empty</span>
  ) : (
    <span className={clsx(className, 'whitespace-pre-wrap break-all')}>{text}</span>
  )

/** One field of a change: the old value struck through, then the new one */
const FieldRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <>
    <dt className="pt-px text-3xs font-medium uppercase tracking-wide text-neutral-500">{label}</dt>
    <dd className="flex min-w-0 flex-wrap items-start gap-1 font-mono">{children}</dd>
  </>
)

const TextDiff = ({ diff, created }: { diff: ChangeDetail; created: boolean }) =>
  created ? (
    <TextValue text={diff.new} className={PLAIN_VALUE} />
  ) : diff.old === null ? (
    <TextValue text={diff.new} className={NEW_VALUE} />
  ) : (
    <>
      <TextValue text={diff.old} className={OLD_VALUE} />
      <FaArrowRight className="mt-1 shrink-0 text-[9px] text-neutral-500" />
      <TextValue text={diff.new} className={NEW_VALUE} />
    </>
  )

const ChangeDetails = ({
  change,
  className = 'mt-1.5 pl-[4.5rem]',
}: {
  change: SecretChange
  className?: string
}) => {
  const created = change.kind === 'Created'
  const removedTags =
    change.tags?.old?.filter((tag) => !change.tags?.new.some((next) => next.id === tag.id)) ?? []
  const addedTags =
    change.tags?.new.filter((tag) => !change.tags?.old?.some((prev) => prev.id === tag.id)) ?? []

  const rows: ReactNode[] = []
  if (change.key && !created)
    rows.push(
      <FieldRow key="key" label="Key">
        <TextDiff diff={change.key} created={false} />
      </FieldRow>
    )
  if (change.folder)
    rows.push(
      <FieldRow key="folder" label="Folder">
        <TextDiff diff={change.folder} created={false} />
      </FieldRow>
    )
  if (change.secretType)
    rows.push(
      <FieldRow key="type" label="Type">
        <TextDiff
          diff={{
            old: secretTypeLabel(change.secretType.old ?? ''),
            new: secretTypeLabel(change.secretType.new),
          }}
          created={created}
        />
      </FieldRow>
    )
  if (change.value)
    rows.push(
      <FieldRow key="value" label="Value">
        <TextDiff diff={change.value} created={created} />
      </FieldRow>
    )
  if (change.comment && (!created || change.comment.new))
    rows.push(
      <FieldRow key="comment" label="Comment">
        <TextDiff diff={change.comment} created={created} />
      </FieldRow>
    )
  if (removedTags.length > 0 || addedTags.length > 0)
    rows.push(
      <FieldRow key="tags" label="Tags">
        <div className="flex flex-wrap gap-1 font-sans">
          {removedTags.map((tag) => (
            <span key={tag.id} className="rounded-full line-through opacity-60">
              <Tag tag={tag} buttonVariant="deleted" />
            </span>
          ))}
          {addedTags.map((tag) => (
            <span key={tag.id} className="rounded-full">
              <Tag tag={tag} buttonVariant="added" />
            </span>
          ))}
        </div>
      </FieldRow>
    )

  if (rows.length === 0) return null
  return (
    <dl className={clsx('grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-2xs', className)}>
      {rows}
    </dl>
  )
}

const KindBadge = ({ kind, muted }: { kind: ChangeKind; muted?: boolean }) => (
  <span
    className={clsx(
      'w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-3xs font-semibold uppercase tracking-wide',
      KIND_BADGE[kind],
      muted && 'opacity-50'
    )}
  >
    {kind}
  </span>
)

const KeyName = ({ change, tone }: { change: SecretChange; tone?: 'deleted' | 'muted' }) => (
  <span
    className={clsx(
      'min-w-0 break-all font-mono text-xs font-medium',
      tone ? 'text-neutral-500' : 'text-zinc-900 dark:text-zinc-100',
      tone === 'deleted' && 'line-through'
    )}
  >
    {change.folderPath && <span className="text-neutral-500">{change.folderPath}/</span>}
    {change.secretName}
  </span>
)

// One width for a row's Discard and the Undo that takes its place, so a second click lands on it
const ROW_ACTION = 'ml-auto w-20 shrink-0 !px-2 !py-0.5'

const ChangeItem = ({ change, onDiscard }: { change: SecretChange; onDiscard?: () => void }) => (
  <li className="group/change px-3 py-2 last:rounded-b-lg [@media(hover:hover)]:hover:bg-zinc-500/5">
    <div className="flex min-w-0 items-center gap-2">
      <KindBadge kind={change.kind} />
      <KeyName change={change} tone={change.kind === 'Deleted' ? 'deleted' : undefined} />
      {onDiscard && (
        <Button
          variant="ghost"
          icon={FaUndo}
          title="Discard this change"
          aria-label={`Discard the change to ${change.secretName}`}
          onClick={onDiscard}
          classString={clsx(ROW_ACTION, REVEAL_IN_CHANGE)}
        >
          Discard
        </Button>
      )}
    </div>
    <ChangeDetails change={change} />
  </li>
)

// Deploying to an env runs every active sync of that env; paused ones are skipped
export const SyncsOnDeploy = ({
  syncs,
  className = 'border-b border-neutral-500/10',
}: {
  syncs: EnvironmentSyncType[]
  className?: string
}) => {
  const active = syncs.filter((sync) => sync.isActive)
  const paused = syncs.length - active.length
  if (syncs.length === 0) return null
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-3xs text-neutral-500',
        className
      )}
    >
      <span className="flex items-center gap-1">
        <FaRotate className="text-[9px]" />
        {active.length > 0 ? 'Syncs on deploy' : 'No active syncs'}
      </span>
      {active.map((sync) => (
        <span key={sync.id} className="flex items-center gap-1 text-zinc-700 dark:text-zinc-300">
          <ProviderIcon providerId={sync.serviceInfo?.id ?? ''} />
          {sync.serviceInfo?.name}
          {sync.path && sync.path !== '/' && (
            <code className="text-neutral-500" title="Only this folder's secrets">
              {sync.path}
            </code>
          )}
        </span>
      ))}
      {paused > 0 && <span>· {paused} paused</span>}
    </div>
  )
}

/** Discards several changes at once, asked inline first: a dialog can't open over this one */
export const DiscardMany = ({
  count,
  title,
  where,
  onDiscard,
  compact,
  children,
}: {
  count: number
  title: string
  /** Completes "Discard the changes …" for screen readers, e.g. "in QA" */
  where: string
  onDiscard?: () => void
  /** Icon-only, for the hover card */
  compact?: boolean
  children?: ReactNode
}) => {
  const [asking, setAsking] = useState(false)
  if (!onDiscard) return <>{children}</>
  if (asking)
    return (
      <span className="flex items-center gap-1.5">
        <span className="whitespace-nowrap text-2xs font-medium text-zinc-900 dark:text-zinc-100">
          Discard all {count}?
        </span>
        <Button variant="secondary" icon={FaTimes} classString="!py-0.5" onClick={() => setAsking(false)}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon={FaUndo}
          classString="!py-0.5"
          aria-label={`Discard ${plural(count, 'change')} ${where}`}
          onClick={() => {
            setAsking(false)
            onDiscard()
          }}
        >
          Discard
        </Button>
      </span>
    )
  return (
    <span className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        icon={FaUndo}
        title={title}
        aria-label={`Discard the changes ${where}`}
        onClick={count > 1 ? () => setAsking(true) : onDiscard}
        classString={clsx(compact ? '!p-1' : '!px-2 !py-0.5', REVEAL_IN_ENV)}
      >
        {!compact && (count > 1 ? 'Discard all' : 'Discard')}
      </Button>
      {children}
    </span>
  )
}

const ChangeCount = ({ count }: { count: number }) => (
  <span className="text-3xs font-normal text-neutral-500">{plural(count, 'change')}</span>
)

/** Sticks to the top while its changes scroll under it, and folds them away */
const EnvHeader = ({
  environment,
  changes,
  collapsed,
  onToggle,
  onDiscard,
}: {
  environment: Partial<EnvironmentType>
  changes: SecretChange[]
  collapsed: boolean
  onToggle: () => void
  onDiscard?: () => void
}) => {
  const color = envColor(environment)
  return (
    // The dialog's own background, so nothing shows past the rounded corners while it's stuck
    <div className="sticky top-0 z-[1] bg-neutral-100 dark:bg-neutral-900">
      <div
        className={clsx(
          'group/env flex items-center gap-2 rounded-t-lg bg-zinc-200/70 px-3 py-1.5 dark:bg-zinc-800',
          collapsed && 'rounded-b-lg'
        )}
        // The env's color along the top edge, like its column header in the grid
        style={{ boxShadow: `inset 0 2px 0 ${color}` }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show the changes' : 'Hide the changes'}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none focus-visible:underline"
        >
          <FaChevronRight
            className={clsx(
              'shrink-0 text-[8px] text-neutral-500 transition-transform',
              !collapsed && 'rotate-90'
            )}
          />
          <FaCircle className="shrink-0 text-[7px]" style={{ color }} />
          <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {environment.name}
          </span>
        </button>
        <DiscardMany
          count={changes.length}
          title="Discard this environment's changes"
          where={`in ${environment.name}`}
          onDiscard={changes.length > 0 ? onDiscard : undefined}
        >
          {changes.length > 0 && <ChangeCount count={changes.length} />}
        </DiscardMany>
      </div>
    </div>
  )
}

const EnvChip = ({ environment }: { environment?: Partial<EnvironmentType> }) =>
  environment ? (
    <span className="flex min-w-0 items-center gap-1 rounded-full bg-zinc-500/10 px-1.5 py-0.5 font-sans text-3xs font-medium text-zinc-700 dark:text-zinc-300">
      <FaCircle className="shrink-0 text-[6px]" style={{ color: envColor(environment) }} />
      <span className="truncate">{environment.name}</span>
    </span>
  ) : null

const BADGE_GAP = <span className="w-16 shrink-0" />

/** A key's changes across envs: each distinct change once, with the envs it's made in */
const KeyItem = ({ group, onDiscard }: { group: KeyGroup; onDiscard?: () => void }) => {
  const [first] = group.changes
  const one = group.changes.length === 1
  const sameKind = group.changes.every((change) => change.kind === first.kind)
  const envCount = new Set(group.changes.map((change) => change.environment?.id)).size
  return (
    <li className="group/env px-3 py-2 last:rounded-b-lg [@media(hover:hover)]:hover:bg-zinc-500/5">
      <div className="flex min-w-0 items-center gap-2">
        {sameKind ? <KindBadge kind={first.kind} /> : BADGE_GAP}
        <KeyName
          change={first}
          tone={sameKind && first.kind === 'Deleted' ? 'deleted' : undefined}
        />
        {one && <EnvChip environment={first.environment} />}
        <span className="ml-auto shrink-0">
          <DiscardMany
            count={group.changes.length}
            title="Discard this key's changes"
            where={`to ${first.secretName}`}
            onDiscard={onDiscard}
          >
            {!one && (
              <span className="text-3xs text-neutral-500">{plural(envCount, 'environment')}</span>
            )}
          </DiscardMany>
        </span>
      </div>
      {one ? (
        <ChangeDetails change={first} />
      ) : (
        group.variants.map((variant) => (
          <div key={variant[0].id} className="mt-1.5">
            <div className="flex min-w-0 items-start gap-2">
              {sameKind ? BADGE_GAP : <KindBadge kind={variant[0].kind} />}
              {variant.length === 1 ? (
                // A change made in one env reads on one line: the env, then what changes there
                <>
                  <span className="flex w-36 shrink-0">
                    <EnvChip environment={variant[0].environment} />
                  </span>
                  <ChangeDetails change={variant[0]} className="min-w-0 flex-1" />
                </>
              ) : (
                <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
                  {variant.map((change) => (
                    <EnvChip key={change.id} environment={change.environment} />
                  ))}
                </span>
              )}
            </div>
            {variant.length > 1 && (
              <ChangeDetails change={variant[0]} className="mt-1 pl-[14rem]" />
            )}
          </div>
        ))
      )}
    </li>
  )
}

export type UndoDiscard = () => void

export type DiscardHandlers = {
  /** Puts these changes back as deployed; what it returns undoes that */
  onDiscardChanges?: (changes: SecretChange[]) => UndoDiscard | void
}

export type Discard = {
  id: number
  /** What was discarded at once: one change, an env's, or a key's */
  scope: 'change' | 'env' | 'key'
  changes: SecretChange[]
  undo: UndoDiscard
}

/** The discards made here, each with its undo, for as long as the component stays up */
export const useDiscards = (onDiscardChanges: DiscardHandlers['onDiscardChanges']) => {
  const [discards, setDiscards] = useState<Discard[]>([])
  const nextId = useRef(0)
  const discard = (scope: Discard['scope'], changes: SecretChange[]) => {
    const undo = onDiscardChanges?.(changes)
    if (undo) setDiscards((made) => [...made, { id: nextId.current++, scope, changes, undo }])
  }
  const undo = (made: Discard) => {
    made.undo()
    setDiscards((all) => all.filter((other) => other !== made))
  }
  return { discards, discard, undo }
}

export const describeDiscard = ({ scope, changes }: Discard) => {
  const [first] = changes
  const env = first.environment?.name
  if (changes.length === 1) return `the change to ${first.secretName}${env ? ` in ${env}` : ''}`
  return scope === 'key'
    ? `${changes.length} changes to ${first.secretName}`
    : `${changes.length} changes${env ? ` in ${env}` : ''}`
}

/** Stands in for what was discarded, where it was, so the discard can be undone on the spot */
const DiscardedItem = ({ made, onUndo }: { made: Discard; onUndo: () => void }) => {
  const [first] = made.changes
  const one = made.changes.length === 1
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 py-2 last:rounded-b-lg">
      {one && <KindBadge kind={first.kind} muted />}
      {made.scope !== 'env' && <KeyName change={first} tone="muted" />}
      <span className="shrink-0 text-2xs italic text-neutral-500">
        {one ? 'change discarded' : `${made.changes.length} changes discarded`}
      </span>
      <Button
        variant="ghost"
        icon={FaRedo}
        title="Undo this discard"
        aria-label={`Undo discarding ${describeDiscard(made)}`}
        onClick={onUndo}
        classString={ROW_ACTION}
      >
        Undo
      </Button>
    </li>
  )
}

const SECTION = 'shrink-0 rounded-lg ring-1 ring-inset ring-neutral-500/20'
const SCROLLER = 'flex min-h-0 flex-1 flex-col gap-3 overflow-auto focus:outline-none'
const TAB =
  '-mb-px flex items-center gap-1.5 border-b p-2 text-xs font-medium transition ease focus:outline-none'
// Gray: green would read as "created"
const TAB_COUNT =
  'rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-2xs text-zinc-600 dark:text-zinc-300'

/** Every change with its diff, by env or by key; scrolls within the height it's given */
export const ChangesDiff = ({
  changes: { changes: list, groups, kindCounts },
  syncsByEnvId,
  className,
  onDiscardChanges,
  startCollapsed,
}: {
  changes: SecretChanges
  /** Each env's syncs, so each env's changes say where they'll be sent */
  syncsByEnvId?: ReadonlyMap<string, EnvironmentSyncType[]>
  className?: string
  /** Opens with every env but the first folded to its header */
  startCollapsed?: boolean
} & DiscardHandlers) => {
  const showEnvironment = groups.some((group) => group.environment)
  // It can open under the pointer, where a double-click's second click would land on a discard
  const [pointerMoved, setPointerMoved] = useState(false)

  const keyGroups = useMemo(() => groupChangesByKey(list), [list])
  const worthByKey = showEnvironment && worthGroupingByKey(list, keyGroups)
  // Once offered, the tab stays for this opening: discarding down the list mustn't flip the view
  const [byKeyOffered, setByKeyOffered] = useState(worthByKey)
  useEffect(() => {
    if (worthByKey) setByKeyOffered(true)
  }, [worthByKey])
  const [byKey, setByKey] = useState(false)

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () =>
      new Set(startCollapsed ? groups.slice(1).flatMap((group) => group.environment?.id ?? []) : [])
  )
  const toggle = (envId: string) =>
    setCollapsed((folded) => {
      const next = new Set(folded)
      if (!next.delete(envId)) next.add(envId)
      return next
    })

  const { discards, discard, undo } = useDiscards(onDiscardChanges)
  const canDiscard = Boolean(onDiscardChanges)

  // Envs whose changes were all discarded keep their place while the discard can be undone
  const envGroups = [...groups]
  for (const { scope, changes } of discards) {
    const environment = changes[0].environment
    if (scope !== 'key' && !envGroups.some((group) => group.environment?.id === environment?.id))
      envGroups.push({ environment, changes: [] })
  }
  envGroups.sort((a, b) => (a.environment?.index ?? 0) - (b.environment?.index ?? 0))
  const envIds = envGroups.flatMap((group) => group.environment?.id ?? [])
  const allCollapsed = envIds.length > 0 && envIds.every((id) => collapsed.has(id))

  const envList = envGroups.map((group) => {
    const env = group.environment
    const folded = Boolean(env?.id && collapsed.has(env.id))
    const here = discards.filter(
      (made) => made.scope !== 'key' && made.changes[0].environment?.id === env?.id
    )
    const rows = [
      ...group.changes.map((change) => ({ change, made: undefined as Discard | undefined })),
      ...here
        .filter((made) => made.scope === 'change')
        .map((made) => ({ change: made.changes[0], made })),
    ].sort((a, b) => byKindThenName(a.change, b.change))
    return (
      <section key={env?.id ?? 'all'} className={SECTION}>
        {env?.id && (
          <EnvHeader
            environment={env}
            changes={group.changes}
            collapsed={folded}
            onToggle={() => toggle(env.id!)}
            onDiscard={canDiscard ? () => discard('env', group.changes) : undefined}
          />
        )}
        {!folded && (
          <>
            {env?.id && group.changes.length > 0 && syncsByEnvId?.get(env.id) && (
              <SyncsOnDeploy syncs={syncsByEnvId.get(env.id)!} />
            )}
            <ul className="divide-y divide-neutral-500/10">
              {here
                .filter((made) => made.scope === 'env')
                .map((made) => (
                  <DiscardedItem key={`discard-${made.id}`} made={made} onUndo={() => undo(made)} />
                ))}
              {rows.map(({ change, made }) =>
                made ? (
                  <DiscardedItem key={`discard-${made.id}`} made={made} onUndo={() => undo(made)} />
                ) : (
                  <ChangeItem
                    key={change.id}
                    change={change}
                    onDiscard={canDiscard ? () => discard('change', [change]) : undefined}
                  />
                )
              )}
            </ul>
          </>
        )}
      </section>
    )
  })

  const keyList = (
    <section className={SECTION}>
      <ul className="divide-y divide-neutral-500/10 [&>li:first-child]:rounded-t-lg">
        {[
          ...keyGroups.map((group) => ({ changes: group.changes, group, made: undefined })),
          ...discards
            .filter((made) => made.scope === 'key')
            .map((made) => ({ changes: made.changes, group: undefined, made })),
        ]
          .sort((a, b) => byReach(a.changes, b.changes))
          .map(({ group, made }) =>
            group ? (
              <KeyItem
                key={group.id}
                group={group}
                onDiscard={canDiscard ? () => discard('key', group.changes) : undefined}
              />
            ) : (
              <DiscardedItem key={`discard-${made.id}`} made={made} onUndo={() => undo(made)} />
            )
          )}
      </ul>
    </section>
  )

  return (
    // overflow-wrap:anywhere, as break-words doesn't let flex items shrink
    <div
      onPointerMove={pointerMoved ? undefined : () => setPointerMoved(true)}
      className={clsx(
        'flex min-h-0 flex-col gap-3 ph-no-capture [overflow-wrap:anywhere]',
        !pointerMoved && '[@media(hover:hover)]:[&_button]:pointer-events-none',
        className
      )}
    >
      <div className="flex min-h-6 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-neutral-500">
        <span>
          {plural(list.length, 'change')}
          {showEnvironment && ` across ${plural(groups.length, 'environment')}`}
        </span>
        <span>
          {kindCounts.map(({ kind, count }) => `${count} ${kind.toLowerCase()}`).join(' · ')}
        </span>
        {envIds.length > 1 && !(byKeyOffered && byKey) && (
          <Button
            variant="ghost"
            icon={allCollapsed ? FaAnglesDown : FaAnglesUp}
            classString="ml-auto !px-2 !py-0.5"
            onClick={() => setCollapsed(new Set(allCollapsed ? [] : envIds))}
          >
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </Button>
        )}
      </div>

      {byKeyOffered ? (
        <Tab.Group
          as={Fragment}
          selectedIndex={byKey ? 1 : 0}
          onChange={(index) => setByKey(index === 1)}
        >
          <Tab.List className="flex shrink-0 gap-2 border-b border-neutral-500/20">
            {[
              { label: 'By environment', icon: FaLayerGroup, count: groups.length },
              { label: 'By key', icon: FaKey, count: keyGroups.length },
            ].map(({ label, icon: Icon, count }) => (
              <Tab
                key={label}
                className={({ selected }) =>
                  clsx(
                    TAB,
                    selected
                      ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                      : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  )
                }
              >
                <Icon className="text-xs" /> {label}
                <span className={TAB_COUNT}>{count}</span>
              </Tab>
            ))}
          </Tab.List>
          <Tab.Panels as={Fragment}>
            <Tab.Panel className={SCROLLER}>{envList}</Tab.Panel>
            <Tab.Panel className={SCROLLER}>{keyList}</Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      ) : (
        <div className={SCROLLER}>{envList}</div>
      )}
    </div>
  )
}

export type DeployPreviewHandle = { open: () => void }

type DeployPreviewDialogProps = {
  changes: SecretChanges
  /** Each env's syncs, so each env's changes say where they'll be sent */
  syncsByEnvId?: ReadonlyMap<string, EnvironmentSyncType[]>
  /** Footer actions, so a review ends in a decision */
  onDiscard?: () => void
  onDeploy?: () => void
} & DiscardHandlers

/** The full diff of undeployed changes, grouped by environment */
export const DeployPreviewDialog = forwardRef<DeployPreviewHandle, DeployPreviewDialogProps>(
  function DeployPreviewDialog({ changes, syncsByEnvId, onDiscard, onDeploy, onDiscardChanges }, ref) {
    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
    useImperativeHandle(ref, () => ({ open: () => dialogRef.current?.openModal() }), [])

    const changeCount = changes.changes.length
    const hasActions = Boolean(onDiscard || onDeploy)
    const closeThen = (action: () => void) => () => {
      dialogRef.current?.closeModal()
      action()
    }

    return (
      <GenericDialog ref={dialogRef} title="Preview undeployed changes" size="lg">
        <ChangesDiff
          changes={changes}
          syncsByEnvId={syncsByEnvId}
          onDiscardChanges={onDiscardChanges}
          className={clsx('mt-1', hasActions ? 'max-h-[70vh]' : 'max-h-[80vh]')}
        />

        {hasActions && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-500/20 pt-3">
            {onDiscard ? (
              <Button variant="outline" icon={FaUndo} onClick={closeThen(onDiscard)}>
                Discard all changes
              </Button>
            ) : (
              <span />
            )}
            {onDeploy && (
              <Button variant="primary" icon={FaCloudUploadAlt} onClick={closeThen(onDeploy)}>
                Deploy {plural(changeCount, 'change')}
              </Button>
            )}
          </div>
        )}
      </GenericDialog>
    )
  }
)
