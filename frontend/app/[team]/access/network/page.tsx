'use client'

import { NetworkAccessPolicyType } from '@/apollo/graphql'
import { EmptyState } from '@/components/common/EmptyState'
import { organisationContext } from '@/contexts/organisationContext'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { FaBan, FaCheckCircle } from 'react-icons/fa'
import { CreateNetworkAccessPolicyDialog } from './_components/CreateNetworkPolicyDialog'
import { IPChip } from './_components/IPChip'
import { UpdateNetworkAccessPolicyDialog } from './_components/UpdateNetworkPolicyDialog'
import { DeleteNetworkAccessPolicyDialog } from './_components/DeleteNetworkPolicyDialog'

export default function NetworkPolicies({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadNetworkPolicies = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'read')
    : false

  const userCanCreateNetworkPolicies = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'create')
    : false

  const userCanDeleteNetworkPolicies = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'delete')
    : false

  const { data, loading } = useQuery(GetNetworkPolicies, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadNetworkPolicies,
  })

  return (
    <section className="overflow-y-auto">
      <div className="w-full space-y-4 text-black dark:text-white">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{params.team} Network Access Policies</h2>
          <p className="text-neutral-500">Manage organisation Network Access Policies.</p>
        </div>
        <div className="space-y-4">
          {userCanCreateNetworkPolicies && (
            <div className="flex justify-end">
              <CreateNetworkAccessPolicyDialog />
            </div>
          )}

          {userCanReadNetworkPolicies ? (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
              <thead>
                <tr>
                  <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Global
                  </th>
                  <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    IPs
                  </th>

                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {data?.networkAccessPolicies.map((policy: NetworkAccessPolicyType) => (
                  <tr key={policy.id} className="group">
                    <td className="text-zinc-900 dark:text-zinc-100 font-medium">{policy.name}</td>

                    <td className="px-6 py-4">
                      {policy.isGlobal && <FaCheckCircle className="text-emerald-500" />}
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex gap-2 flex-wrap">
                        {policy.allowedIps.split(',').map((ip) => (
                          <IPChip key={ip} ip={ip}></IPChip>
                        ))}
                      </div>
                    </td>

                    <td className="px-6 py-4 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition ease">
                      <UpdateNetworkAccessPolicyDialog policy={policy} />
                      {userCanDeleteNetworkPolicies && (
                        <DeleteNetworkAccessPolicyDialog policy={policy} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view Network Access Policies in this organisation."
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
