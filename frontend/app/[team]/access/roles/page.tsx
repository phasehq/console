'use client'

import { RoleType } from '@/apollo/graphql'
import { CreateRoleDialog } from '@/components/access/CreateRoleDialog'
import { DeleteRoleDialog } from '@/components/access/DeleteRoleDialog'
import { ManageRoleDialog } from '@/components/access/ManageRoleDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { FaBan, FaLock } from 'react-icons/fa'

export default function Roles({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadRoles = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Roles', 'read')
    : false

  const userCanCreateRoles = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Roles', 'create')
    : false

  const userCanDeleteRoles = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Roles', 'delete')
    : false

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation || !userCanReadRoles,
  })

  const ownerRole = roleData?.roles.find((role: RoleType) => role.name === 'Owner')

  return (
    <section className="overflow-y-auto">
      <div className="w-full space-y-4 text-black dark:text-white">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{params.team} Roles</h2>
          <p className="text-neutral-500">Manage organisation roles.</p>
        </div>
        <div className="space-y-4">
          {userCanCreateRoles && (
            <div className="flex justify-end">
              <CreateRoleDialog />
            </div>
          )}

          {userCanReadRoles ? (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th></th>

                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {roleData?.roles.map((role: RoleType) => (
                  <tr key={role.id} className="group">
                    <td>
                      <RoleLabel role={role} size="md" />
                    </td>

                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="font-semibold flex items-center gap-2">
                          {role.name}{' '}
                          {role.isDefault && (
                            <FaLock
                              title="This role is managed by Phase and cannot be edited"
                              className="text-neutral-500"
                            />
                          )}
                        </div>

                        <div className="text-neutral-500 text-sm">{role.description}</div>
                      </div>
                    </td>

                    <td className="px-6 py-4 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition ease">
                      <ManageRoleDialog role={role} ownerRole={ownerRole} />
                      {!role.isDefault && userCanDeleteRoles && <DeleteRoleDialog role={role} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view roles in this organisation."
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
      </div>
    </section>
  )
}
