'use client'

import { ApiEnvironmentSyncStatusChoices, EnvironmentSyncType } from '@/apollo/graphql'
import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import Link from 'next/link'
import { Fragment } from 'react'
import { FaArrowRight, FaFolder } from 'react-icons/fa'
import { FaArrowsRotate } from 'react-icons/fa6'
import { ProviderIcon } from './ProviderIcon'
import { ServiceInfo } from './ServiceInfo'
import { SyncStatusIndicator } from './SyncStatusIndicator'

const Status = ApiEnvironmentSyncStatusChoices

const isFailing = (sync: EnvironmentSyncType) =>
  sync.isActive && (sync.status === Status.Failed || sync.status === Status.TimedOut)
const isRunning = (sync: EnvironmentSyncType) =>
  sync.isActive && (sync.status === Status.InProgress || sync.status === Status.Queued)

export type SyncsHealth = 'failing' | 'running' | 'synced' | 'paused'

/** Worst first: a failure needs attention even while another sync is still running */
export const syncsHealth = (syncs: EnvironmentSyncType[]): SyncsHealth => {
  if (syncs.some(isFailing)) return 'failing'
  if (syncs.some(isRunning)) return 'running'
  if (syncs.every((sync) => !sync.isActive)) return 'paused'
  return 'synced'
}

/** Only states that need a look get a badge; paused syncs are dimmed instead */
const HealthBadge = ({ health }: { health: SyncsHealth }) =>
  health === 'failing' || health === 'running' ? (
    <span
      aria-hidden
      className={clsx(
        // Above the next overlapping icon, ringed in the header colour to stand apart
        'absolute -bottom-0.5 -right-0.5 z-10 h-2 w-2 rounded-full ring-2 ring-zinc-200 dark:ring-zinc-900',
        health === 'failing' ? 'bg-red-500' : 'animate-pulse bg-sky-400'
      )}
    />
  ) : null

export const syncFolderLabel = (path?: string | null) => (!path || path === '/' ? '/' : path)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Up to `max` provider icons, overlapping, each badged when it's failing or syncing */
export const SyncProviderIcons = ({
  syncs,
  max = 3,
}: {
  syncs: EnvironmentSyncType[]
  max?: number
}) => {
  const hidden = syncs.slice(max)
  return (
    <span className="flex items-center">
      <span className="flex -space-x-1">
        {syncs.slice(0, max).map((sync) => (
          <span
            key={sync.id}
            className={clsx(
              'relative flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-[11px] ring-1 ring-zinc-300 dark:bg-zinc-800 dark:ring-zinc-900',
              !sync.isActive && 'opacity-50'
            )}
          >
            <ProviderIcon providerId={sync.serviceInfo?.id ?? ''} />
            <HealthBadge health={syncsHealth([sync])} />
          </span>
        ))}
      </span>
      {hidden.length > 0 && (
        <span className="relative ml-1 pr-1 text-3xs text-neutral-500">
          +{hidden.length}
          <HealthBadge health={syncsHealth(hidden)} />
        </span>
      )}
    </span>
  )
}

/** A narrow column's stand-in for the icons: how many syncs, badged like they are */
const SyncCount = ({ syncs }: { syncs: EnvironmentSyncType[] }) => (
  <span className="relative flex h-5 items-center gap-1 pr-1.5 text-3xs text-neutral-500">
    <FaArrowsRotate className="text-[10px]" />
    {syncs.length}
    <HealthBadge health={syncsHealth(syncs)} />
  </span>
)

const lastRun = (sync: EnvironmentSyncType) =>
  isRunning(sync)
    ? 'now'
    : sync.lastSync
      ? relativeTimeFromDates(new Date(sync.lastSync))
      : 'never'

/**
 * An env column's syncs: provider icons in the header, with each sync's target, folder,
 * status and last run a click away. Sits in a size container (the header) and steps
 * down as the column narrows, so the env name keeps the room.
 */
