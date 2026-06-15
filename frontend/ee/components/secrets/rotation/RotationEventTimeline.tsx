import { RotatingSecretEventType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import { useMemo } from 'react'

const EVENT_TYPE_STYLES: Record<string, { color: string; label: string }> = {
  config_created: { color: 'text-emerald-500', label: 'Created' },
  config_updated: { color: 'text-blue-500', label: 'Updated' },
  rotated: { color: 'text-emerald-500', label: 'Rotated' },
  mint_attempted: { color: 'text-neutral-500', label: 'Mint attempted' },
  mint_failed: { color: 'text-red-500', label: 'Mint failed' },
  revoke_attempted: { color: 'text-neutral-500', label: 'Revoke attempted' },
  revoked: { color: 'text-zinc-500', label: 'Revoked' },
  revoke_failed: { color: 'text-red-500', label: 'Revoke failed' },
  orphaned_credential: { color: 'text-red-600', label: 'Orphaned credential' },
  paused: { color: 'text-amber-500', label: 'Paused' },
  resumed: { color: 'text-emerald-500', label: 'Resumed' },
  manual_rotate: { color: 'text-emerald-500', label: 'Manual rotate' },
  health_degraded: { color: 'text-amber-500', label: 'Health degraded' },
  health_failed: { color: 'text-red-500', label: 'Health failed' },
  health_recovered: { color: 'text-emerald-500', label: 'Health recovered' },
}

const MINT_ROOTS = new Set(['rotated', 'manual_rotate', 'mint_failed'])
const REVOKE_ROOTS = new Set(['revoked', 'revoke_failed'])

type Grouped = { parent: RotatingSecretEventType; children: RotatingSecretEventType[] }

// Events arrive newest-first; attempts nest under the next root of the same family.
function groupEvents(events: RotatingSecretEventType[]): Grouped[] {
  const out: Grouped[] = []
  let lastMintParent: Grouped | null = null
  let lastRevokeParent: Grouped | null = null

  for (const ev of events) {
    const t = ev.eventType?.toLowerCase() ?? ''
    if (t === 'mint_attempted') {
      if (lastMintParent) {
        lastMintParent.children.push(ev)
      } else {
        out.push({ parent: ev, children: [] })
      }
      continue
    }
    if (t === 'revoke_attempted') {
      if (lastRevokeParent) {
        lastRevokeParent.children.push(ev)
      } else {
        out.push({ parent: ev, children: [] })
      }
      continue
    }
    const g: Grouped = { parent: ev, children: [] }
    out.push(g)
    if (MINT_ROOTS.has(t)) lastMintParent = g
    else if (REVOKE_ROOTS.has(t)) lastRevokeParent = g
  }
  return out
}

const EventBody = ({
  event,
  compact = false,
}: {
  event: RotatingSecretEventType
  compact?: boolean
}) => {
  const style = EVENT_TYPE_STYLES[event.eventType?.toLowerCase()] ?? {
    color: 'text-neutral-500',
    label: event.eventType,
  }
  const metadata = (event.metadata as Record<string, unknown> | null) ?? null
  const labelSizeCls = compact ? 'text-2xs' : 'text-xs'

  return (
    <div className="flex-1">
      <div className="flex items-center justify-between gap-3">
        <span className={clsx(labelSizeCls, 'font-medium', style.color)}>{style.label}</span>
        <span className="text-2xs text-neutral-500">
          {relativeTimeFromDates(new Date(event.createdAt))}
        </span>
      </div>
      {(event.organisationMember || event.serviceAccount) && (
        <div className="text-2xs text-neutral-500 flex items-center gap-1 mt-1">
          <span>by</span>
          <Avatar
            member={event.organisationMember || undefined}
            serviceAccount={event.serviceAccount || undefined}
            size="sm"
          />
          <span>
            {event.organisationMember?.fullName ||
              event.organisationMember?.email ||
              event.serviceAccount?.name}
          </span>
        </div>
      )}
      {typeof metadata?.user_message === 'string' && (
        <div className="text-2xs text-neutral-500 mt-1">{metadata.user_message}</div>
      )}
      {metadata && Object.keys(metadata).length > 0 && (
        <details className="mt-1">
          <summary className="text-2xs text-neutral-500 cursor-pointer">details</summary>
          <pre className="text-2xs text-neutral-500 mt-1 whitespace-pre-wrap break-all bg-zinc-100 dark:bg-zinc-800 p-2 rounded">
            {JSON.stringify(metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

export const RotationEventTimeline = ({
  events,
}: {
  events: RotatingSecretEventType[]
}) => {
  const grouped = useMemo(() => groupEvents(events ?? []), [events])

  if (!grouped.length) {
    return <div className="text-sm text-neutral-500 py-4">No events yet.</div>
  }

  return (
    <ol className="divide-y divide-neutral-500/20">
      {grouped.map(({ parent, children }) => {
        const parentStyle = EVENT_TYPE_STYLES[parent.eventType?.toLowerCase()] ?? {
          color: 'text-neutral-500',
          label: parent.eventType,
        }
        return (
          <li key={parent.id} className="py-2">
            <div className="flex items-start gap-3">
              <div
                className={clsx('w-2 h-2 mt-1.5 rounded-full', parentStyle.color, 'bg-current')}
              />
              <EventBody event={parent} />
            </div>
            {children.length > 0 && (
              <ol className="ml-5 mt-1 border-l border-neutral-500/20 pl-3 space-y-1">
                {children.map((child) => (
                  <li key={child.id} className="flex items-start gap-2">
                    <div className="w-1 h-1 mt-2 rounded-full bg-neutral-500/50" />
                    <EventBody event={child} compact />
                  </li>
                ))}
              </ol>
            )}
          </li>
        )
      })}
    </ol>
  )
}
