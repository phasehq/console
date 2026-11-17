'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import { Alert } from '@/components/common/Alert'
import { AgentBadge, AgentTime } from '@/components/agents/AgentUI'
import { describeDuration } from '@/utils/agents/accessDuration'
import { describeTarget, policySummary } from '@/utils/agents/accessPolicy'
import { diffLines, diffStats } from '@/utils/agents/textDiff'
import { ACCESS_LEVEL_LABEL, describeClasses } from '@/utils/agents/appAccess'
import type {
  AccessRecord,
  AllowReview,
  AllowTarget,
  AppAccessReview,
  ContextReview,
  RenewReview,
} from '@/utils/agents/requestActions'

/**
 * What an Agent wrote is shown here as text: every value below is a React
 * text node, never markup.
 */

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-neutral-500">{label}</dt>
    <dd className="mt-1 break-all">{children}</dd>
  </div>
)

/** The call an Agent was refused, as the Agent described it. */
export function BlockedCallDetails({ call }: { call: NonNullable<AllowReview['blockedCall']> }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
      <Field label="Method and host">
        <code>
          {call.method || 'Unknown'} {call.host}
        </code>
      </Field>
      <Field label="Path">
        <code>{call.path || '/'}</code>
      </Field>
      {call.operation && (
        <Field label="AWS action">
          <code>{call.operation}</code>
        </Field>
      )}
      {call.class && (
        <Field label="Kind of call">
          <code>{call.class}</code>
        </Field>
      )}
    </dl>
  )
}

/** The rule an allow request would add, with what it does and does not do. */
export function AllowDetails({
  review,
  target,
}: {
  review: AllowReview
  /** The reviewer's narrowed rule, when it differs from the requested one. */
  target?: AllowTarget
}) {
  const shown = target ?? review.allow
  const summary = review.policy ? policySummary(review.policy) : ''
  if (review.app)
    return (
      <div className="space-y-3">
        <p className="text-xs">
          Asks for{' '}
          <strong>
            {review.appClasses.length ? describeClasses(review.appClasses) : 'Access to'} secrets
          </strong>{' '}
          on <strong>{review.connectionName || 'this Connection'}</strong>, which its access rules
          answer with Ask.
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <Field label="App">{review.app.name}</Field>
          <Field label="Environments">
            {review.environments.map((environment) => environment.name).join(', ') || 'None'}
          </Field>
        </dl>
        <p className="text-xs text-neutral-500">
          This is temporary
          {review.durationSeconds ? `: asked for ${describeDuration(review.durationSeconds)}` : ''}.
          It ends on its own and never changes a Block rule.
        </p>
      </div>
    )
  return (
    <div className="space-y-3">
      <p className="text-xs">
        {shown.operation
          ? 'Asks to let one AWS action through on'
          : 'Asks to let one kind of call through on'}{' '}
        <strong>{review.connectionName || 'this Connection'}</strong>, which the access rules
        refused with Ask.
      </p>
      {review.blockedCall && (
        <section aria-label="Blocked call" className="space-y-1.5">
          <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
            The call that was refused
          </h4>
          <BlockedCallDetails call={review.blockedCall} />
        </section>
      )}
      <section aria-label="Rule that would be added" className="space-y-1.5">
        <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
          Rule that would be added
        </h4>
        <p className="text-xs">
          Allow <code className="break-all">{describeTarget(shown) || 'nothing'}</code>
        </p>
      </section>
      <p className="text-xs text-neutral-500">
        This is temporary
        {review.durationSeconds ? `: asked for ${describeDuration(review.durationSeconds)}` : ''}.
        The allow ends on its own and never changes a Block rule or the secret guard.
        {summary && ` The Connection's rules now: ${summary}.`}
        {review.temporaryAllows.length > 0 &&
          ` ${review.temporaryAllows.length} temporary ${review.temporaryAllows.length === 1 ? 'allow is' : 'allows are'} in force.`}
      </p>
    </div>
  )
}

const RENEW_STATE: Record<
  RenewReview['state'],
  { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }
> = {
  active: { label: 'Active', tone: 'green' },
  expired: { label: 'Expired', tone: 'amber' },
  revoked: { label: 'Revoked', tone: 'red' },
  none: { label: 'No grant', tone: 'neutral' },
}

