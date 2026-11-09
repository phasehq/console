'use client'

import {
  ApiEnvironmentSyncEventStatusChoices,
  ApiEnvironmentSyncStatusChoices,
  EnvironmentSyncType,
  EnvironmentType,
} from '@/apollo/graphql'
import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import {
  forwardRef,
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  FaArrowRight,
  FaCheckCircle,
  FaChevronDown,
  FaCloudUploadAlt,
  FaPen,
  FaTimesCircle,
  FaUndo,
} from 'react-icons/fa'
import { FaCircle, FaCodeCompare } from 'react-icons/fa6'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import Spinner from '@/components/common/Spinner'
import { HealthDot, SyncRow } from '@/components/syncing/EnvSyncsMenu'
import { envColor } from '@/utils/environment'
import { relativeTimeFromDates } from '@/utils/time'
import {
  ChangesDiff,
  DiscardHandlers,
  EnvChangeCount,
  KIND_STYLES,
  REVEAL_IN_CHANGE,
  SecretChanges,
  SyncsOnDeploy,
} from './DeployPreview'

const Status = ApiEnvironmentSyncStatusChoices
const EventStatus = ApiEnvironmentSyncEventStatusChoices
type RunStatus = ApiEnvironmentSyncStatusChoices | ApiEnvironmentSyncEventStatusChoices

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** "Development", "Development and Staging", "Development, Staging and Production" */
const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const changedEnvNames = (changes: SecretChanges) =>
  changes.groups.flatMap((group) => group.environment?.name ?? [])

// ---- Following a deploy's syncs ----

export type SyncRunState = 'queued' | 'running' | 'completed' | 'failed' | 'skipped'

/** A sync's run for the latest deploy */
export type SyncRun = {
  sync: EnvironmentSyncType
  state: SyncRunState
  /** For its indicator (e.g. timed out rather than failed) */
  status: RunStatus
  finishedAt?: string | null
}

export type DeployPhase = 'idle' | 'deploying' | 'syncing' | 'synced' | 'failed'

type DeployRecord = {
  envIds: ReadonlySet<string>
  changeCount: number
  /** Each sync's history before the deploy: its run for this deploy is the entry added after */
  priorEventIds: ReadonlyMap<string, ReadonlySet<string>>
  /** Set once the deploy has returned and the syncs have been re-read */
  deployedAt?: number
  /** A few seconds after: a sync that still has no run by then wasn't queued */
  settled?: boolean
}

const isPending = (run: SyncRun) => run.state === 'queued' || run.state === 'running'

const runOf = (sync: EnvironmentSyncType, record: DeployRecord): SyncRun | null => {
  // A deploy runs the active syncs of the envs it changed
  if (!sync.isActive || !record.envIds.has(sync.environment.id)) return null
  const prior = record.priorEventIds.get(sync.id)
  const run = sync.history
    .filter((event) => !prior?.has(event.id))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
  if (!run)
    return record.settled
      ? { sync, state: 'skipped', status: Status.Cancelled }
      : { sync, state: 'queued', status: Status.Queued }
  if (!run.completedAt) {
    const queued = run.status === EventStatus.Queued
    return {
      sync,
      state: queued ? 'queued' : 'running',
      status: queued ? EventStatus.Queued : EventStatus.InProgress,
    }
  }
  const state: SyncRunState =
    run.status === EventStatus.Completed
      ? 'completed'
      : run.status === EventStatus.Cancelled
        ? 'skipped'
        : 'failed'
  return { sync, state, status: run.status, finishedAt: run.completedAt }
}

/** How long an all-clear stays up before the controls settle back */
const SYNCED_LINGER_MS = 8000
const SETTLE_MS = 5000

