'use client'

import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import GetInvites from '@/graphql/queries/organisation/getInvites.gql'
import { useQuery } from '@apollo/client'
import { useContext, useState } from 'react'
import { OrganisationMemberInviteType, OrganisationMemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { inviteIsExpired, relativeTimeFromDates } from '@/utils/time'
import { FaBan, FaChevronRight, FaSearch, FaTimesCircle, FaCopy } from 'react-icons/fa'
import clsx from 'clsx'
import Link from 'next/link'
import { Avatar } from '@/components/common/Avatar'
import { RoleLabel } from '@/components/users/RoleLabel'
import { getInviteLink } from '@/utils/crypto'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { InviteDialog } from './_components/InviteDialog'
import { MdSearchOff } from 'react-icons/md'
import CopyButton from '@/components/common/CopyButton'
import { DeleteInviteDialog } from './_components/DeleteInviteDialog'

export default function Members({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [searchQuery, setSearchQuery] = useState('')

  const userCanInviteMembers = organisation
    ? userHasPermission(organisation.role!.permissions, 'Members', 'create')
    : false

  const userCanReadMembers = organisation
    ? userHasPermission(organisation.role!.permissions, 'Members', 'read')
    : false

  const { data: membersData } = useQuery(GetOrganisationMembers, {
    variables: {
      organisationId: organisation?.id,
      role: null,
    },
    pollInterval: 5000,
    skip: !organisation || !userCanReadMembers,
  })

  const { data: invitesData } = useQuery(GetInvites, {
    variables: {
      orgId: organisation?.id,
    },
    pollInterval: 5000,
    skip: !organisation,
  })

  const filteredMembers = membersData?.organisationMembers
    ? searchQuery !== ''
      ? membersData?.organisationMembers.filter(
          (member: OrganisationMemberType) =>
            member.fullName?.includes(searchQuery) || member.email?.includes(searchQuery)
        )
      : membersData?.organisationMembers
    : []

  const sortedInvites: OrganisationMemberInviteType[] =
    invitesData?.organisationInvites
      ?.slice() // Create a shallow copy of the array to avoid modifying the original
      .sort((a: OrganisationMemberInviteType, b: OrganisationMemberInviteType) => {
        // Compare the createdAt timestamps in descending order
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }) || []

  const filteredInvites =
    searchQuery !== ''
      ? sortedInvites.filter((invite: OrganisationMemberInviteType) =>
          invite.inviteeEmail.toLowerCase()?.includes(searchQuery.toLowerCase())
        )
      : sortedInvites

  if (!organisation)
    return (
      <div className="flex items-center justify-center p-10">
        <Spinner size="md" />
      </div>
    )

  return (
    <section className="overflow-y-auto h-full">
      <div className="w-full space-y-4 text-zinc-900 dark:text-zinc-100">
        <div>
          <h2 className="text-xl font-semibold">{params.team} Members</h2>
          <p className="text-neutral-500">Manage organisation members.</p>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full max-w-sm">
              <div className="">
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

            {userCanInviteMembers && (
              <div className="flex justify-end">
                <InviteDialog organisationId={organisation!.id} />
              </div>
            )}
          </div>

          {userCanReadMembers && membersData ? (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
              <thead>
                <tr>
                  <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {filteredMembers.map((member: OrganisationMemberType) => (
                  <tr key={member.id} className="group">
                    <td className="py-2 flex items-center gap-2">
                      <Avatar member={member} size="md" />
                      <div>
                        <div className="font-medium">
                          {member.fullName || member.email} {member.self && ' (You)'}
                        </div>
                        {member.fullName && (
                          <div className="text-sm text-neutral-500">{member.email}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-2 text-sm">
                      <RoleLabel role={member.role!} />
                    </td>
                    <td className="px-6 py-2 text-sm">
                      {relativeTimeFromDates(new Date(member.createdAt))}
                    </td>
                    <td className="px-6 py-2 whitespace-nowrap text-right">
                      <Link href={`/${params.team}/access/members/${member.id}`}>
                        <Button variant="secondary">
                          Manage <FaChevronRight />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
                {filteredInvites.map((invite: OrganisationMemberInviteType) => (
                  <tr key={invite.id}>
                    <td className="py-3 flex items-center gap-2 opacity-60">
                      <Avatar user={{ email: invite.inviteeEmail }} size="md" />

                      <div>
                        <div className="font-medium">
                          {invite.inviteeEmail}{' '}
                          <span className="text-sm text-neutral-500">
                            (invited by{' '}
                            {invite.invitedBy.self
                              ? 'You'
                              : invite.invitedBy.fullName || invite.invitedBy.email}
                            )
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-2 text-sm opacity-60">
                      {invite.role && <RoleLabel role={invite.role} />}
                    </td>
                    <td
                      className={clsx(
                        'px-6 py-3 text-sm',
                        inviteIsExpired(invite) ? 'text-red-500' : 'text-amber-500'
                      )}
                    >
                      {inviteIsExpired(invite)
                        ? `Expired ${relativeTimeFromDates(new Date(invite.expiresAt))}`
                        : `Invited ${relativeTimeFromDates(new Date(invite.createdAt))}`}
                    </td>
                    <td className="px-6 py-3 flex items-center justify-end gap-2">
                      {!inviteIsExpired(invite) && (
                        <CopyButton value={getInviteLink(invite.id)}>
                          <div className="flex items-center gap-2">
                            <FaCopy /> Invite link
                          </div>
                        </CopyButton>
                      )}

                      <DeleteInviteDialog invite={invite} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view members in this organisation."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <FaBan />
                </div>
              }
            >
              <></>
            </EmptyState>
          )}

          {searchQuery && filteredMembers?.length === 0 && filteredInvites.length === 0 && (
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
