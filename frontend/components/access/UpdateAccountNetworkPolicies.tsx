import {
  ServiceAccountType,
  OrganisationMemberType,
  NetworkAccessPolicyType,
  AccountTypeEnum,
  ApiOrganisationPlanChoices,
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
import { UpdateAccountNetworkPolicy } from '@/graphql/mutations/access/updateAccountNetworkPolicies.gql'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { IPChip } from '@/app/[team]/access/network/_components/IPChip'
import { CreateNetworkAccessPolicyDialog } from '@/app/[team]/access/network/_components/CreateNetworkPolicyDialog'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { UpsellDialog } from '../settings/organisation/UpsellDialog'
import { isClientIpAllowed } from '@/utils/access/ip'
import { isCloudHosted } from '@/utils/appConfig'

export const UpdateAccountNetworkPolicies = ({
  account,
}: {
  account: ServiceAccountType | OrganisationMemberType
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const [selectedPolicies, setSelectedPolicies] = useState<NetworkAccessPolicyType[]>(
    account.networkPolicies?.filter((p) => !p.isGlobal) || []
  )

  // Permissions
  const userCanReadNetworkPolicies = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'read')
    : false

  const userCanUpdateAccount =
    account.__typename === 'ServiceAccountType'
      ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'update')
      : userHasPermission(organisation?.role?.permissions, 'Members', 'update')

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

  const isSelf = account.__typename === 'OrganisationMemberType' && account.self
  const clientIp = data?.clientIp

  const handleUpdatePolicy = async () => {
    const newIps = selectedPolicies.flatMap((policy) =>
      policy.allowedIps.split(',').map((ip) => ip.trim())
    )

    if (isSelf && clientIp && !isClientIpAllowed(newIps, clientIp)) {
      const confirm = window.confirm(
        `Warning: Your current IP (${clientIp}) is not in the allowed list or any CIDR range. You may be locked out. Continue?`
      )
      if (!confirm) return
    }

    await updatePolicy({
      variables: {
        accounts: [
          {
            accountType:
              account.__typename === 'ServiceAccountType'
                ? AccountTypeEnum.Service
                : AccountTypeEnum.User,
            accountId: account.id,
            policyIds: selectedPolicies.filter((p) => !p.isGlobal).map((p) => p.id),
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

    closeModal()
    toast.success('Update network access policy for this account')
  }

  const availablePolicies =
    data?.networkAccessPolicies.filter((policy: NetworkAccessPolicyType) => !policy.isGlobal) ?? []
  const globalPolicies =
    data?.networkAccessPolicies.filter((policy: NetworkAccessPolicyType) => policy.isGlobal) ?? []

  const noPolicies = availablePolicies.length === 0 && globalPolicies.length === 0

  if (!organisation) return <></>

  if (organisation.plan === ApiOrganisationPlanChoices.Fr)
    return (
      <UpsellDialog
        buttonLabel={
          <>
            <FaNetworkWired /> Manage policy{' '}
            <PlanLabel
              plan={isCloudHosted() ? ApiOrganisationPlanChoices.Pr : ApiOrganisationPlanChoices.En}
            />{' '}
          </>
        }
      />
    )

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
          !noPolicies ? (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
              <thead>
                <tr>
                  <th className="py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>

                  <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Allowlist
                  </th>

                  <th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Enabled
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {globalPolicies.map((policy: NetworkAccessPolicyType) => (
                  <tr key={policy.id} className="group">
                    <td className="text-zinc-900 dark:text-zinc-100 font-medium inline-flex items-center gap-1">
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

                    <td
                      className="px-6 py-4 flex items-center justify-end gap-2"
                      title="This policy has been applied globally across the organisation and cannot be selectively disabled."
                    >
                      <ToggleSwitch value={true} disabled={true} onToggle={() => {}} />
                    </td>
                  </tr>
                ))}
                {availablePolicies.map((policy: NetworkAccessPolicyType) => (
                  <tr key={policy.id} className="group">
                    <td className="text-zinc-900 dark:text-zinc-100 font-medium break-all inline-flex items-center gap-1">
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

                    <td
                      className="px-6 py-4 flex items-center justify-end gap-2"
                      title={`${selectedPolicies.map((p) => p.id).includes(policy.id) ? 'Disable' : 'Enable'} this policy`}
                    >
                      <ToggleSwitch
                        value={selectedPolicies.map((p) => p.id).includes(policy.id)}
                        disabled={!userCanUpdateAccount}
                        onToggle={() => handleTogglePolicy(policy)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState
              title="No policies"
              subtitle="There are no network policies created yet. Click below to create one."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <FaNetworkWired />
                </div>
              }
            >
              <CreateNetworkAccessPolicyDialog clientIp={data?.clientIp} />
            </EmptyState>
          )
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

      {!noPolicies && (
        <div className="flex items-center justify-between mt-4">
          <Button variant="secondary" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleUpdatePolicy}
            isLoading={updateIsPending}
            disabled={!userCanUpdateAccount}
          >
            Save
          </Button>
        </div>
      )}
    </GenericDialog>
  )
}
