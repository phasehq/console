'use client'

import { AppType, TeamAppEnvironmentType, TeamMembershipType, TeamType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { ProfileCard } from '@/components/common/ProfileCard'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { relativeTimeFromDates } from '@/utils/time'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useContext } from 'react'
import {
  FaBan,
  FaChevronLeft,
  FaClock,
  FaCog,
  FaExternalLinkAlt,
  FaRobot,
  FaUsers,
} from 'react-icons/fa'
import { AddTeamMembersDialog } from './_components/AddTeamMembersDialog'
import { AddTeamAppsDialog } from './_components/AddTeamAppsDialog'
import { RemoveTeamMemberDialog } from './_components/RemoveTeamMemberDialog'
import { UpdateTeamDialog } from './_components/UpdateTeamDialog'
import { DeleteTeamDialog } from '../_components/DeleteTeamDialog'

export default function TeamDetail({ params }: { params: { team: string; teamId: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const router = useRouter()

  const userCanReadTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'read')
    : false

  const userCanUpdateTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'update')
    : false

  const userCanDeleteTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'delete')
    : false

  const { data, loading } = useQuery(GetTeams, {
    variables: { organisationId: organisation?.id, teamId: params.teamId },
    skip: !organisation || !userCanReadTeams,
    pollInterval: 10000,
  })

  const team: TeamType | null = data?.teams?.[0] || null

  if (loading || !organisation)
    return (
      <div className="flex items-center justify-center h-full w-full">
        <Spinner size="md" />
      </div>
    )

  if (!userCanReadTeams)
    return (
      <section className="p-4">
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view this team."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl">
              <FaBan />
            </div>
          }
        >
          <Link
            href={`/${params.team}/access/teams`}
            className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
          >
            <FaChevronLeft /> Back to teams
          </Link>
        </EmptyState>
      </section>
    )

  if (!team)
    return (
      <section className="p-4">
        <EmptyState title="Team not found" subtitle="This team may have been deleted.">
          <Link
            href={`/${params.team}/access/teams`}
            className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
          >
            <FaChevronLeft /> Back to teams
          </Link>
        </EmptyState>
      </section>
    )

  // Group environments by app
  const envsByApp: Record<string, { app: AppType; envs: TeamAppEnvironmentType[] }> = {}
  for (const tae of team.appEnvironments || []) {
    const appId = tae!.app!.id
    if (!envsByApp[appId]) {
      envsByApp[appId] = { app: tae!.app as unknown as AppType, envs: [] }
    }
    envsByApp[appId].envs.push(tae!)
  }

  return (
    <section className="flex flex-col px-3 sm:px-4 lg:px-6">
      <div className="pb-4">
        <Link
          href={`/${params.team}/access/teams`}
          className="text-neutral-500 inline-flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
        >
          <FaChevronLeft /> Back to teams
        </Link>
      </div>

      <div className="flex-grow overflow-y-auto space-y-6 py-4">
        {/* Header: Team name, badge, metadata */}
        <div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-lg font-medium flex items-center gap-2">
                {team.name}
                {team.isScimManaged && (
                  <span className="text-2xs px-1 rounded ring-1 ring-inset ring-purple-500/40 bg-purple-500/20 text-purple-400 uppercase font-medium">
                    <FaRobot className="inline mr-0.5" />
                    SCIM
                  </span>
                )}
              </h3>
              {team.description && (
                <span className="text-neutral-500 text-sm">{team.description}</span>
              )}
              <span className="text-neutral-500 text-xs">
                {team.members?.filter((m) => m.orgMember).length || 0} member
                {(team.members?.filter((m) => m.orgMember).length || 0) !== 1 ? 's' : ''} and{' '}
                {team.members?.filter((m) => m.serviceAccount).length || 0} service account
                {(team.members?.filter((m) => m.serviceAccount).length || 0) !== 1 ? 's' : ''} with
                access to {Object.keys(envsByApp).length} app
                {Object.keys(envsByApp).length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex flex-col items-end gap-2">
              {userCanUpdateTeams && !team.isScimManaged && <UpdateTeamDialog team={team} />}
              <span
                className="text-neutral-500 text-2xs flex items-center gap-1 cursor-help"
                title={new Date(team.createdAt).toLocaleString()}
              >
                <FaClock /> Created {relativeTimeFromDates(new Date(team.createdAt))}
                {team.createdBy && ` by ${team.createdBy.fullName || team.createdBy.email}`}
              </span>
            </div>
          </div>

          {/* Role overrides */}
          {(team.memberRole || team.serviceAccountRole) && (
            <div className="flex items-center gap-4 mt-3">
              {team.memberRole && (
                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <FaUsers className="text-xs" />
                  <span>Member role:</span>
                  <RoleLabel role={team.memberRole} />
                </div>
              )}
              {team.serviceAccountRole && (
                <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <FaRobot className="text-xs" />
                  <span>SA role:</span>
                  <RoleLabel role={team.serviceAccountRole} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Members Section */}
        <div className="pt-4 space-y-3 border-t border-neutral-500/40">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium">Members</div>
              <div className="text-neutral-500 text-sm">
                Members and service accounts in this team
              </div>
            </div>
            {userCanUpdateTeams && !team.isScimManaged && (
              <AddTeamMembersDialog teamId={team.id} existingMembers={team.members || []} />
            )}
          </div>

          <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
            {team.members && team.members.length > 0 ? (
              team.members.map((membership: TeamMembershipType) => {
                const isUser = !!membership.orgMember
                const memberId = isUser ? membership.orgMember!.id : membership.serviceAccount!.id
                const displayName = isUser
                  ? membership.fullName || membership.email || 'Unknown'
                  : membership.serviceAccount!.name || 'Service Account'

                return (
                  <div
                    key={membership.id}
                    className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center py-1.5 px-2 group"
                  >
                    {isUser ? (
                      <ProfileCard
                        user={{
                          name: membership.fullName,
                          email: membership.email,
                          image: membership.avatarUrl,
                        }}
                        size="md"
                      />
                    ) : (
                      <ProfileCard
                        serviceAccount={membership.serviceAccount!}
                        size="md"
                      />
                    )}

                    <div>
                      {isUser && membership.orgMember?.role && (
                        <RoleLabel role={membership.orgMember.role} size="xs" />
                      )}
                      {!isUser && membership.serviceAccount?.role && (
                        <RoleLabel role={membership.serviceAccount.role} size="xs" />
                      )}
                    </div>

                    <div className="text-2xs text-neutral-500">
                      Added {relativeTimeFromDates(new Date(membership.createdAt))}
                    </div>

                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition ease">
                      <Link
                        href={
                          isUser
                            ? `/${params.team}/access/members/${memberId}`
                            : `/${params.team}/access/service-accounts/${memberId}`
                        }
                        title={`View ${displayName}`}
                      >
                        <Button variant="secondary">
                          <FaExternalLinkAlt /> Manage account
                        </Button>
                      </Link>
                      {userCanUpdateTeams &&
                        !team.isScimManaged &&
                        !(isUser && team.createdBy?.id === membership.orgMember?.id) && (
                          <RemoveTeamMemberDialog
                            teamId={team.id}
                            memberId={memberId}
                            memberName={displayName}
                            memberType={isUser ? 'USER' : 'SERVICE'}
                          />
                        )}
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="py-8 text-center text-neutral-500">
                This team does not have any members yet.
              </div>
            )}
          </div>
        </div>

        {/* App Access Section */}
        <div className="pt-4 space-y-3 border-t border-neutral-500/40">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium">App Access</div>
              <div className="text-neutral-500 text-sm">
                Apps and environments this team has access to
              </div>
            </div>
            {userCanUpdateTeams && <AddTeamAppsDialog team={team} />}
          </div>

          <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
            {Object.keys(envsByApp).length > 0 ? (
              Object.entries(envsByApp).map(([appId, { app, envs }]) => (
                <div
                  key={appId}
                  className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center py-1.5 px-2 group"
                >
                  <div className="space-y-0.5">
                    <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                      {app.name}
                    </div>
                  </div>

                  <div className="col-span-2">
                    <div className="text-2xs uppercase tracking-widest text-neutral-500 mb-1">
                      Environments
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {envs.map((tae) => (
                        <span
                          key={tae.id}
                          className="text-2xs px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                        >
                          {tae.environment!.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Link
                      className="opacity-0 group-hover:opacity-100 transition ease"
                      href={`/${params.team}/apps/${appId}/access/teams`}
                      title={`Manage team access to ${app.name}`}
                    >
                      <Button variant="secondary" icon={FaCog}>
                        Manage
                      </Button>
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-neutral-500">
                This team does not have access to any apps. To grant access, go to an app&apos;s
                Access &gt; Teams tab.
              </div>
            )}
          </div>
        </div>

        {/* Danger Zone */}
        {userCanDeleteTeams && !team.isScimManaged && (
          <div className="pt-4 space-y-2 border-t border-neutral-500/40">
            <div>
              <div className="text-base font-medium">Danger Zone</div>
              <div className="text-neutral-500 text-sm">
                This action is destructive and cannot be reversed
              </div>
            </div>

            <div className="flex justify-between items-center ring-1 ring-inset ring-red-500/40 bg-red-400/10 rounded-lg p-3">
              <div>
                <div className="font-medium text-sm text-red-400">Delete team</div>
                <div className="text-neutral-500 text-xs">
                  Permanently delete this team and revoke all team-based access.
                </div>
              </div>
              <DeleteTeamDialog
                teamId={team.id}
                teamName={team.name}
                onDelete={() => router.push(`/${params.team}/access/teams`)}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
