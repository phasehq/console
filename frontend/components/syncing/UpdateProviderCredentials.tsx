import { ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { useContext, useEffect, useState } from 'react'
import { FaCheck } from 'react-icons/fa'
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
import { DeleteProviderCredentialDialog } from './DeleteProviderCredentialDialog'
import { isEqual } from 'lodash'

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

  const [credentialsUpdated, setCredentialsUpdated] = useState(false)

  useEffect(() => {
    const credsAreEqual = isEqual(credentials, JSON.parse(credential.credentials))
    const nameIsEqual = isEqual(name, credential.name)

    setCredentialsUpdated(!credsAreEqual || !nameIsEqual)
  }, [credentials, credential.credentials, credential.name, name])

  const handleCredentialChange = (key: string, value: string) => {
    //setCredentialsUpdated(true)
    setCredentials({ ...credentials, [key]: value })
  }

  const handleNameChange = (newName: string) => {
    //setCredentialsUpdated(true)
    setName(newName)
  }

  const handleSaveUpdatedCredentials = async () => {
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
    setCredentialsUpdated(false)
    toast.success('Saved credentials')
  }

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const allowEdit = activeUserIsAdmin

  const isCredentialSecret = (credential: string) =>
    !/(?:addr|host)/i.test(credential.toLowerCase())

  return (
    <div className="space-y-4 w-full py-4">
      <div className="text-black dark:text-white font-semibold text-xl flex justify-between">
        <div className="flex items-center gap-2">
          {' '}
          <ProviderIcon providerId={credential.provider?.id!} /> {credential.provider?.name}{' '}
          Credentials
        </div>
      </div>

      <Input
        required
        value={name}
        setValue={(value) => handleNameChange(value)}
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
            label={credential.replace(/_/g, ' ').toUpperCase()}
            required
            secret={isCredentialSecret(credential)}
            readOnly={!allowEdit}
            disabled={!allowEdit}
          />
        ))}

      {credential.provider?.optionalCredentials.map((credential: string) => (
        <Input
          key={credential}
          value={credentials[credential]}
          setValue={(value) => handleCredentialChange(credential, value)}
          label={credential.replace(/_/g, ' ').toUpperCase()}
          secret={true}
          readOnly={!allowEdit}
          disabled={!allowEdit}
        />
      ))}

      {credential.provider?.id === 'aws' && (
        <AWSRegionPicker onChange={(region) => handleCredentialChange('region', region)} />
      )}
      <div className="flex justify-between pt-6">
        <DeleteProviderCredentialDialog credential={credential} orgId={organisation!.id} />
        <Button
          disabled={!credentialsUpdated}
          variant="primary"
          onClick={handleSaveUpdatedCredentials}
        >
          <FaCheck /> Save
        </Button>
      </div>
    </div>
  )
}
