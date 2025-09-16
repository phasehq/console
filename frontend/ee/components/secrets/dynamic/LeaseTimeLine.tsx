import {
  DynamicSecretLeaseEventType,
  DynamicSecretLeaseType,
  OrganisationMemberType,
  ServiceAccountType,
} from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { LogoWordMark } from '@/components/common/LogoWordMark'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import React from 'react'

type LeaseTimelineProps = {
  lease: DynamicSecretLeaseType
  className?: string
}

const toTitleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s)

const getEventTypeColor = (eventType?: string) => {
  switch ((eventType || '').toUpperCase()) {
    case 'CREATED':
      return 'bg-blue-500'
    case 'RENEWED':
      return 'bg-emerald-500'
    case 'REVOKED':
      return 'bg-red-500'
    default:
      return 'bg-neutral-400'
  }
}

const getDisplayEventText = (
  eventType?: string,
  metadata?: unknown,
  normalize?: (m: unknown) => Record<string, unknown>
) => {
  const base = (eventType || '').toUpperCase()
  const meta = normalize ? normalize(metadata) : {}
  const source = String((meta as any)?.source || '').toLowerCase()

  // If revoked by scheduler, show "Expired"
  if (base === 'REVOKED' && source === 'scheduled') return 'Expired'

  switch (base) {
    case 'CREATED':
      return 'Created'
    case 'RENEWED':
      return 'Renewed'
    case 'REVOKED':
      return 'Revoked'
    default:
      return toTitleCase(eventType || 'Event')
  }
}

const EventActor = ({
  member,
  serviceAccount,
}: {
  member?: OrganisationMemberType | null
  serviceAccount?: ServiceAccountType | null
}) => {
  if (member) {
    return (
      <div className="flex items-center gap-1 text-sm">
        <Avatar member={member} size="sm" />
        <span className="font-medium">
          {member.self ? 'You' : member.fullName || member.email || 'Member'}
        </span>
      </div>
    )
  }
  if (serviceAccount) {
    return (
      <div className="flex items-center gap-1 text-sm">
        <Avatar serviceAccount={serviceAccount} size="sm" />
        <span className="font-medium">{serviceAccount.name}</span>
      </div>
    )
  }
  return (
    <div className="text-sm text-neutral-500">
      <LogoWordMark className="h-6 fill-zinc-900 dark:fill-zinc-100" />
    </div>
  )
}

const MetaRow = ({ k, v }: { k: string; v: unknown }) => {
  const value =
    typeof v === 'string'
      ? v
      : v == null
        ? ''
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v)
  return (
    <div className="flex items-start gap-2 text-2xs text-neutral-600 dark:text-neutral-400">
      <span className="uppercase tracking-wide text-neutral-500">{k}</span>
      <span className="font-mono whitespace-pre-wrap break-words">{value}</span>
    </div>
  )
}

export const LeaseEventTimeline: React.FC<LeaseTimelineProps> = ({ lease, className }) => {
  const events: DynamicSecretLeaseEventType[] =
    (lease.events as DynamicSecretLeaseEventType[]) || []

  const normalizeMetadata = (meta: unknown): Record<string, unknown> => {
    if (!meta) return {}
    if (typeof meta === 'string') {
      try {
        const parsed = JSON.parse(meta)
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
        return { value: parsed }
      } catch {
        return { raw: meta }
      }
    }
    if (typeof meta === 'object') {
      return meta as Record<string, unknown>
    }
    return { value: meta }
  }

  // Derive active status and expiry
  const now = new Date()
  const revoked =
    (lease as any).revokedAt || (lease.status && lease.status.toUpperCase() === 'REVOKED')
  const expired =
    (lease.status && lease.status.toUpperCase() === 'EXPIRED') ||
    (lease.expiresAt ? new Date(lease.expiresAt) <= now : false)
  const isActive = !revoked && !expired
  const expiresAtDate = lease.expiresAt ? new Date(lease.expiresAt) : null

  return (
    <div className={clsx('w-full', className)}>
      <div className="px-2">
        <div className="space-y-4 pb-4 border-l border-zinc-300 dark:border-zinc-700">
          {events?.length ? (
            <>
              {events.map((evt) => {
                const ts = evt.createdAt ? new Date(evt.createdAt) : null
                const chip = getEventTypeColor(evt.eventType as unknown as string)
                return (
                  <div
                    key={evt.id || `${evt.eventType}-${evt.createdAt}`}
                    className="pb-6 space-y-2"
                  >
                    <div className="flex flex-row items-center gap-2 -ml-1">
                      <span className={clsx('h-2 w-2 rounded-full', chip)} />
                      <div className="text-zinc-800 dark:text-zinc-200 font-semibold">
                        {getDisplayEventText(
                          evt.eventType as unknown as string,
                          evt.metadata as unknown,
                          normalizeMetadata
                        )}
                      </div>
                      {ts && (
                        <div className="text-neutral-500 text-sm" title={ts.toLocaleString()}>
                          {relativeTimeFromDates(ts)}
                        </div>
                      )}
                      <span className="text-neutral-500 text-sm">by</span>
                      <div className="text-zinc-900 dark:text-zinc-100">
                        <EventActor
                          member={evt.organisationMember as any}
                          serviceAccount={evt.serviceAccount as any}
                        />
                      </div>
                    </div>

                    {/* Metadata and request info */}
                    <div className="pl-3 space-y-1 ">
                      {(evt.ipAddress || evt.userAgent) && (
                        <div className="space-y-1">
                          {evt.ipAddress && <MetaRow k="IP" v={evt.ipAddress} />}
                          {evt.userAgent && <MetaRow k="UA" v={evt.userAgent} />}
                        </div>
                      )}

                      {(() => {
                        const meta = normalizeMetadata(evt.metadata as unknown)
                        return Object.entries(meta).map(([k, v]) => <MetaRow key={k} k={k} v={v} />)
                      })()}
                    </div>
                  </div>
                )
              })}

              {isActive && expiresAtDate && (
                <>
                  {/* Expires event */}
                  <div className="pb-6 space-y-2">
                    <div className="flex flex-row items-center gap-2 -ml-1">
                      <span className="h-2 w-2 rounded-full bg-neutral-400" />
                      <div className="text-zinc-500 font-semibold">Expires</div>
                      <div
                        className="text-neutral-500 text-sm"
                        title={expiresAtDate.toLocaleString()}
                      >
                        {relativeTimeFromDates(expiresAtDate)}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-sm text-neutral-500 pl-3">No events yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
