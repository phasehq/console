import { ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { useContext, useEffect, useState } from 'react'
import { FaCheck } from 'react-icons/fa'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'

import UpdateProviderCreds from '@/graphql/mutations/syncing/updateProviderCreds.gql'
import ValidateRotationCredentials from '@/graphql/mutations/syncing/validateRotationCredentials.gql'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { Input } from '@/components/common/Input'
import { encryptProviderCredentials, isCredentialSecret } from '@/utils/syncing/general'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
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
  const [validateRotationCreds] = useMutation(ValidateRotationCredentials)
  const [name, setName] = useState<string>(credential.name)
  const [credentials, setCredentials] = useState<CredentialState>(
    JSON.parse(credential.credentials)
  )

  const [credentialsUpdated, setCredentialsUpdated] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const ROTATION_PROVIDER_IDS = ['litellm', 'openai']

  useEffect(() => {
    const credsAreEqual = isEqual(credentials, JSON.parse(credential.credentials))
    const nameIsEqual = isEqual(name, credential.name)

    setCredentialsUpdated(!credsAreEqual || !nameIsEqual)
  }, [credentials, credential.credentials, credential.name, name])

  const handleCredentialChange = (key: string, value: string) => {
    setValidationError(null)
    setCredentials({ ...credentials, [key]: value })
  }

  const handleNameChange = (newName: string) => {
    setName(newName)
  }

  const handleSaveUpdatedCredentials = async () => {
    setValidationError(null)

    const encryptedCredentials = JSON.stringify(
      await encryptProviderCredentials(credential.provider!, credentials, data.serverPublicKey)
    )

    if (credential.provider && ROTATION_PROVIDER_IDS.includes(credential.provider.id!)) {
      setValidating(true)
      try {
        const { data: validationData } = await validateRotationCreds({
          variables: {
            organisationId: organisation!.id,
            providerId: credential.provider.id,
            credentials: encryptedCredentials,
          },
        })
        const result = validationData?.validateRotationCredentials
        if (!result?.valid) {
          setValidationError(
            result?.error ||
              'The provider rejected these credentials. Verify the key is correct.'
          )
          return
        }
      } catch (err) {
        setValidationError('Could not reach the provider to validate credentials.')
        return
      } finally {
        setValidating(false)
      }
    }

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

  const allowEdit = userHasPermission(
    organisation?.role?.permissions,
    'IntegrationCredentials',
    'update'
  )

  const allowDelete = userHasPermission(
    organisation?.role?.permissions,
    'IntegrationCredentials',
    'delete'
  )

  return (
    <div className="space-y-4 w-full pt-4">
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

      {/* Render all expected and optional credential fields (except region which has special handling) */}
      {credential.provider?.expectedCredentials.concat(credential.provider?.optionalCredentials || []).filter(field => field !== 'region').map((credentialKey: string) => {
        const isRequired = credential.provider?.expectedCredentials.includes(credentialKey) ?? false
        const isOptional = credential.provider?.optionalCredentials?.includes(credentialKey) ?? false
        
        return (
          <Input
            key={credentialKey}
            value={credentials[credentialKey] || ''}
            setValue={(value) => handleCredentialChange(credentialKey, value)}
            label={`${credentialKey.replace(/_/g, ' ').toUpperCase()}${isOptional ? ' (Optional)' : ''}`}
            required={isRequired}
            secret={isCredentialSecret(credentialKey)}
            readOnly={!allowEdit}
            disabled={!allowEdit}
          />
        )
      })}

      {(credential.provider?.id === 'aws' || credential.provider?.id === 'aws_assume_role') && (
        <AWSRegionPicker 
          value={credentials['region']} 
          onChange={(region) => handleCredentialChange('region', region)} 
        />
      )}
      {validationError && (
        <div
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-2xs text-red-600 dark:text-red-300"
          role="alert"
        >
          {validationError}
        </div>
      )}
      <div className="flex justify-between pt-6">
        <div>
          {allowDelete && (
            <DeleteProviderCredentialDialog credential={credential} orgId={organisation!.id} />
          )}
        </div>
        <Button
          disabled={!credentialsUpdated || validating}
          variant="primary"
          onClick={handleSaveUpdatedCredentials}
          isLoading={validating}
        >
          <FaCheck /> {validating ? 'Validating…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
