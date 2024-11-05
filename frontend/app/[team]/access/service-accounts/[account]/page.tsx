'use client'

import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { UpdateServiceAccountOp } from '@/graphql/mutations/service-accounts/updateServiceAccount.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { relativeTimeFromDates } from '@/utils/time'
import { useMutation, useQuery } from '@apollo/client'
import Link from 'next/link'
import { useContext, useEffect, useState } from 'react'
import { FaBan, FaChevronLeft, FaKey, FaRobot } from 'react-icons/fa'
import { CreateServiceAccountTokenDialog } from './_components/CreateServiceAccountTokenDialog'
import { DeleteServiceAccountDialog } from '../_components/DeleteServiceAccountDialog'
import { ServiceAccountTokenType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { DeleteServiceAccountTokenDialog } from './_components/DeleteServiceAccountTokenDialog'
import { ServiceAccountRoleSelector } from '../_components/RoleSelector'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'

export default function ServiceAccount({ params }: { params: { team: string; account: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [name, setName] = useState('')

  const userCanReadSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false

  const userCanReadTokens = organisation
    ? userHasPermission(organisation.role?.permissions, 'ServiceAccountTokens', 'read')
    : false

  const userCanUpdateSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'update')
    : false

  const userCanDeleteSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'delete')
    : false

  const { data, loading } = useQuery(GetServiceAccounts, {
    variables: { orgId: organisation?.id, id: params.account },
    skip: !organisation || !userCanReadSA,
  })

  const [updateAccount] = useMutation(UpdateServiceAccountOp)

  const account = data?.serviceAccounts[0]

  const nameUpdated = account ? account.name !== name : false

  const updateName = async () => {
    if (!userCanUpdateSA) {
      toast.error("You don't have the permissions requried to update Service Accounts")
    }
    await updateAccount({
      variables: {
        serviceAccountId: account.id,
        roleId: account.role.id,
        name,
      },
      refetchQueries: [
        { query: GetServiceAccounts, variables: { orgId: organisation?.id, id: params.account } },
      ],
    })

    toast.success('Updated account name!')
  }

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
        <div className="text-2xl font-semibold flex items-start gap-2">
          <div className="rounded-full flex items-center bg-neutral-500/40 justify-center size-16">
            <FaRobot className="shrink-0 text-zinc-900 dark:text-zinc-100 grow" />
          </div>{' '}
          <div>
            <h3 className="relative">
              <Input readOnly={!userCanUpdateSA} value={name} setValue={setName} />
              {nameUpdated && (
                <div className="absolute right-2 top-2">
                  <Button variant="primary" onClick={updateName}>
                    <span className="text-2xs">Save</span>
                  </Button>
                </div>
              )}
            </h3>

            <div className="text-base">
              <ServiceAccountRoleSelector account={account} displayOnly={!userCanUpdateSA} />
            </div>
          </div>
        </div>

        <div className="py-4">
          <div>
            <div className="text-xl font-semibold">Tokens</div>
            <div className="text-neutral-500">Manage tokens for this service account</div>
          </div>
          <div className="flex items-center justify-end">
            <CreateServiceAccountTokenDialog serviceAccount={account} />
          </div>

          {userCanReadTokens ? (
            <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
              {account.tokens?.map((token: ServiceAccountTokenType) => (
                <div key={token!.id} className="grid grid-cols-4 gap-2 items-center p-2 group">
                  <div className="font-medium text-lg text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <FaKey className="text-neutral-500" /> {token!.name}
                  </div>

                  <div className="text-neutral-500 text-sm flex items-center gap-1">
                    <span>Created</span> {relativeTimeFromDates(new Date(token?.createdAt))} by{' '}
                    <Avatar imagePath={token.createdBy?.avatarUrl} size="sm" />
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {token?.createdBy?.fullName}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-neutral-500 text-sm">
                    Expires{' '}
                    {token.expiresAt ? relativeTimeFromDates(new Date(token?.expiresAt)) : 'never'}
                  </div>

                  <div className="flex justify-end opacity-0 group-hover:opacity-100 transition ease">
                    <DeleteServiceAccountTokenDialog token={token} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view service account tokens"
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

        <div className="space-y-2 py-4">
          <div>
            <div className="text-xl font-semibold">Danger Zone</div>
            <div className="text-neutral-500">
              These actions are destructive and cannot be reversed
            </div>
          </div>
          {userCanDeleteSA && (
            <div className="flex justify-between ring-1 ring-inset ring-red-500/40 bg-red-400/10 rounded-lg space-y-2 p-4">
              <div>
                <div className="font-medium text-red-400">Delete account</div>
                <div className="text-neutral-500">
                  Permanently delete this service account and all associated tokens
                </div>
              </div>
              <DeleteServiceAccountDialog account={account} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
