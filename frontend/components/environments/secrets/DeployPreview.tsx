import { ApiSecretTypeChoices, EnvironmentType, SecretTagType, SecretType } from '@/apollo/graphql'
import { ReactNode, useMemo } from 'react'
import { FaArrowRight, FaCircle } from 'react-icons/fa6'
import clsx from 'clsx'
import { arraysEqual } from '@/utils/crypto'
import { envColor } from '@/utils/environment'
import { Tag } from '../Tag'
import { Alert } from '@/components/common/Alert'
import GenericDialog from '@/components/common/GenericDialog'
import { SECRET_TYPES } from './TypeSelector'

type ChangeKind = 'Created' | 'Updated' | 'Deleted'

/** `old` is null when it isn't known (a saved sealed value never reaches the client) */
type ChangeDetail<T = string> = { old: T | null; new: T }

type SecretChange = {
  id: string
  kind: ChangeKind
  secretName: string
  /** Set when `showPath` is on and the secret isn't at the root */
  folderPath?: string
  /** Set when `showEnvironment` is on */
  environment?: Partial<EnvironmentType>
  key?: ChangeDetail
  secretType?: ChangeDetail
  value?: ChangeDetail
  comment?: ChangeDetail
  tags?: ChangeDetail<SecretTagType[]>
}

type ChangeGroup = { environment?: Partial<EnvironmentType>; changes: SecretChange[] }

const secretTypeLabel = (type: string) => SECRET_TYPES.find((t) => t.value === type)?.label ?? type

const KIND_ORDER: Record<ChangeKind, number> = { Created: 0, Updated: 1, Deleted: 2 }

const KIND_STYLES: Record<ChangeKind, { badge: string; dot: string }> = {
  Created: {
    badge: 'bg-emerald-400/15 text-emerald-700 dark:text-emerald-400',
    dot: 'text-emerald-500',
  },
  Updated: { badge: 'bg-amber-400/15 text-amber-700 dark:text-amber-400', dot: 'text-amber-500' },
  Deleted: { badge: 'bg-red-400/15 text-red-700 dark:text-red-400', dot: 'text-red-500' },
}

const OLD_VALUE = 'rounded bg-red-400/15 px-1 text-red-700 line-through dark:text-red-400'
const NEW_VALUE = 'rounded bg-emerald-400/15 px-1 text-emerald-800 dark:text-emerald-300'
const PLAIN_VALUE = 'rounded bg-zinc-400/10 px-1 text-zinc-900 dark:text-zinc-100'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

type DeployPreviewProps = {
  clientSecrets: SecretType[]
  serverSecrets: SecretType[]
  secretsToDelete: string[]
  /** Group changes by environment (for the grid editor, where one key maps to a
   *  secret per env). */
  showEnvironment?: boolean
  /** Prefix keys outside the root with their folder (the grid spans folders) */
  showPath?: boolean
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

const ChangeDetails = ({ change }: { change: SecretChange }) => {
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
    <dl className="mt-1.5 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 pl-[4.5rem] text-2xs">
      {rows}
    </dl>
  )
}

const ChangeItem = ({ change }: { change: SecretChange }) => (
  <li className="px-3 py-2">
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={clsx(
          'w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-3xs font-semibold uppercase tracking-wide',
          KIND_STYLES[change.kind].badge
        )}
      >
        {change.kind}
      </span>
      <span
        className={clsx(
          'min-w-0 break-all font-mono text-xs font-medium',
          change.kind === 'Deleted'
            ? 'text-neutral-500 line-through'
            : 'text-zinc-900 dark:text-zinc-100'
        )}
      >
        {change.folderPath && <span className="text-neutral-500">{change.folderPath}/</span>}
        {change.secretName}
      </span>
    </div>
    <ChangeDetails change={change} />
  </li>
)

const EnvHeader = ({ environment, count }: { environment: Partial<EnvironmentType>; count: number }) => {
  const color = envColor(environment)
  return (
    <div
      className="flex items-center gap-2 bg-zinc-200/70 px-3 py-1.5 dark:bg-zinc-800"
      // The env's color along the top edge, like its column header in the grid
      style={{ boxShadow: `inset 0 2px 0 ${color}` }}
    >
      <FaCircle className="shrink-0 text-[7px]" style={{ color }} />
      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
        {environment.name}
      </span>
      <span className="ml-auto text-3xs text-neutral-500">{plural(count, 'change')}</span>
    </div>
  )
}

export const DeployPreview: React.FC<DeployPreviewProps> = ({
  clientSecrets,
  serverSecrets,
  secretsToDelete,
  showEnvironment,
  showPath,
}) => {
  const serverSecretsById = useMemo(
    () => new Map(serverSecrets.map((secret) => [secret.id, secret])),
    [serverSecrets]
  )

  // Memoized: this runs while the editor is dirty, i.e. on every keystroke
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

      if (change.key || change.secretType || change.value || change.comment || change.tags)
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

  // One section per environment in env order; within it, created → updated → deleted
  const groups = useMemo((): ChangeGroup[] => {
    const sorted = [...changes].sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (a.folderPath ?? '').localeCompare(b.folderPath ?? '') ||
        a.secretName.localeCompare(b.secretName)
    )
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

  const changeCount = changes.length
  const kindCounts = (['Created', 'Updated', 'Deleted'] as ChangeKind[])
    .map((kind) => ({ kind, count: changes.filter((change) => change.kind === kind).length }))
    .filter(({ count }) => count > 0)

  return (
    <div>
      <GenericDialog
        buttonVariant="ghost"
        title="Preview undeployed changes"
        size="lg"
        buttonContent={
          <Alert variant="info" size="sm" icon={true}>
            <span>
              {changeCount} undeployed {changeCount === 1 ? 'change' : 'changes'}. Click to preview
            </span>
          </Alert>
        }
      >
        {/* overflow-wrap:anywhere lets long unbroken keys and comments wrap inside the
            flex rows (break-words alone doesn't let flex items shrink) */}
        <div className="mt-1 flex max-h-[80vh] flex-col gap-3 overflow-auto ph-no-capture [overflow-wrap:anywhere]">
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-neutral-500">
            <span>
              {plural(changeCount, 'change')}
              {showEnvironment && groups.length > 0 && ` across ${plural(groups.length, 'environment')}`}
            </span>
            {kindCounts.map(({ kind, count }) => (
              <span key={kind} className="flex items-center gap-1">
                <FaCircle className={clsx('text-[6px]', KIND_STYLES[kind].dot)} />
                {count} {kind.toLowerCase()}
              </span>
            ))}
          </div>

          {groups.map((group) => (
            <section
              key={group.environment?.id ?? 'all'}
              // shrink-0: in the capped-height column, sections would squash instead of scrolling
              className="shrink-0 overflow-hidden rounded-lg ring-1 ring-inset ring-neutral-500/20"
            >
              {group.environment && (
                <EnvHeader environment={group.environment} count={group.changes.length} />
              )}
              <ul className="divide-y divide-neutral-500/10">
                {group.changes.map((change) => (
                  <ChangeItem key={change.id} change={change} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </GenericDialog>
    </div>
  )
}
