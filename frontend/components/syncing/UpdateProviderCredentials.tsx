import { ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { useContext, useEffect, useId, useRef, useState } from 'react'
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
import { DatadogSitePicker } from './Datadog/DatadogSitePicker'
import { DeleteProviderCredentialDialog } from './DeleteProviderCredentialDialog'
import { isEqual } from 'lodash'

interface CredentialState {
  [key: string]: string
}

type SavedCredentialState = {
  name: string
  credentials: CredentialState
}

const POSTGRES_BOUND_ROUTING_FIELDS = new Set(['username', 'host', 'port', 'database'])

const parseCredentialState = (credentials?: string | null): CredentialState =>
  JSON.parse(credentials || '{}') ?? {}

export const UpdateProviderCredentials = (props: {
  credential: ProviderCredentialsType
  onChanged?: () => void | Promise<unknown>
}) => {
  const { credential } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const postgresRoutingLockDescriptionId = useId()

  const { data } = useQuery(GetServerKey)
  const [updateCredentials, { loading: updateIsPending }] = useMutation(UpdateProviderCreds)
  const [validateRotationCreds] = useMutation(ValidateRotationCredentials)
  const [name, setName] = useState<string>(credential.name)
  // credentials is withheld (null) without IntegrationCredentials read
  const [credentials, setCredentials] = useState<CredentialState>(() =>
    parseCredentialState(credential.credentials)
  )
  const [savedCredential, setSavedCredential] = useState<SavedCredentialState>(() => ({
    name: credential.name,
    credentials: parseCredentialState(credential.credentials),
  }))
  const latestRevision = useRef(String(credential.revision))

  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const ROTATION_PROVIDER_IDS = ['litellm', 'openai']
  const credentialsUpdated =
    !isEqual(credentials, savedCredential.credentials) || name !== savedCredential.name
  const boundAgentConnectionCount = credential.agentConnectionCount ?? 0
  const locksPostgresRouting =
    credential.provider?.id?.toLowerCase() === 'postgres' && boundAgentConnectionCount > 0

  useEffect(() => {
    latestRevision.current = String(credential.revision)
  }, [credential.id, credential.revision])

  const handleCredentialChange = (key: string, value: string) => {
    setValidationError(null)
    setCredentials({ ...credentials, [key]: value })
  }

  const handleNameChange = (newName: string) => {
    setName(newName)
  }

  const handleSaveUpdatedCredentials = async () => {
    setValidationError(null)
    try {
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
              result?.error || 'The provider rejected these credentials. Verify the key is correct.'
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

      const result = await updateCredentials({
        variables: {
          credentialId: credential.id,
          expectedRevision: latestRevision.current,
          name,
          credentials: encryptedCredentials,
        },
      })
      const updatedRevision = result.data?.updateProviderCredentials?.credential?.revision
      if (!updatedRevision) {
        setValidationError(
          'The updated credential revision was not returned. Refresh and try again.'
        )
        return
      }
      latestRevision.current = String(updatedRevision)
      setSavedCredential({ name, credentials: { ...credentials } })
      await props.onChanged?.()
      toast.success('Saved credentials')
    } catch (error) {
      setValidationError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not save credentials. Try again.'
      )
    }
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

      {locksPostgresRouting && (
        <p
          id={postgresRoutingLockDescriptionId}
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
          This credential is used by {boundAgentConnectionCount} Agent Connection
          {boundAgentConnectionCount === 1 ? '' : 's'}. Username, host, port, and database are
          locked. To change them, create a new credential and switch the affected Connection
          {boundAgentConnectionCount === 1 ? '' : 's'} to it. You can still rotate the password
          here.
        </p>
      )}

      <Input
        required
        value={name}
        setValue={(value) => handleNameChange(value)}
        label="Name"
        readOnly={!allowEdit}
        disabled={!allowEdit}
      />

      {/* Render all expected and optional credential fields (except region and
          the Datadog site, which get dedicated pickers) */}
      {credential.provider?.expectedCredentials
        .concat(credential.provider?.optionalCredentials || [])
        .filter(
          (field) =>
            field !== 'region' && !(credential.provider?.id === 'datadog' && field === 'site')
        )
        .map((credentialKey: string) => {
          const isRequired =
            credential.provider?.expectedCredentials.includes(credentialKey) ?? false
          const isOptional =
            credential.provider?.optionalCredentials?.includes(credentialKey) ?? false
          const routingFieldIsLocked =
            locksPostgresRouting && POSTGRES_BOUND_ROUTING_FIELDS.has(credentialKey)

          return (
            <Input
              key={credentialKey}
              value={credentials[credentialKey] || ''}
              setValue={(value) => handleCredentialChange(credentialKey, value)}
              label={`${credentialKey.replace(/_/g, ' ').toUpperCase()}${isOptional ? ' (Optional)' : ''}`}
              required={isRequired}
              secret={isCredentialSecret(
                credentialKey,
                credential.provider?.nonSensitiveCredentials ?? []
              )}
              readOnly={!allowEdit || routingFieldIsLocked}
              disabled={!allowEdit || routingFieldIsLocked}
              aria-describedby={routingFieldIsLocked ? postgresRoutingLockDescriptionId : undefined}
            />
          )
        })}

      {(credential.provider?.id === 'aws' || credential.provider?.id === 'aws_assume_role') && (
        <AWSRegionPicker
          value={credentials['region']}
          onChange={(region) => handleCredentialChange('region', region)}
          disabled={!allowEdit}
        />
      )}
      {credential.provider?.id === 'datadog' && (
        <DatadogSitePicker
          value={credentials['site']}
          onChange={(site) => handleCredentialChange('site', site)}
          disabled={!allowEdit}
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
            <DeleteProviderCredentialDialog
              credential={credential}
              orgId={organisation!.id}
              onDeleted={props.onChanged}
            />
          )}
        </div>
        {allowEdit && (
          <Button
            disabled={!credentialsUpdated || validating || updateIsPending}
            variant="primary"
            onClick={handleSaveUpdatedCredentials}
            isLoading={validating || updateIsPending}
          >
            <FaCheck /> {validating ? 'Validating…' : updateIsPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  )
}
