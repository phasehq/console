import { ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { useContext, useState } from 'react'
import { FaCheck, FaEdit, FaTimes } from 'react-icons/fa'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'

import UpdateProviderCreds from '@/graphql/mutations/syncing/updateProviderCreds.gql'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { Input } from '@/components/common/Input'
import { encryptProviderCredentials } from '@/utils/syncing/general'
import { organisationContext } from '@/contexts/organisationContext'
import { userIsAdmin } from '@/utils/permissions'
import { ProviderIcon } from './ProviderIcon'
import { AWSRegionPicker } from './AWS/AWSRegionPicker'

interface CredentialState {
  [key: string]: string
}

export const UpdateProviderCredentials = (props: { credential: ProviderCredentialsType }) => {
  const { credential } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data } = useQuery(GetServerKey)
  const [updateCredentials] = useMutation(UpdateProviderCreds)
  const [name, setName] = useState<string>(credential.name)
  const [credentials, setCredentials] = useState<CredentialState>(
    JSON.parse(credential.credentials)
  )
  const [allowEdit, setAllowEdit] = useState(false)

  const credentialsUpdated = true

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

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  return (
    <div className="space-y-4 w-full py-4">
      <div className="text-black dark:text-white font-semibold text-xl flex justify-between">
        <div className="flex items-center gap-2">
          {' '}
          <ProviderIcon providerId={credential.provider?.id!} /> {credential.provider?.name}{' '}
          Credentials
        </div>
        {activeUserIsAdmin && (
          <div>
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

      {credential.provider?.expectedCredentials
        .filter((credential) => credential !== 'region')
        .map((credential: string) => (
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

      {credential.provider?.id === 'aws' && (
        <AWSRegionPicker onChange={(region) => handleCredentialChange('region', region)} />
      )}
    </div>
  )
}
