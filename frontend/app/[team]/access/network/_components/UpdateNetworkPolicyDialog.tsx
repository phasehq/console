import GenericDialog from '@/components/common/GenericDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useRef } from 'react'
import { FaEdit } from 'react-icons/fa'
import { UpdateAccessPolicies } from '@/graphql/mutations/access/updateNetworkAccessPolicy.gql'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { NetworkAccessPolicyType } from '@/apollo/graphql'
import { isClientIpAllowed } from '@/utils/access/ip'
import { userHasPermission } from '@/utils/access/permissions'
import { NetworkAccessPolicyForm } from '@/components/access/NetworkAccessPolicyForm'

export const UpdateNetworkAccessPolicyDialog = ({
  policy,
  clientIp,
}: {
  policy: NetworkAccessPolicyType
  clientIp: string
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanUpdateNetworkPolicies = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'update')
    : false

  const [updatePolicy, { loading: updateIsPending }] = useMutation(UpdateAccessPolicies)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const handleSubmit = async (data: { name: string; ips: string[] }) => {
    const { name, ips } = data

    if (ips.length === 0) {
      toast.error('Please enter at least 1 IP or CIDR range')
      return
    }

    if (policy.isGlobal && clientIp && !isClientIpAllowed(ips, clientIp)) {
      const confirm = window.confirm(
        `Warning: This policy is enabled globally and your current IP (${clientIp}) is not in the allowed list or any CIDR range. You may be locked out. Continue?`
      )
      if (!confirm) return
    }

    await updatePolicy({
      variables: {
        inputs: [
          {
            id: policy.id,
            name,
            allowedIps: ips.join(','),
            isGlobal: policy.isGlobal,
          },
        ],
      },
      refetchQueries: [
        { query: GetNetworkPolicies, variables: { organisationId: organisation?.id } },
      ],
    })

    toast.success('Updated network access policy')
    closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Edit Network Access Policy"
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaEdit /> Edit policy
        </>
      }
    >
      <div className="text-neutral-500">Edit the allow-list of IP addresses or CIDR ranges</div>

      <NetworkAccessPolicyForm
        initialName={policy.name}
        initialIps={policy.allowedIps.split(',')}
        clientIp={clientIp}
        onSubmit={handleSubmit}
        onCancel={closeModal}
        loading={updateIsPending}
        submitLabel="Update"
        disabled={!userCanUpdateNetworkPolicies}
      />
    </GenericDialog>
  )
}
