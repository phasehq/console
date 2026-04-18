'use client'

import { AppType, TeamAppEnvironmentType, TeamMembershipType, TeamType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { ProfileCard } from '@/components/common/ProfileCard'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { userHasPermission, userHasGlobalAccess } from '@/utils/access/permissions'
import { relativeTimeFromDates } from '@/utils/time'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useContext } from 'react'
import {
  FaBan,
  FaBuilding,
  FaChevronLeft,
  FaClock,
  FaCog,
  FaCrown,
  FaExternalLinkAlt,
  FaUsersCog,
  FaRobot,
  FaUsers,
} from 'react-icons/fa'
import { AddTeamMembersDialog } from './_components/AddTeamMembersDialog'
import { AddTeamAppsDialog } from './_components/AddTeamAppsDialog'
import { RemoveTeamMemberDialog } from './_components/RemoveTeamMemberDialog'
import { UpdateTeamDialog } from './_components/UpdateTeamDialog'
import { DeleteTeamDialog } from '../_components/DeleteTeamDialog'
import { CreateServiceAccountDialog } from '../../service-accounts/_components/CreateServiceAccountDialog'
import { DeleteServiceAccountDialog } from '../../service-accounts/_components/DeleteServiceAccountDialog'
import { RemoveTeamAppDialog } from './_components/RemoveTeamAppDialog'
import { TransferTeamOwnershipDialog } from './_components/TransferTeamOwnershipDialog'

