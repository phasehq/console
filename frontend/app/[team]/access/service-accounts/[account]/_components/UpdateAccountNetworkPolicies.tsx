import {
  ServiceAccountType,
  OrganisationMemberType,
  NetworkAccessPolicyType,
  AccountTypeEnum,
} from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { GetServiceAccountDetail } from '@/graphql/queries/service-accounts/getServiceAccountDetail.gql'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { FaBan, FaGlobe, FaNetworkWired } from 'react-icons/fa'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { EmptyState } from '@/components/common/EmptyState'
import { IPChip } from '../../../network/_components/IPChip'
import { UpdateAccountNetworkPolicy } from '@/graphql/mutations/access/updateAccountNetworkPolicies.gql'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'

export const UpdateAccountNetworkPolicies = ({
  account,
}: {
  account: ServiceAccountType | OrganisationMemberType
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [selectedPolicies, setSelectedPolicies] = useState<NetworkAccessPolicyType[]>(
    account.networkPolicies || []
  )

  // Permissions
  const userCanReadNetworkPolicies = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'read')
    : false

  const userCanUpdateServiceAccounts = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'update')
    : false

  const { data, loading } = useQuery(GetNetworkPolicies, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadNetworkPolicies,
  })

  const [updatePolicy, { loading: updateIsPending }] = useMutation(UpdateAccountNetworkPolicy)

  const handleTogglePolicy = (policy: NetworkAccessPolicyType) => {
    selectedPolicies.map((p) => p.id).includes(policy.id)
      ? setSelectedPolicies(selectedPolicies.filter((p) => p.id !== policy.id))
      : setSelectedPolicies([policy, ...selectedPolicies])
  }

  const closeModal = () => dialogRef.current?.closeModal()

  const handleUpdatePolicy = async () => {
    await updatePolicy({
      variables: {
        accounts: [
          {
            accountType:
              account.__typename === 'ServiceAccountType'
                ? AccountTypeEnum.Service
                : AccountTypeEnum.User,
            accountId: account.id,
            policyIds: selectedPolicies.map((p) => p.id),
          },
        ],
        organisationId: organisation?.id!,
      },
      refetchQueries: [
        account.__typename === 'ServiceAccountType'
          ? {
              query: GetServiceAccountDetail,
              variables: { orgId: organisation?.id, id: account.id },
            }
          : {
              query: GetOrganisationMembers,
              variables: { organisationId: organisation?.id, role: null },
            },
      ],
    })

    toast.success('Update network access policy for this account')
    closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Manage Network Access Policies for this account"
      size="lg"
      buttonContent={
        <>
          <FaNetworkWired /> Manage policy
        </>
      }
    >
      <div className="text-neutral-500 text-sm">
        Select one or more network access policies to apply to this account
      </div>
      <div className="py-4">
        {userCanReadNetworkPolicies ? (
          <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
            <thead>
              <tr>
                <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>

                <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Allowlist
                </th>

                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-500/20">
              {data?.networkAccessPolicies.map((policy: NetworkAccessPolicyType) => (
                <tr key={policy.id} className="group">
                  <td className="text-zinc-900 dark:text-zinc-100 font-medium whitespace-nowrap inline-flex items-center gap-1">
                    {policy.name}{' '}
                    {policy.isGlobal && (
                      <FaGlobe title="Global policy" className="text-neutral-500" />
                    )}
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex gap-2 flex-wrap">
                      {policy.allowedIps.split(',').map((ip) => (
                        <IPChip key={ip} ip={ip}></IPChip>
                      ))}
                    </div>
                  </td>

                  <td className="px-6 py-4 flex items-center justify-end gap-2">
                    <ToggleSwitch
                      value={selectedPolicies.map((p) => p.id).includes(policy.id)}
                      onToggle={() => handleTogglePolicy(policy)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            title="Access restricted"
            subtitle="You don't have the permissions required to view Network Access Policies in this organisation."
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

      <div className="flex items-center justify-between mt-4">
        <Button variant="secondary" onClick={closeModal}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleUpdatePolicy} isLoading={updateIsPending}>
          Save
        </Button>
      </div>
    </GenericDialog>
  )
}