/** A renewal: the Connection, where its access stands, and for how long it is asked. */
export function RenewDetails({ review }: { review: RenewReview }) {
  const state = RENEW_STATE[review.state]
  return (
    <div className="space-y-3">
      <p className="text-xs">
        Asks to renew this Workflow&apos;s access to{' '}
        <strong>{review.connectionName || 'a Connection'}</strong>.
      </p>
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <Field label="Connection">{review.connectionName || 'Unknown'}</Field>
        <Field label="Access now">
          <span className="inline-flex items-center gap-2">
            <AgentBadge tone={state.tone}>{state.label}</AgentBadge>
            {review.expiresAt && (
              <span className="text-neutral-500">
                {review.state === 'active' ? 'ends' : 'ended'}{' '}
                <AgentTime value={review.expiresAt} />
              </span>
            )}
          </span>
        </Field>
        <Field label="Requested for">
          {review.durationSeconds ? describeDuration(review.durationSeconds) : 'Not stated'}
        </Field>
      </dl>
    </div>
  )
}

/** Access to an app's secrets, as the Agent asked for it. */
export function AppAccessDetails({ review }: { review: AppAccessReview }) {
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <Field label="App">{review.app?.name || 'Unknown app'}</Field>
        <Field label="Environments">
          {review.environments.map((environment) => environment.name).join(', ') || 'None'}
        </Field>
        <Field label="Access">{ACCESS_LEVEL_LABEL[review.access]}</Field>
      </dl>
      <p className="text-xs text-neutral-500">
        {review.durationSeconds
          ? `Asks for access for ${describeDuration(review.durationSeconds)}. `
          : ''}
        {review.reuses
          ? `Approving reuses the Connection ${review.reuses.name}, whose access rules apply.`
          : 'Approving creates a Connection for these environments: reads allowed, writes ask.'}
      </p>
    </div>
  )
}

/** A line-based diff of two texts, one text node per line. */
export function TextDiff({ before, after }: { before: string; after: string }) {
  const diff = useMemo(() => diffLines(before, after), [before, after])
  const { added, removed } = diffStats(diff)
  if (added === 0 && removed === 0)
    return <p className="text-xs text-neutral-500">The text is the same as the current one.</p>
  return (
    <div>
      <p className="mb-1 text-2xs text-neutral-500">
        {added} added, {removed} removed
      </p>
      <pre
        aria-label="Changes to the context"
        className="max-h-72 overflow-auto rounded-lg border border-neutral-500/20 bg-neutral-500/5 py-1 font-mono text-xs"
      >
        {diff.map((line, index) => (
          <div
            key={index}
            className={clsx(
              'flex gap-2 whitespace-pre-wrap break-words px-2',
              line.type === 'add' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
              line.type === 'remove' && 'bg-red-500/10 text-red-800 dark:text-red-300'
            )}
          >
            <span aria-hidden="true" className="w-3 shrink-0 select-none">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
            </span>
            <span className="sr-only">
              {line.type === 'add' ? 'Added: ' : line.type === 'remove' ? 'Removed: ' : ''}
            </span>
            <span className="min-w-0">{line.text || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

/** A context change: the warning, then current against requested as plain text. */
export function ContextDetails({
  review,
  requested,
}: {
  review: ContextReview
  /** The reviewer's edited text, when it differs from the requested one. */
  requested?: string
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs">Asks to replace the saved context of this Workflow.</p>
      <Alert variant="warning" icon size="sm">
        <span className="text-xs">
          This is text an Agent wrote. Once approved it is saved to the Workflow and the Agent reads
          it as its own notes. Read every line, and edit what you do not want kept.
        </span>
      </Alert>
      <TextDiff before={review.current} after={requested ?? review.requested} />
    </div>
  )
}

/** What was asked and what was granted, for a request that ends in access. */
export function AccessRecordLine({ record }: { record: AccessRecord }) {
  const asked = record.requestedSeconds
    ? describeDuration(record.requestedSeconds)
    : 'no duration stated'
  return (
    <p className="text-xs text-neutral-500">
      Asked for {asked}.{' '}
      {record.grantedSeconds ? (
        <>
          Granted {describeDuration(record.grantedSeconds)}
          {record.expiresAt && (
            <>
              , until{' '}
              <time dateTime={record.expiresAt} title={new Date(record.expiresAt).toLocaleString()}>
                {new Date(record.expiresAt).toLocaleString()}
              </time>
            </>
          )}
          .
        </>
      ) : (
        'Granted until revoked.'
      )}
    </p>
  )
}
