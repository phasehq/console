'use client'

import { useContext } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { FaBan, FaKey } from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { GetSCIMTokens } from '@/graphql/queries/scim/getSCIMTokens.gql'
import { ToggleSCIMTokenOp } from '@/graphql/mutations/scim/toggleSCIMToken.gql'
import { userHasPermission } from '@/utils/access/permissions'
import Spinner from '@/components/common/Spinner'
import { EmptyState } from '@/components/common/EmptyState'
import { CreateSCIMTokenDialog } from '../_components/SCIMTokenDialogs'
import { SCIMTokensTable } from '../_components/SCIMTokensTable'

export default function SCIMConnectionsPage({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanManageSCIM = organisation
    ? userHasPermission(organisation.role!.permissions, 'SCIM', 'update')
    : false

  const userCanReadSCIM = organisation
    ? userHasPermission(organisation.role!.permissions, 'SCIM', 'read')
    : false

  const { data, loading } = useQuery(GetSCIMTokens, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadSCIM,
  })

  const [toggleSCIMToken] = useMutation(ToggleSCIMTokenOp, {
    refetchQueries: [{ query: GetSCIMTokens, variables: { organisationId: organisation?.id } }],
  })

  const tokens = data?.scimTokens || []

  const handleToggleToken = async (tokenId: string, currentActive: boolean) => {
    try {
      await toggleSCIMToken({
        variables: { tokenId, isActive: !currentActive },
      })
      toast.success(currentActive ? 'Token disabled' : 'Token enabled')
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle token')
    }
  }

  if (!organisation)
    return (
      <div className="flex items-center justify-center p-10">
        <Spinner size="md" />
      </div>
    )

  if (!userCanReadSCIM)
    return (
      <section className="px-3 sm:px-4 lg:px-6">
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to manage SCIM provisioning."
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
    <section className="px-3 sm:px-4 lg:px-6">
      <div className="w-full space-y-6 text-zinc-900 dark:text-zinc-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium">Provider Connections</h2>
            <p className="text-neutral-500 text-sm">
              Manage SCIM tokens for identity provider connections.
            </p>
          </div>
          {userCanManageSCIM && <CreateSCIMTokenDialog organisationId={organisation.id} />}
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center p-10">
            <Spinner size="md" />
          </div>
        ) : tokens.length === 0 ? (
          <EmptyState
            title="No provider connections"
            subtitle="Create a token to connect your identity provider."
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <FaKey />
              </div>
            }
          >
            {userCanManageSCIM && <CreateSCIMTokenDialog organisationId={organisation.id} />}
          </EmptyState>
        ) : (
          <SCIMTokensTable
            tokens={tokens}
            organisationId={organisation.id}
            userCanManageSCIM={userCanManageSCIM}
            onToggleToken={handleToggleToken}
          />
        )}
      </div>
    </section>
  )
}
