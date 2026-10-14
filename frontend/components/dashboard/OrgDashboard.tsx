'use client'

import { useQuery } from '@apollo/client'
import { useMemo } from 'react'
import {
  AppType,
  AuditEventType,
  OrganisationMemberType,
  OrganisationType,
  ServiceAccountType,
  TeamType,
} from '@/apollo/graphql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { GetAccessOverview } from '@/graphql/queries/organisation/getAccessOverview.gql'
import { GetRecentActivity } from '@/graphql/queries/organisation/getRecentActivity.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { buildAccessIndex, summariseApps } from '@/utils/dashboard'
import { GetStarted } from './GetStarted'
import { StatTiles } from './StatTiles'
import { AppsOverview } from './AppsOverview'
import { RecentActivity } from './RecentActivity'
import { AccessOverview } from './AccessOverview'
import { IntegrationsOverview } from './IntegrationsOverview'

const ACTIVITY_LIMIT = 15

export const OrgDashboard = ({ organisation }: { organisation: OrganisationType }) => {
  const permissions = organisation.role?.permissions
  const canReadApps = userHasPermission(permissions, 'Apps', 'read')
  const canReadMembers = userHasPermission(permissions, 'Members', 'read')
  const canReadServiceAccounts = userHasPermission(permissions, 'ServiceAccounts', 'read')
  const canReadTeams = userHasPermission(permissions, 'Teams', 'read')
  const canReadLogs = userHasPermission(permissions, 'Logs', 'read')
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

  const apps: AppType[] = useMemo(() => appsData?.apps ?? [], [appsData])
  const teams: TeamType[] | undefined = teamsData?.teams
  const members: OrganisationMemberType[] | undefined = accessData?.organisationMembers
  const serviceAccounts: ServiceAccountType[] | undefined = accessData?.serviceAccounts
  const logs: AuditEventType[] = (activityData?.auditLogs?.logs ?? []).filter(Boolean)

  const summary = useMemo(() => (appsData ? summariseApps(apps) : undefined), [apps, appsData])
  const access = useMemo(() => buildAccessIndex(apps, teams ?? []), [apps, teams])

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

  // Brand-new orgs get the setup guide first. The onboarding sample app doesn't count.
  const isNewOrg = !!appsData && !apps.some((app) => app.name !== 'example-app')

  return (
    <div className="w-full space-y-4 p-3 text-zinc-900 dark:text-zinc-100 sm:p-4 lg:space-y-6 lg:p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-bold capitalize sm:text-xl">{organisation.name}</h1>
        <p className="text-xs text-neutral-500">
          Overview of apps, integrations and access across your organisation
        </p>
      </header>

      {isNewOrg && <GetStarted organisation={organisation} />}

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

      {/* Two independent columns, so a short panel never stretches to match its neighbour */}
      <div className="grid grid-cols-1 items-start gap-4 lg:gap-6 min-[1360px]:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:space-y-6 min-[1360px]:col-span-2">
          <AppsOverview
            team={team}
            apps={apps}
            access={access}
            loading={appsLoading}
            canReadApps={canReadApps}
            canCreateApps={userHasPermission(permissions, 'Apps', 'create')}
          />
          <AccessOverview
            team={team}
            apps={apps}
            access={access}
            members={members}
            serviceAccounts={serviceAccounts}
            teams={teams}
            canReadMembers={canReadMembers}
            canReadServiceAccounts={canReadServiceAccounts}
            canReadTeams={canReadTeams}
          />
        </div>
        <div className="min-w-0 space-y-4 lg:space-y-6">
          <IntegrationsOverview
            team={team}
            services={summary?.services ?? []}
            loading={appsLoading}
            canCreateSyncs={userHasPermission(permissions, 'Integrations', 'create', true)}
          />
          {canReadLogs && (
            <RecentActivity
              team={team}
              logs={logs}
              loading={activityLoading}
              members={memberMap}
              serviceAccounts={accountMap}
            />
          )}
        </div>
      </div>
    </div>
  )
}
