'use client'

import { RoleType } from '@/apollo/graphql'
import { CreateRoleDialog } from '@/components/access/CreateRoleDialog'
import { DeleteRoleDialog } from '@/components/access/DeleteRoleDialog'
import { ManageRoleDialog } from '@/components/access/ManageRoleDialog'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { FaLock } from 'react-icons/fa'

export default function Roles({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const ownerRole = roleData?.roles.find((role: RoleType) => role.name === 'Owner')

  const userCanDeleteRoles = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Roles', 'delete')
    : false

  return (
    <section className="overflow-y-auto h-full">
      <div className="w-full space-y-10 py-8 text-black dark:text-white">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{params.team} Roles</h2>
          <p className="text-neutral-500">Manage organisation roles.</p>
        </div>
        <div className="space-y-4">
          <div className="flex justify-end">
            <CreateRoleDialog />
          </div>

          <table className="table-auto min-w-full divide-y divide-zinc-500/40">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-500/40">
              {roleData?.roles.map((role: RoleType) => (
                <tr key={role.id}>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="text-lg font-medium flex items-center gap-2">
                        {role.name} {role.isDefault && <FaLock className="text-neutral-500" />}
                      </div>
                      <span className="text-neutral-500 text-sm">{role.description}</span>
                    </div>
                  </td>

                  <td className="px-6 py-4 flex items-center justify-end gap-2">
                    <ManageRoleDialog role={role} ownerRole={ownerRole} />
                    {!role.isDefault && userCanDeleteRoles && <DeleteRoleDialog role={role} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
