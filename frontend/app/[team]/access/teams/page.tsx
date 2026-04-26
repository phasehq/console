'use client'

import { TeamType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { userHasPermission, userHasGlobalAccess } from '@/utils/access/permissions'
import { relativeTimeFromDates } from '@/utils/time'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { useContext, useState } from 'react'
import {
  FaBan,
  FaChevronRight,
  FaSearch,
  FaTimesCircle,
  FaUsers,
  FaRobot,
} from 'react-icons/fa'
import { ProfileCard } from '@/components/common/ProfileCard'
import { MdSearchOff } from 'react-icons/md'
import clsx from 'clsx'
import { CreateTeamDialog } from './_components/CreateTeamDialog'
import { RoleLabel } from '@/components/users/RoleLabel'

export default function Teams({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [searchQuery, setSearchQuery] = useState('')

  const userCanReadTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'read')
    : false

  const userCanCreateTeams = organisation
    ? userHasPermission(organisation.role!.permissions, 'Teams', 'create')
    : false

  const userIsGlobalAccess = organisation
    ? userHasGlobalAccess(organisation.role!.permissions)
    : false

  const { data, loading } = useQuery(GetTeams, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadTeams,
    pollInterval: 10000,
  })

  const teams: TeamType[] = data?.teams || []

  const filteredTeams =
    searchQuery !== ''
      ? teams.filter(
          (team: TeamType) =>
            team.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            team.description?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : teams

  if (!organisation)
    return (
      <div className="flex items-center justify-center p-10">
        <Spinner size="md" />
      </div>
    )

  return (
    <section className="px-3 sm:px-4 lg:px-6">
      <div className="w-full space-y-4 text-zinc-900 dark:text-zinc-100">
        <div>
          <h2 className="text-base font-medium">{params.team} Teams</h2>
          <p className="text-neutral-500 text-sm">
            Manage teams and their access to apps and environments.
          </p>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full max-w-sm">
              <div>
                <FaSearch className="text-neutral-500" />
              </div>
              <input
                placeholder="Search"
                className="custom bg-zinc-100 dark:bg-zinc-800 placeholder:text-neutral-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <FaTimesCircle
                className={clsx(
                  'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2',
                  searchQuery ? 'opacity-100' : 'opacity-0'
                )}
                role="button"
                onClick={() => setSearchQuery('')}
              />
            </div>

            {userCanCreateTeams && (
              <div className="flex justify-end">
                <CreateTeamDialog />
              </div>
            )}
          </div>

          {userCanReadTeams ? (
            loading && !data ? (
              <div className="flex items-center justify-center p-10">
                <Spinner size="md" />
              </div>
            ) : teams.length === 0 ? (
              <EmptyState
                title="No teams yet"
                subtitle="Create a team to manage group-based access to apps and environments."
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaUsers />
                  </div>
                }
              >
                {userCanCreateTeams && <CreateTeamDialog />}
              </EmptyState>
            ) : (
              <table className="table-auto min-w-full divide-y divide-zinc-500/40">
                <thead>
                  <tr>
                    <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Team
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Members
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Apps
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-500/20">
                  {filteredTeams.map((team: TeamType) => {
                    const memberCount =
                      team.members?.filter((m) => m.orgMember).length || 0
                    const saCount =
                      team.members?.filter((m) => m.serviceAccount).length || 0
                    const isMember =
                      userIsGlobalAccess ||
                      team.members?.some((m) => m.orgMember?.id === organisation?.memberId) ||
                      false

                    return (
                      <tr key={team.id} className="group">
                        <td className="py-2">
                          <div>
                            <div className="font-medium flex items-center gap-2">
                              {team.name}
                              {team.isScimManaged && (
                                <span className="inline-flex items-center shrink-0 px-1 py-px rounded text-3xs font-medium bg-blue-500/10 text-blue-500 ring-1 ring-inset ring-blue-500/20">
                                  SCIM
                                </span>
                              )}
                            </div>
                            {team.description && (
                              <div className="text-sm text-neutral-500 truncate max-w-xs">
                                {team.description}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-2">
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
                        <td className="px-6 py-2 text-sm">
                          {team.apps?.length || 0}
                        </td>
                        <td className="px-6 py-2">
                          <div className="space-y-1">
                            <div className="text-2xs text-neutral-500">
                              {relativeTimeFromDates(new Date(team.createdAt))}
                              {team.createdBy && ' by'}
                            </div>
                            {team.createdBy && (
                              <ProfileCard
                                user={{
                                  name: team.createdBy.fullName,
                                  email: team.createdBy.email,
                                  image: team.createdBy.avatarUrl,
                                }}
                                size="sm"
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-2 whitespace-nowrap text-right">
                          {isMember && (
                            <Link href={`/${params.team}/access/teams/${team.id}`}>
                              <Button variant="secondary">
                                Manage <FaChevronRight />
                              </Button>
                            </Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view teams in this organisation."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <FaBan />
                </div>
              }
            >
              <></>
            </EmptyState>
          )}

          {searchQuery && filteredTeams.length === 0 && teams.length > 0 && (
            <EmptyState
              title={`No results for "${searchQuery}"`}
              subtitle="Try adjusting your search term"
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <MdSearchOff />
                </div>
              }
            >
              <></>
            </EmptyState>
          )}
        </div>
      </div>
    </section>
  )
}
