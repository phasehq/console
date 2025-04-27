'use client'

import { NetworkAccessPolicyType } from '@/apollo/graphql'
import { EmptyState } from '@/components/common/EmptyState'
import { organisationContext } from '@/contexts/organisationContext'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { FaBan, FaCheckCircle, FaNetworkWired } from 'react-icons/fa'
import { CreateNetworkAccessPolicyDialog } from './_components/CreateNetworkPolicyDialog'
import { IPChip } from './_components/IPChip'
import { UpdateNetworkAccessPolicyDialog } from './_components/UpdateNetworkPolicyDialog'
import { DeleteNetworkAccessPolicyDialog } from './_components/DeleteNetworkPolicyDialog'
import { ManageOrgGlobalPolicies } from './_components/ManageOrgGlobalPolicies'
import { UpdateAccountNetworkPolicies } from '@/components/access/UpdateAccountNetworkPolicies'
import { relativeTimeFromDates } from '@/utils/time'

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

  const allPolicies = data?.networkAccessPolicies ?? []

  const globalPolicies =
    allPolicies.filter((policy: NetworkAccessPolicyType) => policy.isGlobal) ?? []

  return (
    <section className="overflow-y-auto space-y-8 divide-y divide-neutral-500/60">
      <div className="w-full space-y-2 text-zinc-900 dark:text-zinc-100">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{params.team} Network Access Policies</h2>
          <p className="text-neutral-500">Manage organisation Network Access Policies.</p>
        </div>
        <div className="space-y-4">
          {userCanCreateNetworkPolicies && allPolicies.length > 0 && (
            <div className="flex justify-end">
              <CreateNetworkAccessPolicyDialog clientIp={data?.clientIp} />
            </div>
          )}

          {userCanReadNetworkPolicies ? (
            allPolicies.length > 0 ? (
              <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
                <thead>
                  <tr>
                    <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>

                    <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Allowlist
                    </th>

                    <th></th>

                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-500/20">
                  {data?.networkAccessPolicies.map((policy: NetworkAccessPolicyType) => (
                    <tr key={policy.id} className="group">
                      <td className="text-zinc-900 dark:text-zinc-100 font-medium">
                        {policy.name}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex gap-2 flex-wrap">
                          {policy.allowedIps.split(',').map((ip) => (
                            <IPChip key={ip} ip={ip}></IPChip>
                          ))}
                        </div>
                      </td>

                      <td className="px-6 py-2 text-neutral-500 text-xs whitespace-nowrap">
                        <div className="space-y-2">
                          <div>Updated {relativeTimeFromDates(new Date(policy.updatedAt))}</div>
                          <div>Created {relativeTimeFromDates(new Date(policy.createdAt))}</div>
                        </div>
                      </td>

                      <td className="px-6 py-4 flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition ease">
                        <UpdateNetworkAccessPolicyDialog
                          policy={policy}
                          clientIp={data?.clientIp}
                        />
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
                title="No policies"
                subtitle="There are no network policies created yet. Click below to create one."
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaNetworkWired />
                  </div>
                }
              >
                <CreateNetworkAccessPolicyDialog clientIp={data?.clientIp} />
              </EmptyState>
            )
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

      {allPolicies.length > 0 && (
        <div className="w-full space-y-2 text-zinc-900 dark:text-zinc-100 py-8">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Global Policies</h2>
            <p className="text-neutral-500">
              Manage Network Access Policies that are applied globally to all user and service
              accounts.
            </p>
          </div>
          <div className="space-y-4">
            {userCanCreateNetworkPolicies && globalPolicies.length > 0 && (
              <div className="flex justify-end">
                <ManageOrgGlobalPolicies />
              </div>
            )}

            {userCanReadNetworkPolicies ? (
              globalPolicies.length > 0 ? (
                <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
                  <thead>
                    <tr>
                      <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>

                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Allowlist
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-500/20">
                    {globalPolicies.map((policy: NetworkAccessPolicyType) => (
                      <tr key={policy.id} className="group">
                        <td className="text-zinc-900 dark:text-zinc-100 font-medium whitespace-nowrap">
                          {policy.name}
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex gap-2 flex-wrap">
                            {policy.allowedIps.split(',').map((ip) => (
                              <IPChip key={ip} ip={ip}></IPChip>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No Global Polices"
                  subtitle={
                    <>
                      There are no global policies set for your organisation.
                      <br /> Access is allowed from any IP address{' '}
                      <span className="font-semibold font-mono">(0.0.0.0/0, ::/0)</span> for any
                      accounts that do not have an explicit network access policy
                    </>
                  }
                  graphic={
                    <div className="text-neutral-300 dark:text-neutral-700 text-5xl text-center">
                      <FaNetworkWired />
                    </div>
                  }
                >
                  <ManageOrgGlobalPolicies />
                </EmptyState>
              )
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
      )}
    </section>
  )
}
