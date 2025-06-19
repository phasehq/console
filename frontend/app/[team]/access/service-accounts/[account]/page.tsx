'use client'

import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { GetServiceAccountDetail } from '@/graphql/queries/service-accounts/getServiceAccountDetail.gql'
import { UpdateServiceAccountOp } from '@/graphql/mutations/service-accounts/updateServiceAccount.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { relativeTimeFromDates } from '@/utils/time'
import { useMutation, useQuery } from '@apollo/client'
import Link from 'next/link'
import { useContext, useEffect, useRef, useState } from 'react'
import {
  FaBan,
  FaBoxOpen,
  FaChevronLeft,
  FaCog,
  FaEdit,
  FaKey,
  FaNetworkWired,
  FaPlus,
  FaRobot,
} from 'react-icons/fa'
import CreateServiceAccountTokenDialog from './_components/CreateServiceAccountTokenDialog'
import { DeleteServiceAccountDialog } from '../_components/DeleteServiceAccountDialog'
import { AddAppButton } from './_components/AddAppsToServiceAccountsButton'
import { ServiceAccountType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { DeleteServiceAccountTokenDialog } from './_components/DeleteServiceAccountTokenDialog'
import { ServiceAccountRoleSelector } from '../_components/RoleSelector'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import CopyButton from '@/components/common/CopyButton'
import { SseLabel } from '@/components/apps/EncryptionModeIndicator'
import clsx from 'clsx'
import { IPChip } from '../../network/_components/IPChip'
import { UpdateAccountNetworkPolicies } from '@/components/access/UpdateAccountNetworkPolicies'

export default function ServiceAccount({ params }: { params: { team: string; account: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [name, setName] = useState('')
  const tokenDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const openTokenDialog = () => tokenDialogRef.current?.openModal()

  const userCanReadSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false

  const userCanReadTokens = organisation
    ? userHasPermission(organisation.role?.permissions, 'ServiceAccountTokens', 'read')
    : false

  const userCanReadAppMemberships = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read', true)
    : false

  const userCanViewNetworkAccess = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'read')
    : false

  const userCanUpdateSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'update')
    : false

  const userCanDeleteSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'delete')
    : false

  const { data, loading } = useQuery(GetServiceAccountDetail, {
    variables: { orgId: organisation?.id, id: params.account },
    skip: !organisation || !userCanReadSA,
    fetchPolicy: 'cache-and-network',
  })

  const [updateAccount] = useMutation(UpdateServiceAccountOp)

  const account: ServiceAccountType = data?.serviceAccounts[0]

  const nameUpdated = account ? account.name !== name : false

  const updateName = async () => {
    if (!userCanUpdateSA) {
      toast.error("You don't have the permissions requried to update Service Accounts")
    }
    await updateAccount({
      variables: {
        serviceAccountId: account.id,
        roleId: account.role!.id,
        name,
      },
      refetchQueries: [
        {
          query: GetServiceAccountDetail,
          variables: { orgId: organisation?.id, id: params.account },
        },
      ],
    })

    toast.success('Updated account name!')
  }

  const resetName = () => setName(account.name)

  useEffect(() => {
    if (account) setName(account.name)
  }, [account])

  if (!userCanReadSA)
    return (
      <section>
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
      </section>
    )

  if (loading)
    return (
      <div>
        <Spinner size="md" />
      </div>
    )

  if (!account)
    return (
      <section>
        <EmptyState
          title="Not found"
          subtitle="This service account doesn't exist or you don't have access to it"
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      </section>
    )

  return (
    <section className="overflow-y-auto">
      <div className="pb-4">
        <Link
          href={`/${params.team}/access/service-accounts`}
          className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
        >
          <FaChevronLeft /> Back to service accounts
        </Link>
      </div>
      <div className="w-full space-y-8 py-4 text-zinc-900 dark:text-zinc-100 divide-y divide-neutral-500/40">
        <div className="text-2xl font-semibold flex items-center gap-2">
          <Avatar serviceAccount={account} size="xl" />
          <div className="flex flex-col">
            <h3 className="relative group w-full max-w-md">
              <input
                className="custom bg-transparent hover:bg-neutral-500/10 rounded-lg transition ease w-full "
                value={name}
                onChange={(e) => setName(e.target.value)}
                readOnly={!userCanUpdateSA}
                maxLength={64}
              />
              {nameUpdated ? (
                <div className="flex items-center inset-y-0 gap-1 absolute right-2 backdrop-blur-sm">
                  <Button variant="secondary" onClick={resetName}>
                    <span className="text-2xs">Discard</span>
                  </Button>
                  <Button variant="primary" onClick={updateName}>
                    <span className="text-2xs">Save</span>
                  </Button>
                </div>
              ) : (
                <div className="flex items-center inset-y-0 gap-1 absolute right-2 opacity-0 group-hover:opacity-100 transition ease ">
                  <FaEdit className="text-neutral-500 text-base" />
                </div>
              )}
            </h3>
            <span className="text-neutral-500 text-sm font-mono pl-2">{account.id}</span>
          </div>
        </div>

        <div className="py-4 space-y-4">
          {/* Header Section */}
          <div>
            <div className="text-xl font-semibold">Role</div>
            <div className="text-neutral-500">Manage the role for this account</div>
          </div>

          {/* Role Selector and Description */}
          <div className="space-y-2">
            <div className="text-lg w-max">
              <ServiceAccountRoleSelector account={account} displayOnly={!userCanUpdateSA} />
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-sm text-neutral-500">
                {account.role?.description || 'No description available for this role'}
              </div>
            </div>
          </div>
        </div>

        <div className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xl font-semibold">App Access</div>
              <div className="text-neutral-500">
                Manage the Apps and Environments that this account has access to
              </div>
            </div>
            {userCanReadAppMemberships && account.appMemberships?.length! > 0 && (
              <AddAppButton
                serviceAccountId={params.account}
                appMemberships={account.appMemberships ?? []}
              />
            )}
          </div>

          {userCanReadAppMemberships ? (
            <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
              {account.appMemberships && account.appMemberships.length > 0 ? (
                account.appMemberships.map((appMembership) => (
                  <div
                    key={appMembership?.id}
                    className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center p-2 group"
                  >
                    {/* App Name and ID */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-lg text-zinc-900 dark:text-zinc-100">
                          {appMembership?.name}
                        </div>
                        <SseLabel sseEnabled={Boolean(appMembership?.sseEnabled)} />
                      </div>
                      <div className="flex items-center gap-2 text-sm text-neutral-500 group/id">
                        <span className="text-neutral-500 text-2xs flex items-center">App ID:</span>
                        <CopyButton value={appMembership.id} buttonVariant="ghost">
                          <span className="text-neutral-500 text-2xs font-mono">
                            {appMembership.id}
                          </span>
                        </CopyButton>
                      </div>
                    </div>

                    {/* Environments */}
                    <div className="col-span-2">
                      <div className="text-2xs uppercase tracking-widest text-neutral-500 mb-1">
                        Environments
                      </div>
                      <div className="text-sm text-zinc-700 dark:text-zinc-300">
                        {appMembership?.environments?.map((env) => env?.name).join(' + ')}
                      </div>
                    </div>

                    {/* Manage Button */}
                    <div className="flex justify-end">
                      <Link
                        className="opacity-0 group-hover:opacity-100 transition ease"
                        href={`/${params.team}/apps/${appMembership?.id}/access/service-accounts?manageAccount=${account.id}`}
                      >
                        <Button variant="secondary" className="flex items-center gap-2">
                          <FaCog className="h-4 w-4" />
                          <span>Manage</span>
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8">
                  <EmptyState
                    title="No Apps"
                    subtitle="This Service Account does not have access to any Apps. Grant this account access from the Access tab of an App."
                    graphic={
                      <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                        <FaBoxOpen />
                      </div>
                    }
                  >
                    {userCanReadAppMemberships && (
                      <AddAppButton
                        serviceAccountId={params.account}
                        appMemberships={account.appMemberships ?? []}
                        align={'right'}
                      />
                    )}
                  </EmptyState>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8">
              <EmptyState
                title="Access restricted"
                subtitle="You don't have the permissions required to view Service Account App memberships"
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBan />
                  </div>
                }
              >
                <></>
              </EmptyState>
            </div>
          )}
        </div>

        {userCanViewNetworkAccess && (
          <div className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xl font-semibold">Network Access Policy</div>
                <div className="text-neutral-500">
                  Manage the network access policy for this Account
                </div>
              </div>
              {account.networkPolicies?.length! > 0 && (
                <UpdateAccountNetworkPolicies account={account} />
              )}
            </div>

            {account.networkPolicies?.length! > 0 ? (
              <div className="divide-y divide-neutral-500/20 py-6">
                {account.networkPolicies?.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex items-center gap-2">
                      <FaNetworkWired className="text-neutral-500 shrink-0" />
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {policy.name}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {policy.allowedIps.split(',').map((ip) => (
                        <IPChip key={ip} ip={ip}></IPChip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No Policy"
                subtitle={
                  <>
                    This service account does not have any Network Access Policies associated with
                    it.
                    <br /> Access is allowed from any IP address -{' '}
                    <span className="font-semibold font-mono">0.0.0.0/0, ::/0</span>
                  </>
                }
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-5xl text-center">
                    <FaNetworkWired />
                  </div>
                }
              >
                <UpdateAccountNetworkPolicies account={account} />
              </EmptyState>
            )}
          </div>
        )}

        <div className="py-4">
          <div>
            <div className="text-xl font-semibold">Access Tokens</div>
            <div className="text-neutral-500">Manage access tokens for this Service Account</div>
          </div>

          <CreateServiceAccountTokenDialog serviceAccount={account} ref={tokenDialogRef} />

          {account.tokens?.length! > 0 && (
            <div className="flex items-center justify-end">
              <Button variant="primary" onClick={openTokenDialog}>
                <FaPlus /> Create token
              </Button>
            </div>
          )}

          {userCanReadTokens ? (
            <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
              {account.tokens && account.tokens.length > 0 ? (
                account.tokens.map((token) => {
                  const isExpired =
                    token!.expiresAt === null ? false : new Date(token!.expiresAt) < new Date()
                  return (
                    <div
                      key={token!.id}
                      className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center p-2 group"
                    >
                      {/* Token Name and ID*/}
                      <div className="md:col-span-4 space-y-1">
                        <div className="flex items-center gap-2">
                          <FaKey className="text-neutral-500 flex-shrink-0" />
                          <span className="font-medium text-lg text-zinc-900 dark:text-zinc-100 truncate">
                            {token!.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-neutral-500">
                          <span className="text-neutral-500 text-xs flex items-center">
                            Token ID:
                          </span>
                          <CopyButton
                            value={token!.id}
                            buttonVariant="ghost"
                            title="Copy Token ID to clipboard"
                          >
                            <span className="text-neutral-500 text-2xs font-mono">{token!.id}</span>
                          </CopyButton>
                        </div>
                      </div>

                      {/* Created Info*/}
                      <div className="md:col-span-4 text-neutral-500 text-sm flex flex-col gap-1">
                        <div className="whitespace-nowrap">
                          Created {relativeTimeFromDates(new Date(token?.createdAt))}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-500">by</span>
                          <Avatar member={token!.createdBy!} size="sm" />
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {token?.createdBy?.fullName}
                          </span>
                        </div>
                      </div>

                      {/* Token Status*/}
                      <div className="md:col-span-3 space-y-2">
                        <div
                          className={clsx(
                            'flex items-center gap-1 text-sm ',
                            isExpired ? 'text-red-500' : 'text-neutral-500'
                          )}
                        >
                          <span className="whitespace-nowrap">
                            {isExpired ? 'Expired' : 'Expires'}
                          </span>
                          <span className="whitespace-nowrap">
                            {token!.expiresAt
                              ? relativeTimeFromDates(new Date(token?.expiresAt))
                              : 'never'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 text-sm text-neutral-500">
                          <span className="whitespace-nowrap">Last used</span>
                          <span className="whitespace-nowrap">
                            {token!.lastUsed
                              ? relativeTimeFromDates(new Date(token?.lastUsed))
                              : 'never'}
                          </span>
                        </div>
                      </div>

                      {/* Delete Button*/}
                      <div className="md:col-span-1 flex justify-end opacity-0 group-hover:opacity-100 transition ease">
                        <DeleteServiceAccountTokenDialog
                          token={token!}
                          serviceAccountId={account.id}
                        />
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="py-8">
                  <EmptyState
                    title="No tokens created"
                    subtitle="This Service Account does not have any tokens. Create a new token to access secrets from Apps associated with this Service Account."
                    graphic={
                      <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                        <FaKey />
                      </div>
                    }
                  >
                    <Button variant="primary" onClick={openTokenDialog}>
                      <FaPlus /> Create token
                    </Button>
                  </EmptyState>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8">
              <EmptyState
                title="Access restricted"
                subtitle="You don't have the permissions required to view Service Account Tokens"
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBan />
                  </div>
                }
              >
                <></>
              </EmptyState>
            </div>
          )}
        </div>

        {userCanDeleteSA && (
          <div className="space-y-2 py-4">
            <div>
              <div className="text-xl font-semibold">Danger Zone</div>
              <div className="text-neutral-500">
                These actions are destructive and cannot be reversed
              </div>
            </div>

            <div className="flex justify-between ring-1 ring-inset ring-red-500/40 bg-red-400/10 rounded-lg space-y-2 p-4">
              <div>
                <div className="font-medium text-red-400">Delete account</div>
                <div className="text-neutral-500">
                  Permanently delete this Service Account and all associated tokens
                </div>
              </div>
              <DeleteServiceAccountDialog account={account} />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
