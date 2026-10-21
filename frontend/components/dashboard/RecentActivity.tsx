'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { FaListUl, FaRobot, FaUserSlash } from 'react-icons/fa'
import {
  ApiAuditEventActorTypeChoices,
  AuditEventType,
  OrganisationMemberType,
  ServiceAccountType,
} from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { getResourceLink, parseJsonField } from '@/utils/auditLogs'
import { asPredicate, splitQuoted } from '@/utils/dashboard'
import { shortRelativeTimeFromDates } from '@/utils/time'
import { DashboardPanel, PanelLink, PanelSkeleton } from './DashboardPanel'

const ActivityItem = (props: {
  log: AuditEventType
  team: string
  members: Map<string, OrganisationMemberType>
  serviceAccounts: Map<string, ServiceAccountType>
}) => {
  const { log, team, members, serviceAccounts } = props
  const actorMeta = parseJsonField(log.actorMetadata)
  const isServiceAccount = log.actorType === ApiAuditEventActorTypeChoices.Sa
  const member = !isServiceAccount && !log.actorDeleted ? members.get(log.actorId) : undefined
  const account = isServiceAccount ? serviceAccounts.get(log.actorId) : undefined

  const actorName = log.actorDeleted
    ? 'Deleted account'
    : member
      ? member.fullName || member.email
      : account
        ? account.name
        : isServiceAccount
          ? actorMeta?.name || 'Service account'
          : actorMeta?.email || actorMeta?.username || 'Unknown user'

  const avatar = log.actorDeleted ? (
    <FaUserSlash className="text-neutral-500" />
  ) : member ? (
    <Avatar member={member} size="sm" showTitle={false} />
  ) : account ? (
    <Avatar serviceAccount={account} size="sm" />
  ) : isServiceAccount ? (
    <FaRobot className="text-neutral-500" />
  ) : (
    <Avatar
      user={{ name: actorMeta?.username, email: actorMeta?.email }}
      size="sm"
      showTitle={false}
    />
  )

  const href = getResourceLink(log, parseJsonField(log.resourceMetadata), team)
  const timestamp = new Date(log.timestamp)
  const description = splitQuoted(asPredicate(log.description || '')).map((part, i) =>
    part.quoted ? (
      <span
        key={i}
        className={clsx(
          'font-medium text-zinc-900 dark:text-zinc-100',
          // Keep short names like "web-app" whole; long ones may still wrap.
          part.text.length <= 24 && 'whitespace-nowrap'
        )}
      >
        {part.text}
      </span>
    ) : (
      <span key={i}>{part.text}</span>
    )
  )

  // One sentence per event: "Ava created app web · 4m ago".
  return (
    <li className="flex items-start gap-2.5 px-3 py-2 sm:px-4">
      {/* The avatar's own right margin would overflow this fixed slot */}
      <span className="flex size-5 shrink-0 items-center justify-center [&>div]:mr-0">
        {avatar}
      </span>
      <p className="min-w-0 flex-1 text-2xs leading-5 text-neutral-600 dark:text-neutral-400">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{actorName}</span>{' '}
        {href ? (
          <Link href={href} className="hover:text-emerald-600 dark:hover:text-emerald-400">
            {description}
          </Link>
        ) : (
          description
        )}
        <time
          dateTime={timestamp.toISOString()}
          title={timestamp.toLocaleString()}
          className="whitespace-nowrap text-neutral-500"
        >
          {/* No-break spaces keep the time on the same line as the last word */}
          {'\u00a0·\u00a0'}
          {shortRelativeTimeFromDates(timestamp)}
        </time>
      </p>
    </li>
  )
}

export const RecentActivity = (props: {
  team: string
  logs: AuditEventType[]
  loading: boolean
  members: Map<string, OrganisationMemberType>
  serviceAccounts: Map<string, ServiceAccountType>
  className?: string
}) => {
  const { team, logs, loading, members, serviceAccounts, className } = props

  return (
    <DashboardPanel
      className={className}
      title="Recent activity"
      description="Latest changes to apps, environments and access"
      footer={<PanelLink href={`/${team}/logs`}>Audit logs</PanelLink>}
    >
      {loading && !logs.length ? (
        <PanelSkeleton rows={8} />
      ) : logs.length ? (
        <ul className="divide-y divide-neutral-500/10 border-t border-neutral-500/20">
          {logs.map((log) => (
            <ActivityItem
              key={log.id}
              log={log}
              team={team}
              members={members}
              serviceAccounts={serviceAccounts}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          size="sm"
          icon={<FaListUl />}
          title="No recent activity"
          subtitle="No audit log events in the last 30 days."
        />
      )}
    </DashboardPanel>
  )
}
