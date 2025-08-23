import { ServiceAccountTokenType, ServiceAccountType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import CopyButton from '@/components/common/CopyButton'
import { relativeTimeFromDates } from '@/utils/time'
import clsx from 'clsx'
import { FaBan, FaKey, FaPlus } from 'react-icons/fa6'
import { DeleteServiceAccountTokenDialog } from './DeleteServiceAccountTokenDialog'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import CreateServiceAccountTokenDialog from './CreateServiceAccountTokenDialog'
import { useContext, useRef } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { GetServiceAccountTokens } from '@/graphql/queries/service-accounts/getServiceAccountTokens.gql'
import { useQuery } from '@apollo/client'
import Spinner from '@/components/common/Spinner'

export const ServiceAccountTokens = ({ account }: { account: ServiceAccountType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadTokens = organisation
    ? userHasPermission(organisation.role?.permissions, 'ServiceAccountTokens', 'read')
    : false

  const tokenDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const openTokenDialog = () => tokenDialogRef.current?.openModal()

  const { data, loading } = useQuery(GetServiceAccountTokens, {
    variables: { orgId: organisation?.id, id: account.id },
    skip: !organisation || !userCanReadTokens,
    fetchPolicy: 'cache-and-network',
  })

  const tokens = data?.serviceAccounts?.[0]?.tokens as ServiceAccountTokenType[] | undefined

  return (
    <div className="py-4">
      <div>
        <div className="text-xl font-semibold">Access Tokens</div>
        <div className="text-neutral-500">Manage access tokens for this Service Account</div>
      </div>

      <CreateServiceAccountTokenDialog serviceAccount={account} ref={tokenDialogRef} />

      {tokens?.length! > 0 && (
        <div className="flex items-center justify-end">
          <Button variant="primary" onClick={openTokenDialog}>
            <FaPlus /> Create token
          </Button>
        </div>
      )}

      {userCanReadTokens ? (
        <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
          {loading ? (
            <div className="flex items-center justify-center p-8 gap-2">
              <Spinner size="sm" />{' '}
              <span className="text-neutral-500 text-sm">Loading tokens...</span>
            </div>
          ) : tokens && tokens.length > 0 ? (
            tokens.map((token) => {
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
                      <span className="text-neutral-500 text-xs flex items-center">Token ID:</span>
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
                      {token?.createdBy ? (
                        <>
                          <Avatar member={token.createdBy} size="sm" />
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {token.createdBy.fullName}
                          </span>
                        </>
                      ) : token?.createdByServiceAccount ? (
                        <>
                          <Avatar serviceAccount={token.createdByServiceAccount} size="sm" />
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {token.createdByServiceAccount.name}
                          </span>
                        </>
                      ) : (
                        <span className="text-neutral-400 italic">Unknown</span>
                      )}
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
                      <span className="whitespace-nowrap">{isExpired ? 'Expired' : 'Expires'}</span>
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
                    <DeleteServiceAccountTokenDialog token={token!} serviceAccountId={account.id} />
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
  )
}
