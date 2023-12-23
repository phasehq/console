import { EnvironmentSyncType, ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { useState } from 'react'
import { FaCheck, FaEdit, FaTimes } from 'react-icons/fa'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
//import UpdateCfPagesSyncCreds from '@/graphql/mutations/syncing/cloudflare/UpdateCfPagesSyncCreds.gql'
import UpdateProviderCreds from '@/graphql/mutations/syncing/updateProviderCreds.gql'
import { useMutation, useQuery } from '@apollo/client'
import { encryptAsymmetric } from '@/utils/crypto'
import { toast } from 'react-toastify'
import { Input } from '@/components/common/Input'
import { encryptProviderCredentials } from '@/utils/syncing/general'

interface CredentialState {
  [key: string]: string
}

export const UpdateProviderCredentials = (props: { credential: ProviderCredentialsType }) => {
  const { credential } = props

  //const credentials = JSON.parse(credential.credentials)

  const { data } = useQuery(GetServerKey)
  const [updateCredentials] = useMutation(UpdateProviderCreds)
  const [name, setName] = useState<string>(credential.name)
  const [credentials, setCredentials] = useState<CredentialState>(
    JSON.parse(credential.credentials)
  )
  const [allowEdit, setAllowEdit] = useState(false)

  const credentialsUpdated = true
  //accountId !== credentials.account_id || accessToken !== credentials.access_token

  const handleCredentialChange = (key: string, value: string) => {
    setCredentials({ ...credentials, [key]: value })
  }

  const handleUpdateCredentials = async () => {
    const encryptedCredentials = JSON.stringify(
      await encryptProviderCredentials(credential.provider!, credentials, data.serverPublicKey)
    )

    await updateCredentials({
      variables: {
        credentialId: credential.id,
        name,
        credentials: encryptedCredentials,
      },
    })

    setAllowEdit(false)
    toast.success('Saved credentials')
  }

  return (
    <div className="space-y-4 w-full py-4 border-y border-neutral-500/40">
      <div className="text-black dark:text-white font-semibold text-xl flex justify-between">
        Credentials
        {allowEdit ? (
          <div className="flex items-center gap-2">
            <Button
              disabled={!credentialsUpdated}
              variant="primary"
              onClick={handleUpdateCredentials}
            >
              <FaCheck /> Save
            </Button>{' '}
            <Button
              variant={credentialsUpdated ? 'danger' : 'secondary'}
              onClick={() => setAllowEdit(false)}
            >
              <FaTimes /> {credentialsUpdated ? 'Discard' : 'Cancel'}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAllowEdit(true)}>
            <FaEdit /> Edit
          </Button>
        )}
      </div>

      <Input
        required
        value={name}
        setValue={(value) => setName(value)}
        label="Name"
        readOnly={!allowEdit}
        disabled={!allowEdit}
      />

      {credential.provider?.expectedCredentials.map((credential: string) => (
        <Input
          key={credential}
          value={credentials[credential]}
          setValue={(value) => handleCredentialChange(credential, value)}
          label={credential.toUpperCase()}
          required
          secret={true}
          readOnly={!allowEdit}
          disabled={!allowEdit}
        />
      ))}
    </div>
  )
}