export const EnvSyncsMenu = ({
  envName,
  syncs,
  manageHref,
}: {
  envName: string
  syncs: EnvironmentSyncType[]
  manageHref: string
}) => {
  const failing = syncs.filter(isFailing).length
  const running = syncs.filter(isRunning).length
  const paused = syncs.filter((sync) => !sync.isActive).length
  const details = [
    failing > 0 && `${failing} failing`,
    running > 0 && `${running} syncing`,
    paused > 0 && `${paused} paused`,
  ]
    .filter(Boolean)
    .join(' · ')
  const label = `${plural(syncs.length, 'sync')} from ${envName}${details ? ` · ${details}` : ''}`

  return (
    <Popover className="relative shrink-0 [@container(max-width:195px)]:hidden">
      <PopoverButton
        title={label}
        aria-label={label}
        // data-focus is keyboard-only (unlike :focus-visible, a mouse click always clears it)
        className="flex items-center rounded-full px-1 py-0.5 transition-colors hover:bg-zinc-300/60 focus:outline-none data-[open]:bg-zinc-300 data-[focus]:ring-1 data-[focus]:ring-emerald-500/70 dark:hover:bg-zinc-700/60 dark:data-[open]:bg-zinc-700"
      >
        {syncs.length === 1 ? (
          <SyncProviderIcons syncs={syncs} />
        ) : (
          <>
            <span className="flex [@container(max-width:231px)]:hidden">
              <SyncProviderIcons syncs={syncs} />
            </span>
            <span className="hidden [@container(max-width:231px)]:flex">
              <SyncCount syncs={syncs} />
            </span>
          </>
        )}
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
        {/* Anchored into a portal so the grid's scroll container can't clip it */}
        <PopoverPanel
          anchor={{ to: 'bottom end', gap: 6, padding: 16 }}
          className="z-50 w-[30rem] overflow-hidden rounded-lg bg-zinc-100 text-zinc-900 shadow-xl ring-1 ring-inset ring-neutral-500/30 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
        >
          <div className="flex items-center justify-between gap-3 border-b border-neutral-500/20 px-3 py-2 text-xs">
            <div className="min-w-0 truncate">
              <span className="font-semibold">Syncs from {envName}</span>
              {details && <span className="text-neutral-500"> · {details}</span>}
            </div>
            <Link
              href={manageHref}
              className="flex shrink-0 items-center gap-1 text-2xs text-emerald-600 hover:underline dark:text-emerald-400"
            >
              Manage syncs <FaArrowRight className="text-[9px]" />
            </Link>
          </div>
          <ul className="max-h-80 divide-y divide-neutral-500/15 overflow-y-auto">
            {syncs.map((sync) => (
              <li
                key={sync.id}
                className={clsx('flex items-center gap-3 px-3 py-2', !sync.isActive && 'opacity-60')}
              >
                <span className="shrink-0 text-base">
                  <ProviderIcon providerId={sync.serviceInfo?.id ?? ''} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs leading-5">
                    <span className="shrink-0 font-medium">{sync.serviceInfo?.name}</span>
                    {!sync.isActive && (
                      <span className="shrink-0 rounded bg-neutral-500/20 px-1.5 text-3xs leading-4 text-neutral-500">
                        Paused
                      </span>
                    )}
                    <span aria-hidden className="shrink-0 text-neutral-500">
                      ·
                    </span>
                    {/* A long destination fades out at the edge rather than wrapping */}
                    <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)]">
                      <ServiceInfo sync={sync} />
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1 font-mono text-3xs leading-4 text-neutral-500"
                    title="This sync sends the secrets in this folder only"
                  >
                    <FaFolder className="shrink-0 text-[9px]" />
                    {syncFolderLabel(sync.path)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end leading-5">
                  {sync.status && <SyncStatusIndicator status={sync.status} showLabel />}
                  <span className="text-3xs leading-4 text-neutral-500">{lastRun(sync)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-neutral-500/20 bg-zinc-200/50 px-3 py-1.5 text-3xs text-neutral-500 dark:bg-zinc-900/40">
            Deploying to {envName} runs its active syncs; each sends only its own folder.
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  )
}
