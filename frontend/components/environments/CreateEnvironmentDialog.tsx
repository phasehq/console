import { FaPlus } from 'react-icons/fa'
import GenericDialog from '../common/GenericDialog'
import { GetOrganisationAdminsAndSelf } from '@/graphql/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { ApiEnvironmentEnvTypeChoices, OrganisationType } from '@/apollo/graphql'
import { useContext, useRef, useState } from 'react'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation, useQuery } from '@apollo/client'
import { createNewEnv } from '@/utils/crypto'
import { CreateEnv } from '@/graphql/mutations/environments/createEnvironment.gql'
import { Button } from '../common/Button'
import { Input } from '../common/Input'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { toast } from 'react-toastify'

export const CreateEnvironmentDialog = (props: { appId: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: orgAdminsData } = useQuery(GetOrganisationAdminsAndSelf, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation,
  })

  const { data: appData } = useQuery(GetAppEnvironments, { variables: { appId: props.appId } })

  const [createEnvironment, { loading }] = useMutation(CreateEnv)

  const [name, setName] = useState('')
  const dialogRef = useRef<{ closeModal: () => void }>(null)

  const handleSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const newEnvData = await createNewEnv(
      props.appId,
      name,
      ApiEnvironmentEnvTypeChoices.Custom,
      orgAdminsData.organisationAdminsAndSelf,
      appData.sseEnabled ? appData.serverPublicKey : null
    )

    await createEnvironment({
      variables: {
        envInput: newEnvData.createEnvPayload,
        adminKeys: newEnvData.adminKeysPayload,
        wrappedSeed: newEnvData.serverKeysPayload.wrappedSeed,
        wrappedSalt: newEnvData.serverKeysPayload.wrappedSalt,
      },
      refetchQueries: [{ query: GetAppEnvironments, variables: { appId: props.appId } }],
    })

    setName('')

    toast.success('Environment created!')

    if (dialogRef.current) {
      dialogRef.current.closeModal()
    }
  }

  const sanitizeInput = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '')

  return (
    <GenericDialog
      title={'Create a new Environment'}
      ref={dialogRef}
      onClose={() => {}}
      buttonVariant={'outline'}
      buttonContent={
        <div className="flex items-center gap-2">
          <FaPlus /> New Environment
        </div>
      }
    >
      <form className="space-y-4 py-4" onSubmit={handleSubmit}>
        <div>
          <p className="text-neutral-500">Create a new Environment in this App</p>
        </div>

        <Input
          value={sanitizeInput(name)}
          setValue={setName}
          label="Environment name"
          required
          maxLength={32}
          data-autofocus
        />

        <div className="flex justify-end">
          <Button type="submit" variant="primary" isLoading={loading}>
            Create
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
