'use client'

import { GetAuditLogs } from '@/graphql/queries/organisation/getAuditLogs.gql'
import { GetOrganisationMembers } from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { NetworkStatus, useQuery } from '@apollo/client'
import { ApiAuditEventActorTypeChoices, AuditEventType, OrganisationMemberType, ServiceAccountType } from '@/apollo/graphql'
import { Disclosure, Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaChevronRight,
  FaChevronDown,
  FaCircle,
  FaCheckCircle,
  FaBan,
  FaUser,
  FaRobot,
  FaArrowRight,
} from 'react-icons/fa'
import { FiRefreshCw, FiChevronsDown } from 'react-icons/fi'
import { FaArrowRotateLeft, FaFilter } from 'react-icons/fa6'
import { relativeTimeFromDates } from '@/utils/time'
import { Fragment, useContext, useState, useEffect } from 'react'
import { Button } from '@/components/common/Button'
import { Count } from 'reaviz'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '../common/EmptyState'
import { Combobox, RadioGroup } from '@headlessui/react'
import { Avatar } from '../common/Avatar'
import Link from 'next/link'

const LOGS_START_DATE = 1682904457000
const DAY = 24 * 60 * 60 * 1000
const getCurrentTimeStamp = () => Date.now()
const DEFAULT_PAGE_SIZE = 50
const COUNT_ACCURACY_THRESHOLD = 10000

type ResourceTab = {
  key: string
  label: string
  resourceType: string | null
}

const RESOURCE_TABS: ResourceTab[] = [
  { key: 'all', label: 'All', resourceType: null },
  { key: 'app', label: 'Apps', resourceType: 'app' },
  { key: 'env', label: 'Environments', resourceType: 'env' },
  { key: 'role', label: 'Roles', resourceType: 'role' },
  { key: 'sa', label: 'Service Accounts', resourceType: 'sa' },
  { key: 'member', label: 'Members', resourceType: 'member' },
  { key: 'invite', label: 'Invites', resourceType: 'invite' },
  { key: 'policy', label: 'Network Policies', resourceType: 'policy' },
  { key: 'tokens', label: 'Tokens', resourceType: null },
]

const TOKEN_RESOURCE_TYPES = ['pat', 'sa_token', 'svc_token']

const getEventTypeColor = (eventType: string) => {
  if (eventType === 'C') return 'bg-emerald-500'
  if (eventType === 'U') return 'bg-yellow-500'
  if (eventType === 'R') return 'bg-blue-500'
  if (eventType === 'D') return 'bg-red-500'
  if (eventType === 'A') return 'bg-purple-500'
  return 'bg-neutral-500'
}

const getEventTypeText = (eventType: string) => {
  if (eventType === 'C') return 'Create'
  if (eventType === 'U') return 'Update'
  if (eventType === 'R') return 'Read'
  if (eventType === 'D') return 'Delete'
  if (eventType === 'A') return 'Access'
  return eventType
}

const getResourceTypeLabel = (resourceType: string) => {
  const labels: Record<string, string> = {
    app: 'App',
    env: 'Environment',
    role: 'Role',
    sa: 'Service Account',
    member: 'Member',
    policy: 'Network Policy',
    pat: 'Personal Access Token',
    sa_token: 'SA Token',
    svc_token: 'Service Token',
    invite: 'Invite',
  }
  return labels[resourceType] || resourceType
}

const parseJsonField = (val: any): Record<string, any> | null => {
  if (!val) return null
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch {
    return null
  }
}

/** Build a link to the resource if possible */
const getResourceLink = (
  log: AuditEventType,
  resourceMeta: Record<string, any> | null,
  team: string
): string | null => {
  // Don't link to deleted resources
  if (log.eventType === 'D') return null

  const rt = log.resourceType
  const id = log.resourceId

  if (rt === 'app') return `/${team}/apps/${id}`
  if (rt === 'env' && resourceMeta?.app_id) return `/${team}/apps/${resourceMeta.app_id}/environments/${id}`
  if (rt === 'role') return `/${team}/access/roles`
  if (rt === 'sa') return `/${team}/access/service-accounts/${id}`
  if (rt === 'member') return `/${team}/access/members`
  if (rt === 'policy') return `/${team}/access/network`
  if (rt === 'pat') return `/${team}/access/authentication`
  if (rt === 'sa_token' && resourceMeta?.service_account_id)
    return `/${team}/access/service-accounts/${resourceMeta.service_account_id}`
  if (rt === 'svc_token' && resourceMeta?.app_id) return `/${team}/apps/${resourceMeta.app_id}`

  return null
}


