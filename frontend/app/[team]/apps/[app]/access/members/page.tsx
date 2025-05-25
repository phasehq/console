'use client'

import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { OrganisationMemberType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { FaBan } from 'react-icons/fa'
import { useSession } from 'next-auth/react'
import { Avatar } from '@/components/common/Avatar'
import { userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { AddMemberDialog } from './_components/AddMemberDialog'
import { RemoveMemberConfirmDialog } from './_components/RemoveMemberDialog'
import { ManageUserAccessDialog } from './_components/ManageUserAccessDialog'

export default function Members({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

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
        <div className="text-neutral-500">Manage access for human users to this App</div>
      </div>
      {userCanReadAppMembers ? (
        <div className="space-y-4">
          {userCanAddAppMembers && (
            <div className="flex justify-end">
              <AddMemberDialog appId={params.app} />
            </div>
          )}

          <table className="table-auto min-w-full divide-y divide-zinc-500/40">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>

                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment Access
                </th>
                {userCanRemoveAppMembers && <th className="px-6 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {data?.appUsers.map((member: OrganisationMemberType) => (
                <tr className="group" key={member.id}>
                  <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                    <Avatar member={member} size="lg" />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-medium">
                          {member.fullName || member.email}
                        </span>
                        <RoleLabel role={member.role!} />
                      </div>
                      {member.fullName && (
                        <span className="text-neutral-500 text-sm">{member.email}</span>
                      )}
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <ManageUserAccessDialog appId={params.app} member={member} />
                  </td>

                  {userCanRemoveAppMembers && (
                    <td className="px-6 py-4">
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
    </div>
  )
}
