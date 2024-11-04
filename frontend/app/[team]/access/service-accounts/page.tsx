'use client'

import { ServiceAccountType } from '@/apollo/graphql'
import { EmptyState } from '@/components/common/EmptyState'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import { useContext } from 'react'
import { FaBan, FaChevronRight } from 'react-icons/fa'
import { CreateServiceAccountDialog } from './_components/CreateServiceAccountDialog'
import { FaRobot } from 'react-icons/fa6'
import { relativeTimeFromDates } from '@/utils/time'
import Link from 'next/link'
import { Button } from '@/components/common/Button'
import { ServiceAccountRoleSelector } from './_components/RoleSelector'

export default function ServiceAccounts({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false

  const userCanCreateSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'create')
    : false

  const { data, loading } = useQuery(GetServiceAccounts, {
    variables: { orgId: organisation?.id },
    skip: !organisation || !userCanReadSA,
  })

  return (
    <section className="overflow-y-auto">
      <div className="w-full space-y-4 text-zinc-900 dark:text-zinc-100">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{params.team} Service Accounts</h2>
          <p className="text-neutral-500">Manage service accounts.</p>
        </div>
        <div className="space-y-4">
          {userCanCreateSA && (
            <div className="flex justify-end">
              <CreateServiceAccountDialog />
            </div>
          )}

          {userCanReadSA ? (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Account name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {data?.serviceAccounts.map((account: ServiceAccountType) => (
                  <tr key={account.id} className="group">
                    <td className="flex items-center gap-2 py-4">
                      <div className="rounded-full flex items-center bg-neutral-500/40 justify-center size-10">
                        <FaRobot className="shrink-0 text-zinc-900 dark:text-zinc-100 text-xl" />
                      </div>
                      {account.name}
                    </td>

                    <td className="px-6 py-4">
                      <ServiceAccountRoleSelector account={account} />
                    </td>

                    <td className="px-6 py-4">
                      {relativeTimeFromDates(new Date(account.createdAt))}
                    </td>

                    <td className="px-6 py-4">
                      <Link href={`/${params.team}/access/service-accounts/${account.id}`}>
                        <Button variant="secondary">
                          Manage <FaChevronRight />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view service accounts in this organisation."
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
