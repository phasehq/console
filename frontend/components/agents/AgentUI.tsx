'use client'

import clsx from 'clsx'
import { ReactNode } from 'react'
import { FaBan, FaExclamationTriangle, FaRobot } from 'react-icons/fa'
import Spinner from '@/components/common/Spinner'
import { EmptyState } from '@/components/common/EmptyState'

export const humanizeAgentValue = (value?: string | null) => {
  if (!value) return 'Unknown'
  if (value.toLowerCase() === 'app_secret') return 'App secrets'
  return value
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export const formatAgentDate = (value?: string | null) => {
  if (!value) return 'Never'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Unknown' : date.toLocaleString()
}

export const isActiveSession = (session: { revokedAt?: string | null; expiresAt: string }) =>
  !session.revokedAt && new Date(session.expiresAt).valueOf() > Date.now()

export function AgentBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'red' | 'amber' | 'blue'
}) {
  const tones = {
    neutral: 'bg-neutral-500/10 text-neutral-600 dark:text-neutral-400',
    green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    red: 'bg-red-500/10 text-red-700 dark:text-red-400',
    amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    blue: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium whitespace-nowrap',
        tones[tone]
      )}
    >
      {children}
    </span>
  )
}

export function AgentPanel({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-neutral-500/20 bg-neutral-500/[0.025] overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-neutral-500/20">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {description && <p className="text-xs text-neutral-500 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function AgentLoading() {
  return (
    <div className="flex min-h-56 items-center justify-center" role="status" aria-label="Loading">
      <Spinner size="md" />
    </div>
  )
}

export function AgentError({ message, retry }: { message?: string; retry?: () => void }) {
  return (
    <EmptyState
      title="Unable to load AI Agents"
      subtitle={message || 'The Console could not load this data. Try again.'}
      graphic={<FaExclamationTriangle className="text-5xl text-amber-500/50" />}
    >
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="text-xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
        >
          Try again
        </button>
      ) : (
        <></>
      )}
    </EmptyState>
  )
}

export function AgentAccessDenied({ subtitle }: { subtitle: string }) {
  return (
    <EmptyState
      title="Access restricted"
      subtitle={subtitle}
      graphic={<FaBan className="text-6xl text-neutral-300 dark:text-neutral-700" />}
    >
      <></>
    </EmptyState>
  )
}

export function AgentSkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx('animate-pulse rounded-md bg-neutral-500/10', className)}
    />
  )
}

export function AgentSearchSkeleton() {
  return (
    <div className="flex w-full max-w-sm items-center gap-2 rounded-md bg-zinc-100 px-2 py-2.5 dark:bg-zinc-800">
      <AgentSkeletonBlock className="size-3.5 rounded-full" />
      <AgentSkeletonBlock className="h-3 w-48" />
    </div>
  )
}

export function AgentCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-neutral-500/20 bg-neutral-100 shadow-sm dark:bg-neutral-800',
        className
      )}
    >
      <div className="flex items-center gap-2.5 p-3">
        <AgentSkeletonBlock className="size-9 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <AgentSkeletonBlock className="h-3.5 w-2/5" />
          <AgentSkeletonBlock className="h-2.5 w-3/5" />
        </div>
      </div>
      <div className="space-y-1.5 border-t border-neutral-500/10 px-3 py-2.5">
        <AgentSkeletonBlock className="h-2.5 w-16" />
        <AgentSkeletonBlock className="h-8 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function AgentTableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="overflow-hidden rounded-xl border border-neutral-500/20"
    >
      <div className="border-b border-neutral-500/20 bg-neutral-500/5 px-4 py-3">
        <AgentSkeletonBlock className="h-3 w-40" />
      </div>
      <div className="divide-y divide-neutral-500/20">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-4 py-3">
            <AgentSkeletonBlock className="h-3.5 w-1/4" />
            <AgentSkeletonBlock className="h-3 w-1/5" />
            <AgentSkeletonBlock className="h-3 w-1/6" />
            <AgentSkeletonBlock className="ml-auto h-7 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AgentCardGridSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: cards }).map((_, index) => (
        <AgentCardSkeleton key={index} />
      ))}
    </div>
  )
}

export function AgentRequestsSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div role="status" aria-label="Loading" className="max-w-3xl space-y-3">
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-neutral-500/20">
          <div className="flex items-center gap-2.5 border-b border-neutral-500/20 bg-neutral-500/[0.025] px-4 py-3">
            <AgentSkeletonBlock className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <AgentSkeletonBlock className="h-3.5 w-1/3" />
              <AgentSkeletonBlock className="h-2.5 w-1/2" />
            </div>
            <AgentSkeletonBlock className="h-8 w-24 rounded-full" />
          </div>
          <div className="space-y-3 px-4 py-3">
            <AgentSkeletonBlock className="h-16 w-full rounded-lg" />
            <div className="grid gap-3 sm:grid-cols-2">
              <AgentSkeletonBlock className="h-8" />
              <AgentSkeletonBlock className="h-8" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function AgentMeshSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <AgentSearchSkeleton />
      <div className="overflow-hidden rounded-xl border border-neutral-500/10 bg-[radial-gradient(circle,rgba(113,113,122,0.18)_1px,transparent_1px)] p-6 [background-size:22px_22px]">
        <div className="flex items-start gap-14">
          {[3, 2, 2].map((cards, columnIndex) => (
            <div
              key={columnIndex}
              className={clsx('shrink-0 space-y-4', columnIndex === 0 ? 'w-[340px]' : 'w-[300px]')}
            >
              <div className="flex min-h-[38px] items-center justify-between gap-2">
                <AgentSkeletonBlock className="h-4 w-24" />
                <AgentSkeletonBlock className="h-9 w-32 rounded-full" />
              </div>
              {Array.from({ length: cards }).map((_, cardIndex) => (
                <AgentCardSkeleton key={cardIndex} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AgentDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-5">
      <div className="flex items-center gap-3">
        <AgentSkeletonBlock className="size-10 rounded-lg" />
        <div className="space-y-1.5">
          <AgentSkeletonBlock className="h-4 w-48" />
          <AgentSkeletonBlock className="h-3 w-32" />
        </div>
      </div>
      <AgentSkeletonBlock className="h-8 w-72" />
      <AgentSkeletonBlock className="h-40 w-full rounded-xl" />
      <AgentSkeletonBlock className="h-40 w-full rounded-xl" />
    </div>
  )
}

export function AgentEmpty({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: ReactNode
  children?: ReactNode
}) {
  return (
    <EmptyState
      title={title}
      subtitle={subtitle}
      graphic={<FaRobot className="text-6xl text-neutral-300 dark:text-neutral-700" />}
    >
      {children || <></>}
    </EmptyState>
  )
}

/**
 * Section header, rendered in every state so the page never jumps between
 * loading, restricted, empty and populated.
 *
 * `action` is the top-right primary action and belongs there only once there
 * is content to act on. While a section is empty the same action moves into
 * the centre of the empty state -- see `agentPrimaryAction`.
 */
export function AgentPageHeader({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <p className="text-sm text-neutral-500 mt-0.5 max-w-3xl">{description}</p>
      </div>
      {action}
    </div>
  )
}

/**
 * Place a section's primary action for the current state.
 *
 * Returns the node for whichever slot should own it, so a caller renders the
 * action once and cannot end up with a button in both the header and the
 * empty state.
 */
export function agentPrimaryAction(action: ReactNode, hasContent: boolean) {
  return {
    header: hasContent ? action : undefined,
    empty: hasContent ? undefined : action,
  }
}
