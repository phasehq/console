'use client'

import { useContext, useState, useRef, useEffect } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import GetOrganisationIdentities from '@/graphql/queries/identities/getOrganisationIdentities.gql'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { FaPlus, FaEdit, FaBan } from 'react-icons/fa'
import { EmptyState } from '@/components/common/EmptyState'
import { AddNewIdentityDialog } from '@/components/identities/AddNewIdentityDialog'

import { ProviderCards } from '@/components/identities/ProviderCards'
import GetIdentityProviders from '@/graphql/queries/identities/getIdentityProviders.gql'
import { AwsIamIdentityForm } from '@/components/identities/providers/aws/iam'
import GenericDialog from '@/components/common/GenericDialog'
import { TbLockShare } from 'react-icons/tb'
import { DeleteExternalIdentityDialog } from '@/components/identities/providers/DeleteExternalIdentityDialog'
import { IdentityType } from '@/apollo/graphql'
import { EditExternalIdentityDialog } from '@/components/identities/providers/EditExternalIdentityDialog'

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

  const { data, refetch } = useQuery(GetOrganisationIdentities, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !canReadIdentities,
    fetchPolicy: 'cache-and-network',
  })

  const { data: providersData } = useQuery(GetIdentityProviders)

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)

  const awsEditDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const createDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [awsEditDialogOpen, setAwsEditDialogOpen] = useState(false)
  const [editingIdentity, setEditingIdentity] = useState<IdentityType | null>(null)

  const identities: IdentityType[] = data?.identities ?? []
  const identityProviders = providersData?.identityProviders ?? []

  const openCreateIdentityDialog = () => createDialogRef.current?.openModal()

  // Effect to open dialog when awsEditDialogOpen changes
  useEffect(() => {
    if (awsEditDialogOpen && awsEditDialogRef.current) {
      awsEditDialogRef.current.openModal()
    }
  }, [awsEditDialogOpen])

  // Helper function to get provider info by ID
  const getProviderInfo = (providerId: string) => {
    const provider = identityProviders.find((p: any) => p.id === providerId)
    return provider || { name: providerId, iconId: 'unknown' }
  }

  const handleProviderSelect = (providerId: string) => {
    setEditingIdentity(null) // Ensure we're creating, not editing
    setSelectedProvider(providerId)
    openCreateIdentityDialog()
  }

  const handleEditIdentity = (identity: IdentityType) => {
    if (!canUpdateIdentities) return
    setEditingIdentity(identity)
    if (identity.provider === 'aws_iam') {
      setAwsEditDialogOpen(true)
    }
  }

  const handleProviderSelectorSuccess = () => {
    refetch()
  }

  const handleAwsEditSuccess = () => {
    setAwsEditDialogOpen(false)
    setEditingIdentity(null)
    awsEditDialogRef.current?.closeModal()
    refetch()
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
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-8">
              <ProviderCards onProviderSelect={handleProviderSelect} />
            </div>
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
                <Button onClick={openCreateIdentityDialog}>
                  <FaPlus /> Add Identity Provider
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
                  {identities.map((idn: IdentityType) => {
                    const providerInfo = getProviderInfo(idn.provider)
                    return (
                      <tr key={idn.id} className="group">
                        <td className="text-zinc-900 dark:text-zinc-100 font-medium inline-flex items-center gap-2 break-word">
                          <div className="text-2xl">
                            <ProviderIcon providerId={providerInfo.iconId} />
                          </div>
                          {providerInfo.name}
                        </td>
                        <td className="px-6 py-4 text-zinc-900 dark:text-zinc-100 font-medium">
                          {idn.name}
                        </td>
                        <td className="px-6 py-4 text-neutral-500 max-w-xl truncate">
                          {idn.description}
                        </td>
                        <td className="px-6 py-4 flex items-center justify-end gap-2">
                          <div className="opacity-0 group-hover:opacity-100 transition ease flex gap-2">
                            {canUpdateIdentities && <EditExternalIdentityDialog identity={idn} />}
                            <DeleteExternalIdentityDialog identity={idn} />
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

      <AddNewIdentityDialog
        ref={createDialogRef}
        preSelectedProvider={selectedProvider}
        organisationId={organisation?.id || ''}
        onSuccess={handleProviderSelectorSuccess}
      />

      {/* AWS IAM Edit Dialog */}
      <GenericDialog
        ref={awsEditDialogRef}
        title="Edit AWS IAM Identity"
        size="lg"
        onClose={() => {
          setAwsEditDialogOpen(false)
          setEditingIdentity(null)
        }}
      >
        <AwsIamIdentityForm
          organisationId={organisation?.id || ''}
          identity={editingIdentity}
          onSuccess={handleAwsEditSuccess}
        />
      </GenericDialog>
    </section>
  )
}
