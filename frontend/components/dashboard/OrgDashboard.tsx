'use client'

import clsx from 'clsx'
import { useQuery } from '@apollo/client'
import { useMemo } from 'react'
import {
  AppType,
  AuditEventType,
  EnvironmentSyncType,
  OrganisationMemberType,
  OrganisationType,
  ServiceAccountType,
  TeamType,
} from '@/apollo/graphql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { GetAccessOverview } from '@/graphql/queries/organisation/getAccessOverview.gql'
import { GetRecentActivity } from '@/graphql/queries/organisation/getRecentActivity.gql'
import { GetSyncOverview } from '@/graphql/queries/syncing/getSyncOverview.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { buildAccessIndex, summariseApps } from '@/utils/dashboard'
import { StatTiles } from './StatTiles'
import { AppsOverview } from './AppsOverview'
import { RecentActivity } from './RecentActivity'
import { MembersOverview, ServiceAccountsOverview } from './AccessOverview'

const ACTIVITY_LIMIT = 10

// A column of cards on desktop; below that its cards join the page's single column, in order.
const COLUMN = 'contents xl:block xl:min-w-0 xl:space-y-6'

export const OrgDashboard = ({ organisation }: { organisation: OrganisationType }) => {
  const permissions = organisation.role?.permissions
  const canReadApps = userHasPermission(permissions, 'Apps', 'read')
  const canReadMembers = userHasPermission(permissions, 'Members', 'read')
  const canReadServiceAccounts = userHasPermission(permissions, 'ServiceAccounts', 'read')
  const canReadTeams = userHasPermission(permissions, 'Teams', 'read')
  const canReadLogs = userHasPermission(permissions, 'Logs', 'read')
  const canReadSyncs = canReadApps && userHasPermission(permissions, 'Integrations', 'read', true)
  // Service accounts and activity share the second column
  const hasSecondColumn = canReadServiceAccounts || canReadLogs
  const team = organisation.name

  // The navbar and command palette run these same queries on every page, so
  // they are served from the Apollo cache (or joined in flight).
  const { data: appsData, loading: appsLoading } = useQuery(GetApps, {
    variables: { organisationId: organisation.id },
    skip: !canReadApps,
  })
  const { data: teamsData } = useQuery(GetTeams, {
    variables: { organisationId: organisation.id },
    skip: !canReadTeams,
  })

  // Lean selections: one SQL query per relation, no per-row lookups.
  const { data: accessData } = useQuery(GetAccessOverview, {
    variables: {
      organisationId: organisation.id,
      includeMembers: canReadMembers,
      includeServiceAccounts: canReadServiceAccounts,
    },
    skip: !canReadMembers && !canReadServiceAccounts,
  })
  const { data: activityData, loading: activityLoading } = useQuery(GetRecentActivity, {
    variables: { organisationId: organisation.id, limit: ACTIVITY_LIMIT },
    skip: !canReadLogs,
    fetchPolicy: 'cache-and-network',
  })
  // Sync columns only (destination, last run, paused); its fresh statuses also
  // update the cached apps query.
  const { data: syncData } = useQuery(GetSyncOverview, {
    variables: { orgId: organisation.id },
    skip: !canReadSyncs,
    fetchPolicy: 'cache-and-network',
  })

  const apps: AppType[] = useMemo(() => appsData?.apps ?? [], [appsData])
  const teams: TeamType[] | undefined = teamsData?.teams
  const members: OrganisationMemberType[] | undefined = accessData?.organisationMembers
  const serviceAccounts: ServiceAccountType[] | undefined = accessData?.serviceAccounts
  // Creating a token refetches the user's tokens into this same field, which clears the prompt.
  const needsPersonalToken = accessData?.userTokens?.length === 0
  const logs: AuditEventType[] = (activityData?.auditLogs?.logs ?? []).filter(Boolean)

  const summary = useMemo(() => (appsData ? summariseApps(apps) : undefined), [apps, appsData])
  const access = useMemo(() => buildAccessIndex(apps, teams ?? []), [apps, teams])
  const syncDetails = useMemo(() => {
    const syncs: EnvironmentSyncType[] = (syncData?.syncs ?? []).filter(Boolean)
    return new Map(syncs.map((sync) => [sync.id, sync]))
  }, [syncData])

  // Activity actors: the members list when readable, else app members from the cache.
  const memberMap = useMemo(() => {
    const map = new Map<string, OrganisationMemberType>()
    apps.forEach((app) => app.members?.forEach((m) => m && map.set(m.id, m)))
    members?.forEach((m) => map.set(m.id, m))
    return map
  }, [apps, members])
  const accountMap = useMemo(
    () => new Map((serviceAccounts ?? []).map((account) => [account.id, account])),
    [serviceAccounts]
  )

  const teamMemberCount = useMemo(
    () =>
      new Set(
        (teams ?? []).flatMap((t) => (t.members ?? []).map((m) => m.orgMember?.id).filter(Boolean))
      ).size,
    [teams]
  )

  // Seats count members plus pending invites, so the difference is the invites.
  const seats = organisation.planDetail?.seatsUsed
  const pendingInvites = members && seats?.users ? Math.max(seats.users - members.length, 0) : 0
  const serviceAccountsWithAccess = serviceAccounts?.filter((a) =>
    access.serviceAccounts.has(a.id)
  ).length

  return (
    <div className="w-full space-y-4 p-3 text-zinc-900 dark:text-zinc-100 sm:p-4 lg:space-y-6 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold capitalize sm:text-xl">{organisation.name}</h1>
        <p className="text-xs text-neutral-500">
          Overview of apps, integrations and access across your organisation
        </p>
      </header>

      <StatTiles
        team={team}
        summary={canReadApps ? summary : null}
        members={canReadMembers ? members?.length : null}
        pendingInvites={pendingInvites}
        serviceAccounts={canReadServiceAccounts ? serviceAccounts?.length : null}
        serviceAccountsWithAccess={serviceAccountsWithAccess}
        teams={canReadTeams && teams?.length ? teams.length : undefined}
        teamMembers={teamMemberCount}
      />

      {/* Apps, environments and their syncs lead, across the full width */}
      <AppsOverview
        team={team}
        apps={apps}
        access={access}
        loading={appsLoading}
        canReadApps={canReadApps}
        canCreateApps={userHasPermission(permissions, 'Apps', 'create')}
        syncDetails={syncDetails}
      />

      {/* Members and service accounts side by side, as both hand out tokens. Two independent
          columns, so a tall card (e.g. with CLI setup) never stretches its neighbour, with
          activity under the service accounts. One column on narrower screens, or when either
          column would be empty: members, service accounts, then activity. */}
      <div
        className={clsx(
          'grid grid-cols-1 items-start gap-4 lg:gap-6',
          canReadMembers && hasSecondColumn && 'xl:grid-cols-2'
        )}
      >
        {canReadMembers && (
          <div className={COLUMN}>
            <MembersOverview
              className="order-1"
              team={team}
              organisation={organisation}
              apps={apps}
              access={access}
              members={members}
              canInviteMembers={userHasPermission(permissions, 'Members', 'create')}
              needsPersonalToken={needsPersonalToken}
            />
          </div>
        )}
        {hasSecondColumn && (
          <div className={COLUMN}>
            {canReadServiceAccounts && (
              <ServiceAccountsOverview
                className="order-2"
                team={team}
                organisation={organisation}
                apps={apps}
                access={access}
                serviceAccounts={serviceAccounts}
                canCreateServiceAccounts={userHasPermission(
                  permissions,
                  'ServiceAccounts',
                  'create'
                )}
              />
            )}
            {canReadLogs && (
              <RecentActivity
                className="order-3"
                team={team}
                logs={logs}
                loading={activityLoading}
                members={memberMap}
                serviceAccounts={accountMap}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