/** Call `begin` before sending, to note each sync's earlier runs, and `deployed` once syncs are re-read */
export const useDeployRun = (syncs: EnvironmentSyncType[]) => {
  const syncsRef = useRef(syncs)
  syncsRef.current = syncs
  const [record, setRecord] = useState<DeployRecord | null>(null)

  const runs = useMemo(
    () =>
      record
        ? syncs
            .flatMap((sync) => runOf(sync, record) ?? [])
            .sort((a, b) => a.sync.environment.index - b.sync.environment.index)
        : [],
    [record, syncs]
  )

  // With no syncs to follow, a deploy goes straight to the all-clear
  const phase: DeployPhase = !record
    ? 'idle'
    : !record.deployedAt
      ? 'deploying'
      : runs.some(isPending)
        ? 'syncing'
        : runs.some((run) => run.state === 'failed')
          ? 'failed'
          : 'synced'

  const begin = useCallback((envIds: Iterable<string>, changeCount: number) => {
    setRecord({
      envIds: new Set(envIds),
      changeCount,
      priorEventIds: new Map(
        syncsRef.current.map((sync) => [sync.id, new Set(sync.history.map((event) => event.id))])
      ),
    })
  }, [])
  const deployed = useCallback(
    () => setRecord((current) => current && { ...current, deployedAt: Date.now() }),
    []
  )
  const clear = useCallback(() => setRecord(null), [])

  const deployedAt = record?.deployedAt
  const settled = record?.settled
  useEffect(() => {
    if (!deployedAt || settled) return
    const timer = setTimeout(
      () =>
        setRecord((current) =>
          current?.deployedAt === deployedAt ? { ...current, settled: true } : current
        ),
      SETTLE_MS
    )
    return () => clearTimeout(timer)
  }, [deployedAt, settled])

  // An all-clear shows for a moment, then the controls settle back to the app's syncs
  useEffect(() => {
    if (phase !== 'synced') return
    const timer = setTimeout(() => setRecord(null), SYNCED_LINGER_MS)
    return () => clearTimeout(timer)
  }, [phase])

  return { phase, runs, changeCount: record?.changeCount ?? 0, begin, deployed, clear }
}

export type DeployRun = ReturnType<typeof useDeployRun>

// ---- The syncs panel ----

const PANEL =
  'z-50 w-[30rem] overflow-hidden rounded-lg bg-zinc-100 text-zinc-900 shadow-xl ring-1 ring-inset ring-neutral-500/30 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100'

const syncsDetail = (syncs: EnvironmentSyncType[]) => {
  const failing = syncs.filter(
    (sync) => sync.isActive && (sync.status === Status.Failed || sync.status === Status.TimedOut)
  ).length
  const running = syncs.filter(
    (sync) => sync.isActive && (sync.status === Status.InProgress || sync.status === Status.Queued)
  ).length
  const paused = syncs.filter((sync) => !sync.isActive).length
  return [
    failing > 0 && `${failing} failing`,
    running > 0 && `${running} syncing`,
    paused > 0 && `${paused} paused`,
  ]
    .filter(Boolean)
    .join(' · ')
}

const runDetail = (phase: DeployPhase, runs: SyncRun[]) => {
  const done = runs.filter((run) => !isPending(run)).length
  const failed = runs.filter((run) => run.state === 'failed').length
  if (phase === 'syncing') return `${done} of ${plural(runs.length, 'sync')} done`
  if (phase === 'failed') return `${failed} of ${plural(runs.length, 'sync')} failed`
  return `${plural(runs.length, 'sync')} done`
}

const runWhen = (run: SyncRun) =>
  isPending(run)
    ? 'now'
    : run.state === 'skipped'
      ? 'not run'
      : run.finishedAt
        ? relativeTimeFromDates(new Date(run.finishedAt))
        : ''

type PanelRow = { sync: EnvironmentSyncType; status?: RunStatus; when?: string }

