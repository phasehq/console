'use client'

import { ServiceAccountType } from '@/apollo/graphql'
import { EmptyState } from '@/components/common/EmptyState'
import { organisationContext } from '@/contexts/organisationContext'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import { useContext, useState } from 'react'
import { FaBan, FaChevronRight, FaSearch, FaTimesCircle } from 'react-icons/fa'
import { CreateServiceAccountDialog } from './_components/CreateServiceAccountDialog'
import { FaRobot } from 'react-icons/fa6'
import { relativeTimeFromDates } from '@/utils/time'
import Link from 'next/link'
import { Button } from '@/components/common/Button'
import { ServiceAccountRoleSelector } from './_components/RoleSelector'
import clsx from 'clsx'
import { MdSearchOff } from 'react-icons/md'

export default function ServiceAccounts({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [searchQuery, setSearchQuery] = useState('')

  const userCanReadSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false

  const userCanCreateSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'create')
    : false

  const { data } = useQuery(GetServiceAccounts, {
    variables: { orgId: organisation?.id },
    skip: !organisation || !userCanReadSA,
    fetchPolicy: 'cache-and-network',
  })

  const filteredAccounts = data?.serviceAccounts
    ? searchQuery !== ''
      ? data?.serviceAccounts.filter((account: ServiceAccountType) =>
          account.name?.includes(searchQuery)
        )
      : data?.serviceAccounts
    : []

  return (
    <section className="overflow-y-auto">
      <div className="w-full space-y-4 text-zinc-900 dark:text-zinc-100">
        <div>
          <h2 className="text-xl font-semibold">{params.team} Service Accounts</h2>
          <p className="text-neutral-500">Manage service accounts.</p>
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

            {userCanCreateSA && data?.serviceAccounts.length > 0 && (
              <div className="flex justify-end">
                <CreateServiceAccountDialog />
              </div>
            )}
          </div>

          {userCanReadSA ? (
            data?.serviceAccounts.length === 0 ? (
              <EmptyState
                title="No Service Accounts"
                subtitle="Click the button below to create a new Service Account"
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaRobot />
                  </div>
                }
              >
                <>
                  <CreateServiceAccountDialog />
                </>
              </EmptyState>
            ) : (
              <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
                <thead>
                  <tr>
                    <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Account
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
                  {filteredAccounts.map((account: ServiceAccountType) => (
                    <tr key={account.id} className="group">
                      <td className="flex items-center gap-2 py-2">
                        <div className="rounded-full flex items-center bg-neutral-500/40 justify-center size-8">
                          <FaRobot className="shrink-0 text-zinc-900 dark:text-zinc-100 text-xl" />
                        </div>
                        <div>
                          <div className="font-medium">{account.name}</div>
                          <div className="text-sm text-neutral-500">{account.id}</div>
                        </div>
                      </td>

                      <td className="px-6 py-2">
                        <ServiceAccountRoleSelector account={account} displayOnly={true} />
                      </td>

                      <td className="px-6 py-2 text-sm">
                        {relativeTimeFromDates(new Date(account.createdAt))}
                      </td>

                      <td className="px-6 py-2 text-right">
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
            )
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

          {searchQuery && filteredAccounts.length === 0 && (
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
