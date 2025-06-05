'use client'

import { GetAppServiceAccounts } from '@/graphql/queries/apps/getAppServiceAccounts.gql'
import { useQuery } from '@apollo/client'
import { useContext, useState } from 'react'
import { ServiceAccountType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { FaBan, FaRobot, FaSearch, FaTimesCircle } from 'react-icons/fa'
import { userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { AddAccountDialog } from './_components/AddAccountDialog'
import { RemoveAccountConfirmDialog } from './_components/RemoveAccountDialog'
import { ManageAccountAccessDialog } from './_components/ManageAccountAccessDialog'
import { MdSearchOff } from 'react-icons/md'
import clsx from 'clsx'
import { Avatar } from '@/components/common/Avatar'

export default function ServiceAccounts({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [searchQuery, setSearchQuery] = useState('')

  // Permissions
  const userCanReadAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read', true)
    : false

  // AppServiceAccounts:create + ServiceAccounts: read
  const userCanAddAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'create', true) &&
      userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false
  const userCanRemoveAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'delete', true)
    : false

  const { data, loading } = useQuery(GetAppServiceAccounts, {
    variables: { appId: params.app },
    skip: !userCanReadAppSA,
  })

  const filteredAccounts = data?.appServiceAccounts
    ? searchQuery !== ''
      ? data?.appServiceAccounts.filter((account: ServiceAccountType) =>
          account.name?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : data?.appServiceAccounts
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
        <h2 className="text-xl font-bold">Service Accounts</h2>
        <div className="text-neutral-500">Manage access for service accounts in this App</div>
      </div>
      {userCanReadAppSA ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between pl-4">
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

            {userCanAddAppSA && data?.appServiceAccounts.length > 0 && (
              <div className="flex justify-end">
                <AddAccountDialog appId={params.app} />
              </div>
            )}
          </div>

          {data?.appServiceAccounts.length === 0 ? (
            <EmptyState
              title="No accounts added"
              subtitle="No Service Accounts have been added to this App yet. Add an account below."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <FaRobot />
                </div>
              }
            >
              <>
                <AddAccountDialog appId={params.app} />
              </>
            </EmptyState>
          ) : (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40">
              <thead>
                <tr>
                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Account
                  </th>

                  <th className="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Environment Access
                  </th>
                  {userCanRemoveAppSA && <th className="px-6 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-500/20">
                {filteredAccounts.map((account: ServiceAccountType) => (
                  <tr className="group" key={account.id}>
                    <td className="px-6 py-3 whitespace-nowrap flex items-center gap-2">
                      <Avatar serviceAccount={account} size="lg" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{account.name}</span>
                          <RoleLabel role={account.role!} />
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2 ">
                        <ManageAccountAccessDialog appId={params.app} account={account} />
                      </div>
                    </td>

                    {userCanRemoveAppSA && (
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition ease">
                          <RemoveAccountConfirmDialog appId={params.app} account={account} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
  )
}
