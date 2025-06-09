'use client'

import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { useQuery } from '@apollo/client'
import { useContext, useState } from 'react'
import { OrganisationMemberType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { FaBan, FaSearch, FaTimesCircle } from 'react-icons/fa'
import { useSession } from 'next-auth/react'
import { Avatar } from '@/components/common/Avatar'
import { userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { AddMemberDialog } from './_components/AddMemberDialog'
import { RemoveMemberConfirmDialog } from './_components/RemoveMemberDialog'
import { ManageUserAccessDialog } from './_components/ManageUserAccessDialog'
import clsx from 'clsx'
import { MdSearchOff } from 'react-icons/md'

export default function Members({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [searchQuery, setSearchQuery] = useState('')

  // Permissions
  const userCanReadAppMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'read', true)
    : false

  // AppMembers:create + OrgMembers: read
  const userCanAddAppMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'create', true) &&
      userHasPermission(organisation?.role?.permissions, 'Members', 'read')
    : false
  const userCanRemoveAppMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', true)
    : false

  const { data, loading } = useQuery(GetAppMembers, {
    variables: { appId: params.app },
    skip: !userCanReadAppMembers,
  })

  const { data: session } = useSession()

  const filteredMembers = data?.appUsers
    ? searchQuery !== ''
      ? data?.appUsers.filter(
          (member: OrganisationMemberType) =>
            member.fullName?.toLowerCase().includes(searchQuery) ||
            member.email?.includes(searchQuery.toLowerCase())
        )
      : data?.appUsers
    : []

  if (!organisation || loading)
    return (
      <div className="h-full max-h-screen overflow-y-auto w-full flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="w-full space-y-6 text-black dark:text-white">
      <div className="px-4">
        <h2 className="text-xl font-bold">Members</h2>
        <div className="text-neutral-500">Manage access for human users in this App</div>
      </div>
      {userCanReadAppMembers ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between pl-4">
            <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2  w-full max-w-sm">
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

            {userCanAddAppMembers && (
              <div className="flex justify-end">
                <AddMemberDialog appId={params.app} />
              </div>
            )}
          </div>

          <table className="table-auto min-w-full divide-y divide-zinc-500/40">
            <thead>
              <tr>
                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>

                <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment Access
                </th>
                {userCanRemoveAppMembers && <th className="px-6 py-2"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {filteredMembers.map((member: OrganisationMemberType) => (
                <tr className="group" key={member.id}>
                  <td className="px-6 py-3 whitespace-nowrap flex items-center gap-2">
                    <Avatar member={member} size="lg" />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{member.fullName || member.email}</span>
                        <RoleLabel role={member.role!} />
                      </div>
                      {member.fullName && (
                        <span className="text-neutral-500 text-sm">{member.email}</span>
                      )}
                    </div>
                  </td>

                  <td className="px-6 py-2">
                    <ManageUserAccessDialog appId={params.app} member={member} />
                  </td>

                  {userCanRemoveAppMembers && (
                    <td className="px-6 py-2">
                      {member.email !== session?.user?.email &&
                        member.role!.name!.toLowerCase() !== 'owner' && (
                          <div className="flex items-center justify-end gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition ease">
                            <RemoveMemberConfirmDialog appId={params.app} member={member} />
                          </div>
                        )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Members in this app."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      )}

      {searchQuery && filteredMembers?.length === 0 && (
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
  )
}