export default function TeamDetail({ params }: { params: { team: string; teamId: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const router = useRouter()

  const userCanReadTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'read')
    : false

  const userIsGlobalAccess = organisation
    ? userHasGlobalAccess(organisation.role!.permissions)
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

  const userIsMember =
    userIsGlobalAccess ||
    team.members?.some((m) => m.orgMember?.id === organisation?.memberId) ||
    false

  // Team owner retains full access; other members use effective permissions
  const isTeamOwner = team.owner?.id === organisation?.memberId

  // Effective permissions: team member role override takes precedence over org-level role
  const effectivePermissions = team.memberRole?.permissions ?? organisation.role!.permissions

  const canUpdateTeam =
    userIsGlobalAccess || isTeamOwner || userHasPermission(effectivePermissions, 'Teams', 'update')
  const canDeleteTeam =
    userIsGlobalAccess || isTeamOwner || userHasPermission(effectivePermissions, 'Teams', 'delete')
  const canCreateSA =
    userIsGlobalAccess || isTeamOwner || userHasPermission(effectivePermissions, 'ServiceAccounts', 'create')
  const canDeleteSA =
    userIsGlobalAccess || isTeamOwner || userHasPermission(effectivePermissions, 'ServiceAccounts', 'delete')

  if (!userIsMember)
    return (
      <section className="p-4">
        <EmptyState
          title="Access restricted"
          subtitle="You are not a member of this team. Only team members and organisation admins can view this page."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
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
                  <span className="inline-flex items-center shrink-0 px-1 py-px rounded text-3xs font-medium bg-blue-500/10 text-blue-500 ring-1 ring-inset ring-blue-500/20">
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
              {canUpdateTeam && <UpdateTeamDialog team={team} />}
              <span
                className="text-neutral-500 text-2xs flex items-center gap-1 cursor-help"
                title={new Date(team.createdAt).toLocaleString()}
              >
                <FaClock /> Created {relativeTimeFromDates(new Date(team.createdAt))}
                {team.createdBy && ` by ${team.createdBy.fullName || team.createdBy.email}`}
              </span>
            </div>
          </div>

        </div>

        {/* Members Section (human users only) */}
        <div className="pt-4 space-y-3 border-t border-neutral-500/40">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium flex items-center gap-2">
                Members
                {team.memberRole && <RoleLabel role={team.memberRole} size="xs" />}
              </div>
              <div className="text-neutral-500 text-sm">
                Organisation members in this team
              </div>
            </div>
            {canUpdateTeam && !team.isScimManaged && (
              <AddTeamMembersDialog teamId={team.id} existingMembers={team.members || []} mode="members" />
            )}
          </div>

          <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
            {(() => {
              const humanMembers = (team.members || []).filter((m) => m.orgMember)
              return humanMembers.length > 0 ? (
                humanMembers.map((membership: TeamMembershipType) => {
                  const memberId = membership.orgMember!.id
                  const displayName = membership.fullName || membership.email || 'Unknown'
                  const isMemberOwner = team.owner?.id === membership.orgMember?.id

                  return (
                    <div
                      key={membership.id}
                      className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center py-1.5 px-2 group"
                    >
                      <ProfileCard
                        member={membership.orgMember!}
                        size="md"
                      />

                      <div className="flex items-center gap-1.5">
                        {!team.memberRole && membership.orgMember?.role && (
                          <RoleLabel role={membership.orgMember.role} size="xs" />
                        )}
                        {isMemberOwner && (
                          <FaCrown className="text-amber-500 text-xs shrink-0" title="Team owner" />
                        )}
                      </div>

                      <div className="text-2xs text-neutral-500">
                        Added {relativeTimeFromDates(new Date(membership.createdAt))}
                      </div>

                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition ease">
                        <Link
                          href={`/${params.team}/access/members/${memberId}`}
                          title={`View ${displayName}`}
                        >
                          <Button variant="secondary">
                            <FaExternalLinkAlt /> Manage account
                          </Button>
                        </Link>
                        {canUpdateTeam &&
                          !team.isScimManaged &&
                          !isMemberOwner && (
                            <RemoveTeamMemberDialog
                              teamId={team.id}
                              memberId={memberId}
                              memberName={displayName}
                              memberType="USER"
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
              )
            })()}
          </div>
        </div>

        {/* Service Accounts Section (all SAs with ownership column) */}
        <div className="pt-4 space-y-3 border-t border-neutral-500/40">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-medium flex items-center gap-2">
                Service Accounts
                {team.serviceAccountRole && <RoleLabel role={team.serviceAccountRole} size="xs" />}
              </div>
              <div className="text-neutral-500 text-sm">
                Service accounts in this team
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canUpdateTeam && (
                <AddTeamMembersDialog teamId={team.id} existingMembers={team.members || []} mode="service-accounts" buttonVariant="secondary" />
              )}
              {canCreateSA && (
                <CreateServiceAccountDialog
                  teamId={team.id}
                  teamName={team.name}
                  teamRole={team.serviceAccountRole}
                />
              )}
            </div>
          </div>

          <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
            {(() => {
              const saMembers = (team.members || []).filter((m) => m.serviceAccount)
              return saMembers.length > 0 ? (
                saMembers.map((membership: TeamMembershipType) => {
                  const sa = membership.serviceAccount!
                  const isTeamOwned = sa.team?.id === team.id

                  return (
                    <div
                      key={membership.id}
                      className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center py-1.5 px-2 group"
                    >
                      <ProfileCard serviceAccount={sa} size="md" />

                      <div>
                        {!team.serviceAccountRole && sa.role && <RoleLabel role={sa.role} size="xs" />}
                      </div>

                      <div>
                        {isTeamOwned ? (
                          <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400" title="Owned by this team — bound to the team lifecycle">
                            <FaUsersCog className="text-[0.55rem]" />
                            Team
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-neutral-500/15 text-neutral-600 dark:text-neutral-400" title="Organisation-level account — visible org-wide">
                            <FaBuilding className="text-[0.55rem]" />
                            Organisation
                          </span>
                        )}
                      </div>

                      <div className="text-2xs text-neutral-500">
                        Added {relativeTimeFromDates(new Date(membership.createdAt))}
                      </div>

                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition ease">
                        <Link
                          href={`/${params.team}/access/service-accounts/${sa.id}`}
                          title={`View ${sa.name}`}
                        >
                          <Button variant="secondary">
                            <FaExternalLinkAlt /> Manage
                          </Button>
                        </Link>
                        {isTeamOwned ? (
                          canDeleteSA && (
                            <DeleteServiceAccountDialog account={sa} onDelete={() => {}} />
                          )
                        ) : (
                          canUpdateTeam && (
                            <RemoveTeamMemberDialog
                              teamId={team.id}
                              memberId={sa.id}
                              memberName={sa.name || 'Service Account'}
                              memberType="SERVICE"
                            />
                          )
                        )}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="py-8 text-center text-neutral-500">
                  No service accounts in this team.
                  {canCreateSA && ' Create a team-owned service account or add an existing one.'}
                </div>
              )
            })()}
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
            {canUpdateTeam && <AddTeamAppsDialog team={team} />}
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
                    <div className="text-xs text-zinc-700 dark:text-zinc-300">
                      {envs.map((tae, i) => (
                        <span key={tae.id}>
                          <Link
                            href={`/${params.team}/apps/${appId}/environments/${tae.environment!.id}`}
                            className="hover:text-emerald-500 dark:hover:text-emerald-400 transition"
                          >
                            {tae.environment!.name}
                          </Link>
                          {i < envs.length - 1 && ' + '}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition ease">
                    <Link
                      href={`/${params.team}/apps/${appId}/access/teams`}
                      title={`Manage team access to ${app.name}`}
                    >
                      <Button variant="secondary" icon={FaCog}>
                        Manage
                      </Button>
                    </Link>
                    {canUpdateTeam && (
                      <RemoveTeamAppDialog
                        teamId={team.id}
                        teamName={team.name}
                        appId={appId}
                        appName={app.name}
                      />
                    )}
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

        {/* Ownership */}
        {(userIsGlobalAccess || isTeamOwner) && (
          <div className="pt-4 space-y-3 border-t border-neutral-500/40">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-base font-medium">Ownership</div>
                <div className="text-neutral-500 text-sm">
                  {team.owner ? (
                    <>
                      Owned by{' '}
                      <span className="text-zinc-900 dark:text-zinc-100">
                        {team.owner.fullName || team.owner.email}
                      </span>
                    </>
                  ) : (
                    'This team has no owner. Assign one to enable owner-level management.'
                  )}
                </div>
              </div>
              <TransferTeamOwnershipDialog team={team} />
            </div>
          </div>
        )}

        {/* Danger Zone */}
        {canDeleteTeam && !team.isScimManaged && (userIsGlobalAccess || isTeamOwner) && (
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
