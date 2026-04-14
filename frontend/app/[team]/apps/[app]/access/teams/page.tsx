'use client'

import { AppType, EnvironmentType, TeamAppEnvironmentType, TeamType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { FaBan, FaExclamationTriangle, FaRobot, FaUsers } from 'react-icons/fa'
import { RoleLabel } from '@/components/users/RoleLabel'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { AddTeamToAppDialog } from './_components/AddTeamToAppDialog'
import { RemoveTeamFromAppDialog } from './_components/RemoveTeamFromAppDialog'
import { ManageTeamEnvsDialog } from './_components/ManageTeamEnvsDialog'
import Link from 'next/link'


export default function AppTeams({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { hasPermission, isGlobalAccess: userIsGlobalAccess } = useAppPermissions(params.app)

  const userCanReadTeams = hasPermission('Teams', 'read', true)
  const userCanUpdateTeams = hasPermission('Teams', 'update', true)

  const { data: teamsData, loading: teamsLoading } = useQuery(GetTeams, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadTeams,
    pollInterval: 10000,
  })

  const { data: appsData, loading: appsLoading } = useQuery(GetApps, {
    variables: { organisationId: organisation?.id, appId: params.app },
    skip: !organisation,
  })

  const app: AppType | null = appsData?.apps?.[0] || null
  const loading = teamsLoading || appsLoading

  // Teams that have access to this app
  const teamsWithAccess: TeamType[] =
    teamsData?.teams?.filter((team: TeamType) =>
      team.apps?.some((a) => a!.id === params.app)
    ) || []

  if (!organisation || loading)
    return (
      <div className="h-full max-h-screen overflow-y-auto w-full flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  if (!userCanReadTeams)
    return (
      <EmptyState
        title="Access restricted"
        subtitle="You don't have the permissions required to view Teams."
        graphic={
          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
            <FaBan />
          </div>
        }
      >
        <></>
      </EmptyState>
    )

  const appEnvironments: EnvironmentType[] =
    app?.environments?.filter(Boolean).map((e) => e as EnvironmentType) || []

  return (
    <div className="w-full space-y-6 text-black dark:text-white">
      <div className="px-4">
        <h2 className="text-lg font-bold">Teams</h2>
        <div className="text-neutral-500">Manage team-based access to this App</div>
      </div>

      {!app?.sseEnabled && (
        <div className="mx-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          <FaExclamationTriangle className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Server-side encryption required</div>
            <p className="text-xs mt-0.5 opacity-80">
              Team-based access requires SSE to be enabled on this app. Enable SSE in app settings
              to use team access.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {userCanUpdateTeams && app?.sseEnabled && (
          <div className="flex justify-end px-4">
            <AddTeamToAppDialog appId={params.app} appEnvironments={appEnvironments} />
          </div>
        )}

        {teamsWithAccess.length > 0 ? (
          <table className="table-auto min-w-full divide-y divide-zinc-500/40">
            <thead>
              <tr>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Team
                </th>
                <th className="hidden md:table-cell px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Members
                </th>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment Access
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {teamsWithAccess.map((team: TeamType) => {
                const teamEnvs =
                  team.appEnvironments?.filter(
                    (tae: TeamAppEnvironmentType | null) => tae?.app?.id === params.app
                  ) || []

                const memberCount = team.members?.filter((m) => m.orgMember).length || 0
                const saCount = team.members?.filter((m) => m.serviceAccount).length || 0
                const isTeamOwner =
                  userIsGlobalAccess ||
                  team.createdBy?.id === organisation?.memberId

                return (
                  <tr key={team.id} className="group">
                    <td className="px-6 py-2">
                      <Link
                        href={`/${params.team}/access/teams/${team.id}`}
                        className="hover:underline"
                      >
                        <div className="text-sm font-medium">{team.name}</div>
                        {team.description && (
                          <div className="text-2xs text-neutral-500 truncate max-w-xs">
                            {team.description}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="hidden md:table-cell px-6 py-2">
                      <div className="space-y-1">
                        {memberCount > 0 && (
                          <div className="flex items-center gap-1.5 text-2xs text-neutral-500">
                            <FaUsers className="text-xs" />
                            <span>
                              {memberCount} member{memberCount !== 1 ? 's' : ''}
                            </span>
                            {team.memberRole && <RoleLabel role={team.memberRole} size="xs" />}
                          </div>
                        )}
                        {saCount > 0 && (
                          <div className="flex items-center gap-1.5 text-2xs text-neutral-500">
                            <FaRobot className="text-xs" />
                            <span>
                              {saCount} service account{saCount !== 1 ? 's' : ''}
                            </span>
                            {team.serviceAccountRole && <RoleLabel role={team.serviceAccountRole} size="xs" />}
                          </div>
                        )}
                        {memberCount === 0 && saCount === 0 && (
                          <span className="text-2xs text-neutral-500">No members</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-2">
                      <div className="flex items-center gap-2">
                        <ManageTeamEnvsDialog
                          teamId={team.id}
                          teamName={team.name}
                          appId={params.app}
                          appEnvironments={appEnvironments}
                          teamEnvs={teamEnvs as TeamAppEnvironmentType[]}
                          canManage={isTeamOwner && userCanUpdateTeams}
                        />
                        {isTeamOwner && userCanUpdateTeams && (
                          <div className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition ease">
                            <RemoveTeamFromAppDialog
                              teamId={team.id}
                              teamName={team.name}
                              appId={params.app}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="No teams"
            subtitle={
              app?.sseEnabled
                ? 'Add a team to grant its members access to this app.'
                : 'Enable SSE to use team-based access for this app.'
            }
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-5xl text-center">
                <FaUsers />
              </div>
            }
          >
            {userCanUpdateTeams && app?.sseEnabled && (
              <AddTeamToAppDialog appId={params.app} appEnvironments={appEnvironments} />
            )}
          </EmptyState>
        )}
      </div>
    </div>
  )
}
