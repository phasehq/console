'use client'

import { ServiceAccountType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useMemo, useState } from 'react'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import { Dialog, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { useMutation, useQuery } from '@apollo/client'
import GetOrganisationIdentities from '@/graphql/queries/identities/getOrganisationIdentities.gql'
import { GetServiceAccountDetail } from '@/graphql/queries/service-accounts/getServiceAccountDetail.gql'
import { toast } from 'react-toastify'
import { KeyManagementDialog } from '@/components/service-accounts/KeyManagementDialog'
import UpdateServiceAccount from '@/graphql/mutations/service-accounts/updateServiceAccount.gql'
import { TbLockShare } from 'react-icons/tb'
import { FaSearch, FaTimesCircle, FaServer } from 'react-icons/fa'
import clsx from 'clsx'

export const ServiceAccountIdentities = ({ account }: { account: ServiceAccountType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [isOpen, setIsOpen] = useState(false)
  const { data } = useQuery(GetOrganisationIdentities, {
    variables: { organisationId: organisation?.id },
    skip: !organisation,
  })

  const [updateAccount, { loading }] = useMutation(UpdateServiceAccount)

  const orgIdentities: any[] = data?.identities ?? []
  const initialSelected = new Set<string>(
    (account as any).identities?.map((i: any) => i.id as string) ?? []
  )
  const [selected, setSelected] = useState<Set<string>>(initialSelected)
  const [searchQuery, setSearchQuery] = useState('')

  const toggle = (id: string) => {
    const s = new Set(selected)
    s.has(id) ? s.delete(id) : s.add(id)
    setSelected(s)
  }

  const open = () => {
    if (!account.serverSideKeyManagementEnabled) {
      const dlg = document.getElementById('sa-kms-dialog')
    }
    setIsOpen(true)
  }
  const close = () => setIsOpen(false)

  // Filter identities based on search query
  const filteredIdentities = orgIdentities.filter(
    (identity: any) =>
      identity.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      identity.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSave = async () => {
    await updateAccount({
      variables: {
        serviceAccountId: account.id,
        name: account.name,
        roleId: account.role!.id,
        identityIds: Array.from(selected),
      },
      refetchQueries: [
        { query: GetServiceAccountDetail, variables: { orgId: organisation?.id, id: account.id } },
      ],
    })
    close()
    toast.success('Updated identities for this account')
  }

  if (!account.serverSideKeyManagementEnabled) {
    return (
      <div className="py-8">
        {/* Server-side key management is required state */}
        <div className="text-xl font-semibold mb-2">External Identities</div>
        <div className="text-neutral-500 mb-4">
          Manage which external identities are trusted for this account
        </div>
        <EmptyState
          title="Enable server-side key management"
          subtitle="External identities require server-side key management to manage access tokens for Service Accounts."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaServer />
            </div>
          }
        >
          <KeyManagementDialog serviceAccount={account} />
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="py-4">
      <div className="space-y-2">
        <div className="space-y-1">
          <div className="text-xl font-semibold">External Identities</div>
          <div className="flex items-center justify-between">
            <div className="text-neutral-500">
              Manage which external identities are trusted for this account
            </div>
            {(account as any).identities && (account as any).identities.length > 0 && (
              <Button variant="primary" onClick={() => setIsOpen(true)}>
                <TbLockShare /> Manage identities
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {(account as any).identities && (account as any).identities.length > 0 ? (
            <div className="divide-y divide-neutral-500/20 py-6">
              {(account as any).identities.map((identity: any) => (
                <div key={identity.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex items-center gap-2">
                    <div className="text-neutral-500 text-xl">
                      <ProviderIcon providerId="aws" />
                    </div>
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                      {identity.name}
                    </div>
                  </div>
                  <div className="text-sm text-neutral-500 truncate max-w-md">
                    {identity.description}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No identities"
              subtitle="No identities are enabled for this account."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <TbLockShare />
                </div>
              }
            >
              <Button variant="primary" onClick={() => setIsOpen(true)}>
                <TbLockShare /> Manage identities
              </Button>
            </EmptyState>
          )}
        </div>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={close}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
          </Transition.Child>
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-3xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-black dark:text-white "
                  >
                    Manage identities
                  </Dialog.Title>
                  <div className="py-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full max-w-sm">
                        <div className="">
                          <FaSearch className="text-neutral-500" />
                        </div>
                        <input
                          placeholder="Search identities"
                          className="custom bg-zinc-100 dark:bg-zinc-800"
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
                    </div>
                    <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
                      <thead>
                        <tr>
                          <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Provider
                          </th>
                          <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Description
                          </th>
                          <th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Enabled
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-500/20">
                        {filteredIdentities.map((idn: any) => (
                          <tr key={idn.id} className="group">
                            <td className="text-zinc-900 dark:text-zinc-100 font-medium inline-flex items-center gap-1 break-word">
                              <div className="text-xl">
                                <ProviderIcon providerId="aws" />
                              </div>
                            </td>
                            <td className="px-6 py-4">{idn.name}</td>
                            <td className="px-6 py-4 text-neutral-500">{idn.description}</td>
                            <td className="px-6 py-4 flex items-center justify-end gap-2">
                              <ToggleSwitch
                                value={selected.has(idn.id)}
                                onToggle={() => toggle(idn.id)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-between mt-4">
                      <Button variant="secondary" onClick={close}>
                        Cancel
                      </Button>
                      <Button variant="primary" onClick={handleSave} isLoading={loading}>
                        Save
                      </Button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  )
}
