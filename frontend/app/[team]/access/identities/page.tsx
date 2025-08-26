'use client'

import { useContext, useState } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation, useQuery } from '@apollo/client'
import GetOrganisationIdentities from '@/graphql/queries/identities/getOrganisationIdentities.gql'
import DeleteIdentity from '@/graphql/mutations/identities/deleteIdentity.gql'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { FaPlus, FaTrashAlt, FaEdit, FaBan } from 'react-icons/fa'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from 'react-toastify'
import { IdentityProviderSelector } from '@/components/identities/IdentityProviderSelector'
import { AwsIamIdentityDialog } from '@/components/identities/providers/aws/iam'
import { ProviderCards } from '@/components/identities/ProviderCards'
import GetIdentityProviders from '@/graphql/queries/identities/getIdentityProviders.gql'

type AwsIamConfig = {
  trustedPrincipals: string[]
  signatureTtlSeconds: number
  stsEndpoint: string
}

type Identity = {
  id: string
  provider: string
  name: string
  description?: string | null
  config: AwsIamConfig
  tokenNamePattern?: string | null
  defaultTtlSeconds: number
  maxTtlSeconds: number
}

export default function IdentityPage() {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permission checks
  const canReadIdentities = organisation
    ? userHasPermission(organisation.role!.permissions, 'Identities', 'read')
    : false
  const canCreateIdentities = organisation
    ? userHasPermission(organisation.role!.permissions, 'Identities', 'create')
    : false
  const canUpdateIdentities = organisation
    ? userHasPermission(organisation.role!.permissions, 'Identities', 'update')
    : false
  const canDeleteIdentities = organisation
    ? userHasPermission(organisation.role!.permissions, 'Identities', 'delete')
    : false

  const { data, refetch } = useQuery(GetOrganisationIdentities, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !canReadIdentities,
    fetchPolicy: 'cache-and-network',
  })

  const { data: providersData } = useQuery(GetIdentityProviders)

  const [deleteIdentity, { loading: deleting }] = useMutation(DeleteIdentity)

  const [providerSelectorOpen, setProviderSelectorOpen] = useState(false)
  const [awsEditDialogOpen, setAwsEditDialogOpen] = useState(false)
  const [editingIdentity, setEditingIdentity] = useState<Identity | null>(null)

  const identities: Identity[] = data?.identities ?? []
  const identityProviders = providersData?.identityProviders ?? []

  // Helper function to get provider info by ID
  const getProviderInfo = (providerId: string) => {
    const provider = identityProviders.find((p: any) => p.id === providerId)
    return provider || { name: providerId, iconId: 'unknown' }
  }

  const handleCreateIdentity = () => {
    if (!canCreateIdentities) return
    // If no identities exist, direct provider selection isn't needed as cards are visible
    // If identities exist, show provider selector modal
    if (identities.length > 0) {
      setProviderSelectorOpen(true)
    }
  }

  const handleProviderSelect = (providerId: string) => {
    setEditingIdentity(null) // Ensure we're creating, not editing
    if (providerId === 'aws_iam') {
      setAwsEditDialogOpen(true)
    }
    // Future providers can be handled here
    // Close provider selector if it was open
    setProviderSelectorOpen(false)
  }

  const handleEditIdentity = (identity: Identity) => {
    if (!canUpdateIdentities) return
    setEditingIdentity(identity)
    if (identity.provider === 'aws_iam') {
      setAwsEditDialogOpen(true)
    }
  }

  const handleProviderSelectorSuccess = () => {
    setProviderSelectorOpen(false)
    refetch()
  }

  const handleAwsEditSuccess = () => {
    setAwsEditDialogOpen(false)
    setEditingIdentity(null)
    refetch()
  }

  const handleDelete = async (id: string) => {
    if (!canDeleteIdentities) return
    const ok = window.confirm('Delete this identity? This cannot be undone.')
    if (!ok) return
    try {
      await deleteIdentity({
        variables: { id },
        refetchQueries: [
          { query: GetOrganisationIdentities, variables: { organisationId: organisation?.id } },
        ],
      })
      toast.success('Identity deleted')
    } catch (e) {
      toast.error('Failed to delete identity')
    }
  }

  // Early return if no read permission
  if (!canReadIdentities) {
    return (
      <EmptyState
        title="Access restricted"
        subtitle="You don't have the permissions required to view identities in this organisation."
        graphic={
          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
            <FaBan />
          </div>
        }
      >
        <></>
      </EmptyState>
    )
  }

  return (
    <section className="space-y-6">
      {identities.length === 0 ? (
        <div className="space-y-8">
          <div>
            <h3 className="text-black dark:text-white text-2xl font-semibold">
              Set up a new identity
            </h3>
            <div className="text-neutral-500">
              Third party identity platforms can be used to authenticate clients and provision
              access tokens. Select a provider below to get started.
            </div>
          </div>
          {canCreateIdentities ? (
            <ProviderCards onProviderSelect={handleProviderSelect} />
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to create identities in this organisation."
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
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="text-xl font-semibold">External identities</div>
            <div className="text-neutral-500">Manage identities used for external auth</div>
          </div>
          <div className="space-y-4">
            {canCreateIdentities && (
              <div className="flex justify-end">
                <Button variant="primary" onClick={handleCreateIdentity}>
                  <FaPlus /> Add identity
                </Button>
              </div>
            )}
            <div className="py-2">
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-500/20">
                  {identities.map((idn: Identity) => {
                    const providerInfo = getProviderInfo(idn.provider)
                    return (
                      <tr key={idn.id} className="group">
                        <td className="text-zinc-900 dark:text-zinc-100 font-medium inline-flex items-center gap-2 break-word">
                          <div className="text-2xl">
                            <ProviderIcon providerId={providerInfo.iconId} />
                          </div>
                          {providerInfo.name}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            className="text-left font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                            onClick={() => handleEditIdentity(idn)}
                          >
                            {idn.name}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-neutral-500 max-w-xl truncate">
                          {idn.description}
                        </td>
                        <td className="px-6 py-4 flex items-center justify-end gap-2">
                          <div className="opacity-0 group-hover:opacity-100 transition ease flex gap-2">
                            {canUpdateIdentities && (
                              <Button variant="secondary" onClick={() => handleEditIdentity(idn)}>
                                <FaEdit /> Edit identity
                              </Button>
                            )}
                            {canDeleteIdentities && (
                              <Button
                                variant="danger"
                                onClick={(e) => {
                                  e.preventDefault()
                                  void handleDelete(idn.id)
                                }}
                              >
                                <FaTrashAlt /> Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Identity Provider Selector */}
      <IdentityProviderSelector
        isOpen={providerSelectorOpen}
        onClose={() => setProviderSelectorOpen(false)}
        organisationId={organisation?.id || ''}
        onSuccess={handleProviderSelectorSuccess}
      />

      {/* AWS IAM Edit Dialog */}
      <AwsIamIdentityDialog
        isOpen={awsEditDialogOpen}
        onClose={() => {
          setAwsEditDialogOpen(false)
          setEditingIdentity(null)
        }}
        organisationId={organisation?.id || ''}
        identity={editingIdentity}
        onSuccess={handleAwsEditSuccess}
      />
    </section>
  )
}
