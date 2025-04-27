import GenericDialog from '@/components/common/GenericDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { useContext, useRef } from 'react'
import { FaPlus } from 'react-icons/fa'
import { CreateAccessPolicy } from '@/graphql/mutations/access/createNetworkAccessPolicy.gql'
import { GetNetworkPolicies } from '@/graphql/queries/access/getNetworkPolicies.gql'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { NetworkAccessPolicyForm } from '@/components/access/NetworkAccessPolicyForm'

export const CreateNetworkAccessPolicyDialog = ({ clientIp }: { clientIp: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [createPolicy, { loading }] = useMutation(CreateAccessPolicy)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const handleSubmit = async (data: { name: string; ips: string[] }) => {
    const { name, ips } = data

    if (ips.length === 0) {
      toast.error('Please enter atleast 1 IP or CIDR range')
      return
    }

    await createPolicy({
      variables: {
        name,
        allowedIps: ips.join(','),
        isGlobal: false,
        organisationId: organisation?.id,
      },
      refetchQueries: [
        { query: GetNetworkPolicies, variables: { organisationId: organisation?.id } },
      ],
    })

    toast.success('Created new  network access policy')
    closeModal()
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Create Network Access Policy"
      buttonContent={
        <>
          <FaPlus /> Create policy
        </>
      }
    >
      <div className="text-neutral-500">Add an allow-list of IP addresses or CIDR ranges</div>

      <NetworkAccessPolicyForm
        clientIp={clientIp}
        onSubmit={handleSubmit}
        onCancel={closeModal}
        loading={loading}
        submitLabel="Create"
      />
    </GenericDialog>
  )
}