const LogRow = ({
  log,
  members,
  serviceAccounts,
  team,
}: {
  log: AuditEventType
  members: OrganisationMemberType[]
  serviceAccounts: ServiceAccountType[]
  team: string
}) => {
  const actorMeta = parseJsonField(log.actorMetadata)
  const resourceMeta = parseJsonField(log.resourceMetadata)
  const oldValues = parseJsonField(log.oldValues)
  const newValues = parseJsonField(log.newValues)

  // Resolve actor display
  const member = members.find(
    (m) =>
      m.id === log.actorId ||
      m.email === actorMeta?.email ||
      (actorMeta?.username && m.fullName === actorMeta?.username)
  )
  const isSaActor = log.actorType === ApiAuditEventActorTypeChoices.Sa
  const sa = isSaActor
    ? serviceAccounts.find((s) => s.id === log.actorId)
    : null

  const actorDisplayName = member
    ? member.fullName || member.email || 'User'
    : sa
      ? sa.name
      : isSaActor
        ? actorMeta?.name || 'Service Account'
        : actorMeta?.email || actorMeta?.username || 'User'

  const ActorAvatar = ({ size = 'sm' }: { size?: 'sm' | 'md' }) =>
    member ? (
      <Avatar member={member} size={size} />
    ) : sa ? (
      <Avatar serviceAccount={sa} size={size} />
    ) : isSaActor ? (
      <FaRobot className="text-neutral-500" />
    ) : (
      <FaUser className="text-neutral-500" />
    )

  const relativeTimeStamp = relativeTimeFromDates(new Date(log.timestamp))
  const verboseTimeStamp = new Date(log.timestamp).toISOString()

  const resourceLink = getResourceLink(log, resourceMeta, team)

  const LogField = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-neutral-500 font-medium">{label}: </span>
      <span className="font-medium font-mono">{children}</span>
    </div>
  )

  /** Resolve a UUID to a member or service account display chip */
  const resolveAccountId = (id: string) => {
    const m = members.find((m) => m.id === id)
    if (m)
      return (
        <span className="inline-flex items-center gap-1">
          <Avatar member={m} size="sm" />
          <span>{m.fullName || m.email}</span>
        </span>
      )
    const s = serviceAccounts.find((s) => s.id === id)
    if (s)
      return (
        <span className="inline-flex items-center gap-1">
          <Avatar serviceAccount={s} size="sm" />
          <span>{s.name}</span>
        </span>
      )
    return <span className="font-mono">{id}</span>
  }

  /** Check if an array contains string account IDs */
  const isAccountIdList = (key: string, val: any): boolean => {
    if (!Array.isArray(val) || val.length === 0) return false
    // Must be an array of strings (not objects)
    if (!val.every((v: any) => typeof v === 'string')) return false
    const accountKeys = ['members_added', 'members_removed', 'apps_granted', 'apps_revoked']
    if (accountKeys.includes(key)) return true
    // Heuristic: array of UUID-like strings
    return val.every((v: any) => v.length >= 32 && v.includes('-'))
  }

  /** Check if an array contains member detail objects (from bulk add) */
  const isMemberDetailList = (val: any): boolean => {
    if (!Array.isArray(val) || val.length === 0) return false
    return val.every((v: any) => typeof v === 'object' && v !== null && 'id' in v && 'name' in v)
  }

  const AccountList = ({
    ids,
    variant,
  }: {
    ids: string[]
    variant: 'added' | 'removed'
  }) => (
    <div
      className={clsx(
        'flex flex-wrap gap-1.5 rounded px-2 py-1 mt-0.5',
        variant === 'removed' ? 'bg-red-500/10' : 'bg-emerald-500/10'
      )}
    >
      {ids.map((id) => (
        <span
          key={id}
          className={clsx(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
            variant === 'removed'
              ? 'text-red-400 line-through'
              : 'text-emerald-400'
          )}
        >
          {variant === 'removed' ? '- ' : '+ '}
          {resolveAccountId(id)}
        </span>
      ))}
    </div>
  )

  /** Render member detail objects (from bulk add with env scope) */
  const MemberDetailList = ({
    items,
    variant,
  }: {
    items: Array<{ id: string; name: string; type?: string; env_scope?: string[] }>
    variant: 'added' | 'removed'
  }) => (
    <div className="space-y-1 mt-0.5">
      {items.map((item) => (
        <div
          key={item.id}
          className={clsx(
            'flex items-center gap-2 rounded px-2 py-1 text-xs',
            variant === 'removed' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
          )}
        >
          <span className={clsx('inline-flex items-center gap-1', variant === 'removed' && 'line-through')}>
            {variant === 'removed' ? '- ' : '+ '}
            {resolveAccountId(item.id)}
          </span>
          {item.env_scope && item.env_scope.length > 0 && (
            <span className="text-neutral-500 font-normal">
              ({item.env_scope.join(', ')})
            </span>
          )}
        </div>
      ))}
    </div>
  )

  const ChangeDiff = ({
    oldVals,
    newVals,
  }: {
    oldVals: Record<string, any> | null
    newVals: Record<string, any> | null
  }) => {
    // Collect only keys where values actually differ
    const allKeys = new Set([
      ...Object.keys(oldVals || {}),
      ...Object.keys(newVals || {}),
    ])

    const changedKeys = Array.from(allKeys).filter((key) => {
      const oldVal = oldVals?.[key]
      const newVal = newVals?.[key]
      return JSON.stringify(oldVal) !== JSON.stringify(newVal)
    })

    if (changedKeys.length === 0) return null

    return (
      <div className="space-y-1">
        {changedKeys.map((key) => {
          const oldVal = oldVals?.[key]
          const newVal = newVals?.[key]

          // Render member detail objects (from bulk add/remove with env scope)
          if (isMemberDetailList(oldVal) || isMemberDetailList(newVal)) {
            return (
              <div key={key} className="text-xs">
                <span className="text-neutral-500 font-medium">{key}</span>
                {oldVal !== undefined && Array.isArray(oldVal) && (
                  <MemberDetailList items={oldVal} variant="removed" />
                )}
                {newVal !== undefined && Array.isArray(newVal) && (
                  <MemberDetailList items={newVal} variant="added" />
                )}
              </div>
            )
          }

          // Render account ID lists with avatars
          if (isAccountIdList(key, oldVal) || isAccountIdList(key, newVal)) {
            return (
              <div key={key} className="text-xs">
                <span className="text-neutral-500 font-medium">{key}</span>
                {oldVal !== undefined && Array.isArray(oldVal) && (
                  <AccountList ids={oldVal} variant="removed" />
                )}
                {newVal !== undefined && Array.isArray(newVal) && (
                  <AccountList ids={newVal} variant="added" />
                )}
              </div>
            )
          }

          const isObj = typeof oldVal === 'object' || typeof newVal === 'object'

          if (isObj) {
            return (
              <div key={key} className="text-xs">
                <span className="text-neutral-500 font-medium">{key}</span>
                {oldVal !== undefined && (
                  <pre className="text-red-400 bg-red-500/10 rounded px-2 py-1 mt-0.5 text-xs overflow-auto max-h-32">
                    - {JSON.stringify(oldVal, null, 2)}
                  </pre>
                )}
                {newVal !== undefined && (
                  <pre className="text-emerald-400 bg-emerald-500/10 rounded px-2 py-1 mt-0.5 text-xs overflow-auto max-h-32">
                    + {JSON.stringify(newVal, null, 2)}
                  </pre>
                )}
              </div>
            )
          }

          return (
            <div key={key} className="text-xs flex items-center gap-2 flex-wrap">
              <span className="text-neutral-500 font-medium">{key}:</span>
              {oldVal !== undefined && (
                <span className="text-red-400 bg-red-500/10 rounded px-1.5 py-0.5 line-through">
                  {String(oldVal)}
                </span>
              )}
              {oldVal !== undefined && newVal !== undefined && (
                <span className="text-neutral-500">&rarr;</span>
              )}
              {newVal !== undefined && (
                <span className="text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.5">
                  {String(newVal)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const hasChanges =
    (oldValues || newValues) &&
    Array.from(
      new Set([...Object.keys(oldValues || {}), ...Object.keys(newValues || {})])
    ).some((key) => JSON.stringify(oldValues?.[key]) !== JSON.stringify(newValues?.[key]))

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <Disclosure.Button
            as="tr"
            className={clsx(
              'py-4 border-neutral-500/20 transition duration-300 ease-in-out cursor-pointer',
              open
                ? 'bg-neutral-100 dark:bg-neutral-800 border-r'
                : 'border-b hover:bg-neutral-100 dark:hover:bg-neutral-800'
            )}
          >
            <td
              className={clsx(
                'px-6 py-2 border-l',
                open ? 'border-l-emerald-500' : 'border-l-transparent'
              )}
            >
              <FaChevronRight
                className={clsx(
                  'transform transition-all duration-300 text-xs',
                  open && 'rotate-90 text-emerald-500'
                )}
              />
            </td>
            <td className="whitespace-nowrap px-6 py-2">
              <div className="text-xs flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-medium">
                <ActorAvatar />
                {actorDisplayName}
              </div>
            </td>
            <td className="whitespace-nowrap px-6 py-2">
              <div className="flex flex-row items-center gap-2 -ml-1">
                <span
                  className={clsx('h-1.5 w-1.5 rounded-full', getEventTypeColor(log.eventType))}
                />
                <div className="text-zinc-800 dark:text-zinc-200 text-xs font-medium">
                  {getEventTypeText(log.eventType)}
                </div>
              </div>
            </td>
            <td className="whitespace-nowrap px-6 py-2">
              <span className="text-2xs font-medium bg-neutral-200 dark:bg-neutral-700 rounded px-2 py-0.5">
                {getResourceTypeLabel(log.resourceType)}
              </span>
            </td>
            <td className="px-6 py-2 max-w-md truncate text-xs">{log.description}</td>
            <td className="whitespace-nowrap px-6 py-2 text-xs font-medium capitalize">
              {relativeTimeStamp}
            </td>
          </Disclosure.Button>
          <Transition
            as="tr"
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <td colSpan={6}>
              <Disclosure.Panel
                className={clsx(
                  'p-4 w-full space-y-4 bg-neutral-100 dark:bg-neutral-800 border-neutral-500/20 border-l -ml-px',
                  open
                    ? 'border-b border-l-emerald-500 border-r shadow-xl'
                    : 'border-l-transparent'
                )}
              >
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <LogField label="Actor">
                        <div className="flex items-center gap-1">
                          <ActorAvatar />
                          {actorDisplayName}
                        </div>
                      </LogField>

                      <LogField label="Resource">
                        <div className="flex items-center gap-1">
                          {getResourceTypeLabel(log.resourceType)}
                          {resourceMeta?.name && ` (${resourceMeta.name})`}
                          {resourceLink && (
                            <Link href={resourceLink} onClick={(e) => e.stopPropagation()}>
                              <Button variant="outline" classString="text-2xs px-1.5 py-0.5 ml-1">
                                <FaArrowRight />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </LogField>

                      <LogField label="Resource ID">
                        <span className="text-xs">{log.resourceId}</span>
                      </LogField>

                      {resourceMeta?.app_name && (
                        <LogField label="App">
                          <div className="flex items-center gap-1">
                            {resourceMeta.app_name}
                            {resourceMeta?.app_id && (
                              <Link
                                href={`/${team}/apps/${resourceMeta.app_id}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button variant="outline" classString="text-2xs px-1.5 py-0.5 ml-1">
                                  <FaArrowRight />
                                </Button>
                              </Link>
                            )}
                          </div>
                        </LogField>
                      )}

                      <LogField label="IP Address">{log.ipAddress || 'N/A'}</LogField>

                      <LogField label="User Agent">
                        <span
                          className="text-xs truncate max-w-xs inline-block align-bottom"
                          title={log.userAgent}
                        >
                          {log.userAgent || 'N/A'}
                        </span>
                      </LogField>

                      <LogField label="Event ID">
                        <span className="text-xs">{log.id}</span>
                      </LogField>

                      <LogField label="Timestamp">{verboseTimeStamp}</LogField>
                    </div>

                    {hasChanges && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                          Changes
                        </h4>
                        <ChangeDiff oldVals={oldValues} newVals={newValues} />
                      </div>
                    )}
                </div>
              </Disclosure.Panel>
            </td>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}

const SkeletonRow = ({ rows }: { rows: number }) => {
  const SKELETON_BASE = 'bg-neutral-300 dark:bg-neutral-700 animate-pulse'

  return (
    <>
      {[...Array(rows)].map((_, n) => (
        <tr
          key={n}
          className="py-4 border-b border-neutral-500/20 transition duration-300 ease-in-out"
        >
          <td className="px-6 py-2 border-l border-l-transparent">
            <FaChevronRight className="text-neutral-300 dark:text-neutral-700 animate-pulse text-xs" />
          </td>
          <td className="whitespace-nowrap px-6 py-2">
            <div className="flex items-center gap-2 text-xs">
              <div className="rounded-full flex items-center justify-center size-5 bg-neutral-400/30" />
              <div className={`${SKELETON_BASE} h-3.5 w-32 rounded-md`} />
            </div>
          </td>
          <td className="whitespace-nowrap px-6 py-2">
            <div className="flex items-center gap-2 -ml-1">
              <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" />
              <div className={`${SKELETON_BASE} h-3.5 w-20 rounded-md`} />
            </div>
          </td>
          <td className="whitespace-nowrap px-6 py-2">
            <div className={`${SKELETON_BASE} h-3.5 w-24 rounded-md`} />
          </td>
          <td className="px-6 py-2">
            <div className={`${SKELETON_BASE} h-3.5 w-48 rounded-md`} />
          </td>
          <td className="whitespace-nowrap px-6 py-2">
            <div className={`${SKELETON_BASE} h-3.5 w-20 rounded-md`} />
          </td>
        </tr>
      ))}
    </>
  )
}

export default function AuditLogs() {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const team = organisation?.name || ''

  const [activeTab, setActiveTab] = useState<string>('all')
  const [queryStart, setQueryStart] = useState<number>(LOGS_START_DATE)
  const [queryEnd, setQueryEnd] = useState<number>(getCurrentTimeStamp())
  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [selectedMember, setSelectedMember] = useState<OrganisationMemberType | null>(null)
  const [dateRange, setDateRange] = useState<'7' | '30' | '90' | 'custom' | null>(null)
  const [memberQuery, setMemberQuery] = useState('')

  useEffect(() => {
    const now = getCurrentTimeStamp()
    if (dateRange === '7') {
      setQueryStart(now - 7 * DAY)
      setQueryEnd(now)
    } else if (dateRange === '30') {
      setQueryStart(now - 30 * DAY)
      setQueryEnd(now)
    } else if (dateRange === '90') {
      setQueryStart(now - 90 * DAY)
      setQueryEnd(now)
    } else if (dateRange === null) {
      setQueryStart(LOGS_START_DATE)
      setQueryEnd(getCurrentTimeStamp())
    }
  }, [dateRange])

  const activeTabDef = RESOURCE_TABS.find((t) => t.key === activeTab)!
  const isTokensTab = activeTab === 'tokens'

  const { data, loading, fetchMore, refetch, networkStatus } = useQuery(GetAuditLogs, {
    variables: {
      organisationId: organisation?.id,
      start: queryStart,
      end: queryEnd,
      resourceType: isTokensTab ? null : activeTabDef.resourceType,
      eventTypes: eventTypes.length ? eventTypes : null,
      actorId: selectedMember ? selectedMember.id : null,
      offset: 0,
      limit: DEFAULT_PAGE_SIZE,
    },
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
    skip: !organisation,
  })

  const { data: membersData } = useQuery(GetOrganisationMembers, {
    variables: { organisationId: organisation?.id },
    skip: !organisation,
  })

  const { data: saData } = useQuery(GetServiceAccounts, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const isRefetching = networkStatus === NetworkStatus.refetch || loading
  const isFetchingMore = networkStatus === NetworkStatus.fetchMore

  const allLogs: AuditEventType[] = (data?.auditLogs?.logs || []).filter(
    Boolean
  ) as AuditEventType[]

  // Client-side filter for tokens tab (multiple resource types)
  const logs = isTokensTab
    ? allLogs.filter((l) => TOKEN_RESOURCE_TYPES.includes(l.resourceType))
    : allLogs

  const totalCount = data?.auditLogs?.count || 0
  const endOfList = allLogs.length >= totalCount

  const members: OrganisationMemberType[] = (membersData?.organisationMembers || []).filter(
    Boolean
  ) as OrganisationMemberType[]

  const serviceAccounts: ServiceAccountType[] = (saData?.serviceAccounts || []).filter(
    Boolean
  ) as ServiceAccountType[]

  const userCanReadLogs = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Logs', 'read', false)
    : false

  const handleRefetch = async () => {
    const now = Date.now()
    await refetch({
      organisationId: organisation?.id,
      start: queryStart,
      end: dateRange === 'custom' ? queryEnd : now,
      resourceType: isTokensTab ? null : activeTabDef.resourceType,
      eventTypes: eventTypes.length ? eventTypes : null,
      actorId: selectedMember?.id ?? null,
      offset: 0,
      limit: DEFAULT_PAGE_SIZE,
    })
  }

  const loadMore = () => {
    if (loading || isFetchingMore) return
    fetchMore({
      variables: { offset: allLogs.length },
      updateQuery: (prev: any, { fetchMoreResult }: any) => {
        if (!fetchMoreResult?.auditLogs?.logs?.length) return prev
        return {
          ...prev,
          auditLogs: {
            ...prev.auditLogs,
            logs: [...prev.auditLogs.logs, ...fetchMoreResult.auditLogs.logs],
            count: prev.auditLogs.count,
          },
        }
      },
    })
  }

  const clearFilters = () => {
    setEventTypes([])
    setSelectedMember(null)
    setDateRange(null)
    setQueryStart(LOGS_START_DATE)
    setQueryEnd(getCurrentTimeStamp())
  }

  const hasActiveFilters =
    eventTypes.length > 0 || selectedMember !== null || dateRange !== null

  const filterCategoryTitleStyle =
    'text-[11px] font-semibold text-neutral-500 tracking-widest uppercase'

  function formatTimestampForInput(ts: number): string {
    const date = new Date(ts)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  return (
    <>
      {userCanReadLogs ? (
        <div className="w-full text-black dark:text-white flex flex-col">
          {/* Resource type tabs */}
          <div className="flex gap-0 w-full border-b border-neutral-500/20 px-3 sm:px-4 lg:px-6">
            {RESOURCE_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'p-2 text-xs font-medium border-b -mb-px transition-colors focus:outline-none',
                  activeTab === tab.key
                    ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex w-full justify-between p-4 sticky top-0 z-5 bg-neutral-200 dark:bg-neutral-900">
            <span className="text-neutral-500 font-light text-base">
              {totalCount >= COUNT_ACCURACY_THRESHOLD ? '~' : ''}
              {totalCount !== undefined && <Count from={0} to={totalCount} />} Events
            </span>

            <div className="flex items-center gap-2">
              {/* Filter menu */}
              <Menu as="div" className="relative inline-block text-left">
                {({ open }) => (
                  <>
                    <div className="relative">
                      <Menu.Button as={Fragment}>
                        <div className="relative">
                          <Button variant="secondary" title="Filter logs">
                            <FaFilter /> Filter
                          </Button>
                          {hasActiveFilters && (
                            <span className="absolute -top-0 -right-0 h-2 w-2 rounded-full bg-emerald-500" />
                          )}
                        </div>
                      </Menu.Button>
                    </div>

                    <Transition
                      as={Fragment}
                      enter="transition duration-100 ease-out"
                      enterFrom="transform scale-95 opacity-0"
                      enterTo="transform scale-100 opacity-100"
                      leave="transition duration-75 ease-out"
                      leaveFrom="transform scale-100 opacity-100"
                      leaveTo="transform scale-95 opacity-0"
                    >
                      <Menu.Items
                        static
                        className="absolute right-0 mt-2 z-30 w-96 p-4 rounded-md shadow-xl bg-neutral-300/50 dark:bg-neutral-900/60 backdrop-blur-lg ring-1 ring-neutral-500/20 space-y-6"
                      >
                        {/* Event types */}
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Event Type</div>
                          <div className="flex flex-wrap gap-2">
                            {(
                              [
                                { code: 'C', label: 'Create', color: 'emerald' },
                                { code: 'U', label: 'Update', color: 'yellow' },
                                { code: 'R', label: 'Read', color: 'blue' },
                                { code: 'D', label: 'Delete', color: 'red' },
                                { code: 'A', label: 'Access', color: 'purple' },
                              ] as const
                            ).map((ev) => (
                              <Button
                                key={ev.code}
                                type="button"
                                variant={eventTypes.includes(ev.code) ? 'primary' : 'secondary'}
                                onClick={() =>
                                  setEventTypes((prev) =>
                                    prev.includes(ev.code)
                                      ? prev.filter((c) => c !== ev.code)
                                      : [...prev, ev.code]
                                  )
                                }
                              >
                                <span
                                  className={clsx(
                                    'text-2xs',
                                    {
                                      emerald: 'text-emerald-500',
                                      yellow: 'text-yellow-500',
                                      blue: 'text-blue-500',
                                      red: 'text-red-500',
                                      purple: 'text-purple-500',
                                    }[ev.color]
                                  )}
                                >
                                  {eventTypes.includes(ev.code) ? (
                                    <FaCheckCircle />
                                  ) : (
                                    <FaCircle />
                                  )}
                                </span>{' '}
                                <span className="text-xs">{ev.label}</span>
                              </Button>
                            ))}
                          </div>
                        </div>

                        {/* Member filter */}
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Account</div>
                          <Combobox
                            value={selectedMember}
                            by="id"
                            onChange={(val) => setSelectedMember(val)}
                          >
                            {({ open }) => (
                              <>
                                <div className="relative">
                                  <Combobox.Input
                                    className="w-full bg-neutral-200 dark:bg-neutral-800 rounded-md p-2 text-sm"
                                    onChange={(e) => setMemberQuery(e.target.value)}
                                    displayValue={(val: OrganisationMemberType | null) =>
                                      val ? val.fullName || val.email || '' : ''
                                    }
                                    placeholder="Search members"
                                  />
                                  <Combobox.Button className="absolute inset-y-0 right-2 flex items-center">
                                    <FaChevronDown className="text-neutral-500" />
                                  </Combobox.Button>
                                </div>
                                {open && (
                                  <Combobox.Options as={Fragment}>
                                    <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto bg-neutral-200 dark:bg-neutral-800 rounded-md p-2 shadow-xl space-y-1">
                                      {members
                                        .filter((m) => {
                                          if (!memberQuery) return true
                                          const q = memberQuery.toLowerCase()
                                          return (
                                            (m.fullName || '').toLowerCase().includes(q) ||
                                            (m.email || '').toLowerCase().includes(q)
                                          )
                                        })
                                        .map((m) => (
                                          <Combobox.Option key={m.id} value={m} as={Fragment}>
                                            {({ active, selected }) => (
                                              <div
                                                className={clsx(
                                                  'flex items-center justify-between px-2 py-1 rounded-md cursor-pointer text-xs',
                                                  active && 'bg-neutral-300 dark:bg-neutral-700'
                                                )}
                                              >
                                                <div className="flex items-center gap-1">
                                                  <Avatar member={m} size="sm" />
                                                  <span>{m.fullName || m.email}</span>
                                                </div>
                                                {selected && (
                                                  <FaCheckCircle className="text-emerald-500" />
                                                )}
                                              </div>
                                            )}
                                          </Combobox.Option>
                                        ))}
                                    </div>
                                  </Combobox.Options>
                                )}
                              </>
                            )}
                          </Combobox>
                        </div>

                        {/* Date range */}
                        <div className="space-y-2">
                          <div className={filterCategoryTitleStyle}>Date range</div>
                          <RadioGroup
                            value={dateRange}
                            onChange={setDateRange}
                            className="flex gap-2 flex-wrap"
                          >
                            {[
                              { value: '7', label: 'Last 7d' },
                              { value: '30', label: 'Last 30d' },
                              { value: '90', label: 'Last 90d' },
                              { value: 'custom', label: 'Custom' },
                            ].map(({ value, label }) => (
                              <RadioGroup.Option key={value} value={value} as={Fragment}>
                                {({ checked }) => (
                                  <Button
                                    type="button"
                                    variant={checked ? 'primary' : 'secondary'}
                                    classString="text-xs py-0.5 px-2"
                                  >
                                    {checked ? (
                                      <FaCheckCircle className="text-emerald-500" />
                                    ) : (
                                      <FaCircle />
                                    )}{' '}
                                    {label}
                                  </Button>
                                )}
                              </RadioGroup.Option>
                            ))}
                          </RadioGroup>
                          {dateRange === 'custom' && (
                            <div className="flex flex-col gap-2">
                              <div className="flex justify-between items-center gap-2">
                                <label className="text-neutral-500 text-2xs w-8">Start</label>
                                <input
                                  type="datetime-local"
                                  className="flex-1 p-1 rounded-md bg-neutral-200 dark:bg-neutral-800 text-xs"
                                  value={formatTimestampForInput(queryStart)}
                                  onChange={(e) =>
                                    setQueryStart(new Date(e.target.value).getTime())
                                  }
                                />
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <label className="text-neutral-500 text-2xs w-8">End</label>
                                <input
                                  type="datetime-local"
                                  className="flex-1 p-1 rounded-md bg-neutral-200 dark:bg-neutral-800 text-xs"
                                  value={formatTimestampForInput(queryEnd)}
                                  onChange={(e) =>
                                    setQueryEnd(new Date(e.target.value).getTime())
                                  }
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end pt-2">
                          <Button
                            variant="outline"
                            disabled={!hasActiveFilters}
                            onClick={clearFilters}
                          >
                            <FaArrowRotateLeft /> Reset filter
                          </Button>
                        </div>
                      </Menu.Items>
                    </Transition>
                  </>
                )}
              </Menu>

              {/* Refresh */}
              <Button variant="secondary" onClick={handleRefetch} disabled={isRefetching}>
                <FiRefreshCw
                  size={20}
                  className={clsx('mr-1', isRefetching ? 'animate-spin' : '')}
                />{' '}
                Refresh
              </Button>
            </div>
          </div>

          {/* Table */}
          <table className="table-fixed w-full text-left text-sm">
            <thead className="border-b-2 border-neutral-500/20 sticky top-[58px] z-1 bg-neutral-200/50 dark:bg-neutral-900/60 backdrop-blur-lg shadow-xl">
              <tr className="text-gray-500 uppercase text-2xs tracking-wider">
                <th className="w-10"></th>
                <th className="px-6 py-4">Actor</th>
                <th className="px-6 py-4">Event</th>
                <th className="px-6 py-4">Resource</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">Time</th>
              </tr>
            </thead>
            <tbody className="h-full">
              {logs.map((log, n) => (
                <Fragment key={log.id}>
                  {n !== 0 && n % DEFAULT_PAGE_SIZE === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="flex items-center justify-center bg-zinc-300 dark:bg-zinc-800 py-0.5 text-neutral-500 text-xs">
                          Page {n / DEFAULT_PAGE_SIZE + 1}
                        </div>
                      </td>
                    </tr>
                  )}
                  <LogRow
                    log={log}
                    members={members}
                    serviceAccounts={serviceAccounts}
                    team={team}
                  />
                </Fragment>
              ))}

              {loading && <SkeletonRow rows={DEFAULT_PAGE_SIZE} />}

              <tr className="h-40">
                <td colSpan={6}>
                  <div className="flex justify-center px-6 py-4 text-neutral-500 font-medium">
                    {!endOfList && (
                      <Button
                        variant="secondary"
                        onClick={loadMore}
                        disabled={isFetchingMore || endOfList}
                      >
                        <FiChevronsDown /> Load more
                      </Button>
                    )}
                    {endOfList && `No${logs.length ? ' more ' : ' '}logs to show`}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view audit logs."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      )}
    </>
  )
}