const SyncsList = ({
  title,
  detail,
  rows,
  environments,
  manageHref,
}: {
  title: string
  detail?: string
  rows: PanelRow[]
  environments: EnvironmentType[]
  manageHref: string
}) => {
  const groups = environments
    .map((env) => ({ env, rows: rows.filter((row) => row.sync.environment.id === env.id) }))
    .filter((group) => group.rows.length > 0)

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-500/20 px-3 py-2 text-xs">
        <div className="min-w-0 truncate">
          <span className="font-semibold">{title}</span>
          {detail && <span className="text-neutral-500"> · {detail}</span>}
        </div>
        <Link
          href={manageHref}
          className="flex shrink-0 items-center gap-1 text-2xs text-emerald-600 hover:underline dark:text-emerald-400"
        >
          Manage syncs <FaArrowRight className="text-[9px]" />
        </Link>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {groups.map(({ env, rows: envRows }) => (
          <section key={env.id}>
            <div className="flex items-center gap-1.5 bg-zinc-200/70 px-3 py-1 text-2xs font-medium text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
              <FaCircle className="shrink-0 text-[6px]" style={{ color: envColor(env) }} />
              {env.name}
            </div>
            <ul className="divide-y divide-neutral-500/15">
              {envRows.map((row) => (
                <SyncRow key={row.sync.id} sync={row.sync} status={row.status} when={row.when} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}

/** Calls `onClose` when the popover it's given the state of closes */
const WhenClosed = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const wasOpen = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (open) wasOpen.current = true
    else if (wasOpen.current) {
      wasOpen.current = false
      onCloseRef.current()
    }
  }, [open])
  return null
}

// ---- Discard, confirmed ----

export type DiscardDialogHandle = { open: () => void }

/** Focus starts on the dialog itself, so a stray Enter doesn't discard */
export const DiscardChangesDialog = forwardRef<
  DiscardDialogHandle,
  { changes: SecretChanges; onDiscard: () => void }
>(function DiscardChangesDialog({ changes, onDiscard }, ref) {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  useImperativeHandle(ref, () => ({ open: () => dialogRef.current?.openModal() }), [])
  const count = changes.changes.length
  const envNames = changedEnvNames(changes)

  return (
    <GenericDialog ref={dialogRef} title={`Discard ${plural(count, 'undeployed change')}?`} size="sm">
      <p className="mt-2 text-sm text-neutral-500">
        {envNames.length > 0
          ? `Your edits in ${listNames(envNames)} will be lost.`
          : 'Your edits will be lost.'}{' '}
        This can&apos;t be undone.
      </p>
      <div className="mt-5 flex items-center justify-between gap-2">
        <Button variant="secondary" icon={FaPen} onClick={() => dialogRef.current?.closeModal()}>
          Keep editing
        </Button>
        <Button
          variant="danger"
          icon={FaUndo}
          onClick={() => {
            dialogRef.current?.closeModal()
            onDiscard()
          }}
        >
          Discard {plural(count, 'change')}
        </Button>
      </div>
    </GenericDialog>
  )
})

// ---- Leaving with changes ----

export type LeaveDialogHandle = { open: (leave: () => void) => void }

/** Deploy and leave carries on only once the deploy has gone through */
export const LeaveWithChangesDialog = forwardRef<
  LeaveDialogHandle,
  {
    changes: SecretChanges
    syncsByEnvId?: ReadonlyMap<string, EnvironmentSyncType[]>
    onDiscard: () => void
    /** Resolves true once deployed */
    onDeploy: () => Promise<boolean>
  }
>(function LeaveWithChangesDialog({ changes, syncsByEnvId, onDiscard, onDeploy }, ref) {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const leaveRef = useRef<(() => void) | null>(null)
  useImperativeHandle(
    ref,
    () => ({
      open: (leave) => {
        leaveRef.current = leave
        dialogRef.current?.openModal()
      },
    }),
    []
  )
  const count = changes.changes.length
  const envNames = changedEnvNames(changes)

  const takeLeave = () => {
    const leave = leaveRef.current
    leaveRef.current = null
    dialogRef.current?.closeModal()
    return leave
  }
  const discardAndLeave = () => {
    const leave = takeLeave()
    onDiscard()
    leave?.()
  }
  const deployAndLeave = async () => {
    const leave = takeLeave()
    if (await onDeploy()) leave?.()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Leave with ${plural(count, 'undeployed change')}?`}
      size="lg"
      onClose={() => (leaveRef.current = null)}
    >
      <p className="mt-1 text-sm text-neutral-500">
        {envNames.length > 0
          ? `Your edits in ${listNames(envNames)} haven't been deployed.`
          : "Your edits haven't been deployed."}{' '}
        Deploy them before you go, or discard them.
      </p>
      <ChangesDiff changes={changes} syncsByEnvId={syncsByEnvId} className="mt-3 max-h-[55vh]" />
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-500/20 pt-3">
        <Button variant="secondary" icon={FaPen} onClick={() => dialogRef.current?.closeModal()}>
          Keep editing
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="danger" icon={FaUndo} onClick={discardAndLeave}>
            Discard and leave
          </Button>
          <Button variant="primary" icon={FaCloudUploadAlt} onClick={deployAndLeave}>
            Deploy and leave
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
})

// ---- The controls ----

export type DeployControlsProps = {
  changes: SecretChanges
  dirty: boolean
  deploying: boolean
  run: DeployRun
  /** All of the app's syncs (empty when they can't be read) */
  syncs: EnvironmentSyncType[]
  syncsByEnvId: ReadonlyMap<string, EnvironmentSyncType[]>
  environments: EnvironmentType[]
  manageSyncsHref: string
  /** Opens the full preview */
  onReview: () => void
  /** Asks to discard (the caller confirms) */
  onDiscard: () => void
  onDeploy: () => void
} & DiscardHandlers

// Inset focus rings: the pill clips its face while it resizes
const PILL =
  'flex h-8 shrink-0 justify-center overflow-hidden rounded-full text-xs font-medium transition-[width,background-color,color,box-shadow] duration-200 ease-out motion-reduce:transition-none'
const PILL_PRIMARY =
  'bg-zinc-900 text-white dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20'
const PILL_QUIET =
  'bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-neutral-500/30 dark:bg-zinc-800/60 dark:text-zinc-300'
const FACE =
  'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 transition-colors focus:outline-none'
const FACE_PRIMARY = clsx(
  FACE,
  'hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/60 disabled:pointer-events-none dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300'
)
const FACE_QUIET = clsx(
  FACE,
  'hover:bg-zinc-900/5 data-[focus]:ring-2 data-[focus]:ring-inset data-[focus]:ring-emerald-500/60 data-[open]:bg-zinc-900/5 dark:hover:bg-white/5 dark:data-[open]:bg-white/5'
)

/** Measures its content so the width can transition (CSS can't animate to auto) */
const Pill = ({ tone, children }: { tone: 'primary' | 'quiet'; children: ReactNode }) => {
  const faceRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const face = faceRef.current
    if (!face) return
    const fit = () => setWidth(Math.ceil(face.getBoundingClientRect().width))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(face)
    return () => observer.disconnect()
  }, [])

  return (
    <div className={clsx(PILL, tone === 'primary' ? PILL_PRIMARY : PILL_QUIET)} style={{ width }}>
      <div ref={faceRef} className="flex w-max shrink-0">
        {children}
      </div>
    </div>
  )
}

const SettledFace = ({ run, syncs }: { run: DeployRun; syncs: EnvironmentSyncType[] }) => {
  const done = run.runs.filter((r) => !isPending(r)).length
  const progress = (
    <span className="tabular-nums text-neutral-500">
      {done}/{run.runs.length}
    </span>
  )
  if (run.phase === 'syncing')
    return (
      <>
        <Spinner size="xs" color="amber" />
        Syncing {progress}
      </>
    )
  if (run.phase === 'failed') {
    const failed = run.runs.filter((r) => r.state === 'failed').length
    return (
      <>
        <FaTimesCircle className="shrink-0 text-red-500" />
        <span className="text-red-600 dark:text-red-400">{plural(failed, 'sync')} failed</span>
      </>
    )
  }
  if (run.phase === 'synced' && run.runs.length > 0)
    return (
      <>
        <FaCheckCircle className="shrink-0 text-emerald-500" />
        Synced {progress}
      </>
    )
  return (
    <>
      <FaCheckCircle className="shrink-0 text-emerald-500" />
      Deployed
      <HealthDot syncs={syncs} />
    </>
  )
}

const MAX_KEYS_PER_ENV = 4

type ChoiceProps = {
  changes: SecretChanges
  syncsByEnvId: ReadonlyMap<string, EnvironmentSyncType[]>
  onReview: () => void
  onDiscard: () => void
  onDeploy: () => void
} & DiscardHandlers

const ChangesCard = ({
  changes,
  syncsByEnvId,
  onReview,
  onDiscard,
  onDeploy,
  onDiscardChange,
  onDiscardEnv,
}: ChoiceProps) => {
  const count = changes.changes.length
  return (
    <>
      <div className="flex items-baseline gap-2 border-b border-neutral-500/20 px-3 py-2 text-xs">
        <span className="whitespace-nowrap font-semibold">{plural(count, 'undeployed change')}</span>
        <span className="truncate text-neutral-500">
          {changes.kindCounts.map(({ kind, count }) => `${count} ${kind.toLowerCase()}`).join(' · ')}
        </span>
      </div>
      <div className="max-h-80 divide-y divide-neutral-500/15 overflow-y-auto">
        {changes.groups.map((group) => {
          const env = group.environment
          const envSyncs = env?.id ? syncsByEnvId.get(env.id) : undefined
          const more = group.changes.length - MAX_KEYS_PER_ENV
          return (
            <section key={env?.id ?? 'all'} className="py-1.5">
              {env && (
                <div className="group/env flex h-6 items-center gap-1.5 px-3 text-xs font-medium">
                  <FaCircle className="shrink-0 text-[6px]" style={{ color: envColor(env) }} />
                  {env.name}
                  <span className="ml-auto">
                    <EnvChangeCount
                      compact
                      count={group.changes.length}
                      envName={env.name}
                      onDiscard={onDiscardEnv && env.id ? () => onDiscardEnv(env.id!) : undefined}
                    />
                  </span>
                </div>
              )}
              <ul className="px-3">
                {group.changes.slice(0, MAX_KEYS_PER_ENV).map((change) => (
                  <li key={change.id} className="group/change flex h-6 min-w-0 items-center gap-2">
                    <span
                      className={clsx(
                        'w-16 shrink-0 rounded px-1 text-center text-3xs font-semibold uppercase leading-4 tracking-wide',
                        KIND_STYLES[change.kind].badge
                      )}
                    >
                      {change.kind}
                    </span>
                    <span
                      className={clsx(
                        'min-w-0 truncate font-mono text-2xs',
                        change.kind === 'Deleted' && 'text-neutral-500 line-through'
                      )}
                    >
                      {change.folderPath && (
                        <span className="text-neutral-500">{change.folderPath}/</span>
                      )}
                      {change.secretName}
                    </span>
                    {onDiscardChange && (
                      <Button
                        variant="ghost"
                        icon={FaUndo}
                        title="Discard this change"
                        aria-label={`Discard the change to ${change.secretName}`}
                        onClick={() => onDiscardChange(change)}
                        classString={clsx('ml-auto shrink-0 !p-1', REVEAL_IN_CHANGE)}
                      />
                    )}
                  </li>
                ))}
                {more > 0 && (
                  <li className="py-0.5 pl-[4.5rem]">
                    <button
                      type="button"
                      onClick={onReview}
                      className="text-3xs text-neutral-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
                    >
                      +{more} more
                    </button>
                  </li>
                )}
              </ul>
              {envSyncs && <SyncsOnDeploy syncs={envSyncs} className="!pb-0" />}
            </section>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-neutral-500/20 bg-zinc-200/50 px-3 py-2 dark:bg-zinc-900/40">
        <Button variant="outline" icon={FaUndo} onClick={onDiscard}>
          Discard
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon={FaCodeCompare} onClick={onReview}>
            Review
          </Button>
          <Button variant="primary" icon={FaCloudUploadAlt} onClick={onDeploy}>
            Deploy {plural(count, 'change')}
          </Button>
        </div>
      </div>
    </>
  )
}

const HOVER_OPEN_MS = 150
const HOVER_CLOSE_MS = 200

/** A card rather than the dialog on hover: a pass of the mouse shouldn't take over the page */
const PendingChanges = ({ deploying, ...props }: ChoiceProps & { deploying: boolean }) => {
  const { changes, onReview, onDiscard, onDeploy } = props
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), ms)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const choose = (action: () => void) => () => {
    clearTimeout(timer.current)
    setOpen(false)
    action()
  }

  const count = changes.changes.length
  const envNames = changedEnvNames(changes)
  const shown = open && !deploying

  return (
    <div
      className="relative"
      onMouseEnter={() => later(true, HOVER_OPEN_MS)}
      onMouseLeave={() => later(false, HOVER_CLOSE_MS)}
      onFocus={() => later(true, 0)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) later(false, 0)
      }}
    >
      {/* Steps down with the width, so it never squeezes the search or wraps the toolbar */}
      <button
        type="button"
        onClick={choose(onReview)}
        disabled={deploying}
        title="Review the changes"
        aria-haspopup="dialog"
        className={clsx(
          'flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-1.5 text-xs transition-colors hover:bg-zinc-200 focus:outline-none focus-visible:bg-zinc-200 disabled:pointer-events-none dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800 lg:px-2.5',
          shown && 'bg-zinc-200 dark:bg-zinc-800'
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          {count} <span className="hidden lg:inline">undeployed </span>
          {count === 1 ? 'change' : 'changes'}
        </span>
        {envNames.length > 0 && (
          <span className="hidden text-neutral-500 xl:inline">
            in {envNames.length <= 2 ? envNames.join(', ') : plural(envNames.length, 'environment')}
          </span>
        )}
        <FaChevronDown className="hidden shrink-0 text-[8px] text-neutral-500 lg:block" />
      </button>
      <Transition
        show={shown}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        {/* The top padding bridges the gap, so moving onto the card keeps it open */}
        <div className="absolute right-0 top-full z-50 pt-2">
          <div className={clsx(PANEL, '!w-[min(28rem,calc(100vw-2rem))]')}>
            <ChangesCard
              {...props}
              onReview={choose(onReview)}
              onDiscard={choose(onDiscard)}
              onDeploy={choose(onDeploy)}
            />
          </div>
        </div>
      </Transition>
    </div>
  )
}

export const DeployControls = ({
  changes,
  dirty,
  deploying,
  run,
  syncs,
  syncsByEnvId,
  environments,
  manageSyncsHref,
  onReview,
  onDiscard,
  onDeploy,
  onDiscardChange,
  onDiscardEnv,
}: DeployControlsProps) => {
  const pending = dirty || deploying
  const following = !pending && run.phase !== 'idle' && run.phase !== 'deploying'

  const line: ReactNode = pending ? (
    <PendingChanges
      changes={changes}
      syncsByEnvId={syncsByEnvId}
      deploying={deploying}
      onReview={onReview}
      onDiscard={onDiscard}
      onDeploy={onDeploy}
      onDiscardChange={onDiscardChange}
      onDiscardEnv={onDiscardEnv}
    />
  ) : following ? (
    <span className="hidden items-center gap-1.5 whitespace-nowrap text-neutral-500 lg:flex">
      <FaCheckCircle className="shrink-0 text-emerald-500" />
      Deployed {plural(run.changeCount, 'change')}
    </span>
  ) : null

  // Keeps the last line up while it fades away
  const lastLine = useRef<ReactNode>(null)
  if (line) lastLine.current = line

  const announcement = pending
    ? plural(changes.changes.length, 'undeployed change')
    : following
      ? `Deployed ${plural(run.changeCount, 'change')}`
      : ''

  const face = pending ? (
    <button type="button" onClick={onDeploy} disabled={deploying} className={FACE_PRIMARY}>
      {deploying ? (
        <Spinner size="xs" color="emerald" />
      ) : (
        <FaCloudUploadAlt className="shrink-0 text-sm text-emerald-400" />
      )}
      {deploying ? 'Deploying' : 'Deploy'}
    </button>
  ) : syncs.length === 0 && run.runs.length === 0 ? (
    <span className={FACE}>
      <SettledFace run={run} syncs={syncs} />
    </span>
  ) : (
    <Popover className="flex">
      {({ open }) => (
        <>
          {/* A failed deploy's result clears once it's been seen */}
          {run.phase === 'failed' && <WhenClosed open={open} onClose={run.clear} />}
          <PopoverButton className={FACE_QUIET} title="Syncs">
            <SettledFace run={run} syncs={syncs} />
            <FaChevronDown className="shrink-0 text-[8px] text-neutral-500" />
          </PopoverButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <PopoverPanel anchor={{ to: 'bottom end', gap: 8, padding: 16 }} className={PANEL}>
              {following ? (
                <SyncsList
                  title={`Deployed ${plural(run.changeCount, 'change')}`}
                  detail={runDetail(run.phase, run.runs)}
                  rows={run.runs.map((r) => ({ sync: r.sync, status: r.status, when: runWhen(r) }))}
                  environments={environments}
                  manageHref={manageSyncsHref}
                />
              ) : (
                <SyncsList
                  title="Syncs"
                  detail={syncsDetail(syncs)}
                  rows={syncs.map((sync) => ({ sync }))}
                  environments={environments}
                  manageHref={manageSyncsHref}
                />
              )}
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  )

  return (
    <div className="flex min-w-0 items-center justify-end">
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <Transition
        show={Boolean(line)}
        enter="transition-opacity duration-200"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="transition-opacity duration-150"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
      >
        <div className="flex min-w-0 items-center text-xs lg:pr-2">
          {line ?? lastLine.current}
        </div>
      </Transition>
      {/* A fixed slot, so the count beside the resizing button stays put */}
      <div className="flex min-w-[8.625rem] shrink-0 justify-end lg:min-w-[8.75rem]">
        <Pill tone={pending ? 'primary' : 'quiet'}>{face}</Pill>
      </div>
    </div>
  )
}
