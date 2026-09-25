import { ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { useContext, useEffect, useRef, useState } from 'react'
import { FaCheck } from 'react-icons/fa'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'

import UpdateProviderCreds from '@/graphql/mutations/syncing/updateProviderCreds.gql'
import ValidateRotationCredentials from '@/graphql/mutations/syncing/validateRotationCredentials.gql'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { Input } from '@/components/common/Input'
import { encryptProviderCredentials, isCredentialSecret } from '@/utils/syncing/general'
import { generateExternalId } from '@/utils/syncing/aws'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { ProviderIcon } from './ProviderIcon'
import { AWSRegionPicker } from './AWS/AWSRegionPicker'
import { DatadogSitePicker } from './Datadog/DatadogSitePicker'
import { DeleteProviderCredentialDialog } from './DeleteProviderCredentialDialog'
import { GCPWorkloadIdentityDetails } from './GCP/GCPWorkloadIdentityDetails'
import { isEqual, omit, union } from 'lodash'

interface CredentialState {
  [key: string]: string
}

type SavedCredentialState = {
  name: string
  credentials: CredentialState
}

const credentialLabel = (key: string) => key.replace(/_/g, ' ').toUpperCase()

const parseCredentialState = (credentials?: string | null): CredentialState =>
  JSON.parse(credentials || '{}') ?? {}

export const UpdateProviderCredentials = (props: {
  credential: ProviderCredentialsType
  onChanged?: () => void | Promise<unknown>
}) => {
  const { credential } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data } = useQuery(GetServerKey)
  const [updateCredentials, { loading: updateIsPending }] = useMutation(UpdateProviderCreds)
  const [validateRotationCreds] = useMutation(ValidateRotationCredentials)
  const [name, setName] = useState<string>(credential.name)
  // Holds non-sensitive values plus any sealed value typed here. Sealed values
  // are write-only: the server only says which ones are stored. Both are
  // withheld (null) without IntegrationCredentials read.
  const [credentials, setCredentials] = useState<CredentialState>(() =>
    parseCredentialState(credential.credentials)
  )
  const [savedCredential, setSavedCredential] = useState<SavedCredentialState>(() => ({
    name: credential.name,
    credentials: parseCredentialState(credential.credentials),
  }))
  const [storedSealedKeys, setStoredSealedKeys] = useState<string[]>(
    credential.sealedCredentials ?? []
  )
  const latestRevision = useRef(String(credential.revision))

  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const ROTATION_PROVIDER_IDS = ['litellm', 'openai']
  const provider = credential.provider
  const credentialKeys = (provider?.expectedCredentials ?? []).concat(
    provider?.optionalCredentials ?? []
  )
  const sealedKeys = credentialKeys.filter((key) =>
    isCredentialSecret(key, provider?.nonSensitiveCredentials ?? [])
  )
  // Moving an endpoint means re-entering the sealed values the server holds
  const movedEndpoints = (provider?.endpointCredentials ?? []).filter(
    (key) => (credentials[key] ?? '') !== (savedCredential.credentials[key] ?? '')
  )
  const credentialsUpdated =
    !isEqual(credentials, savedCredential.credentials) || name !== savedCredential.name

  useEffect(() => {
    latestRevision.current = String(credential.revision)
  }, [credential.id, credential.revision])

  const handleCredentialChange = (key: string, value: string) => {
    setValidationError(null)
    // A blank sealed field keeps the stored value, so it is not an edit
    setCredentials(
      sealedKeys.includes(key) && !value ? omit(credentials, key) : { ...credentials, [key]: value }
    )
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

      // Only re-entered secrets can be validated; kept ones never reach the browser
      if (
        ROTATION_PROVIDER_IDS.includes(provider?.id ?? '') &&
        sealedKeys.some((key) => credentials[key])
      ) {
        setValidating(true)
        try {
          const { data: validationData } = await validateRotationCreds({
            variables: {
              organisationId: organisation!.id,
              providerId: provider!.id,
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
      // Saved sealed values are write-only from here on
      const visibleCredentials = omit(credentials, sealedKeys)
      const savedSealedKeys = sealedKeys.filter((key) => credentials[key])
      setStoredSealedKeys(union(storedSealedKeys, savedSealedKeys))
      setCredentials(visibleCredentials)
      setSavedCredential({ name, credentials: visibleCredentials })
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
      {credentialKeys
        .filter(
          (field) =>
            field !== 'region' &&
            !(provider?.id === 'datadog' && field === 'site') &&
            provider?.id !== 'gcp'
        )
        .map((credentialKey: string) => {
          const isRequired = provider?.expectedCredentials.includes(credentialKey) ?? false
          const isOptional = provider?.optionalCredentials?.includes(credentialKey) ?? false
          const isSealed = sealedKeys.includes(credentialKey)
          const isStored = isSealed && storedSealedKeys.includes(credentialKey)
          const mustReenter = isStored && movedEndpoints.length > 0

          const input = (
            <Input
              key={credentialKey}
              value={credentials[credentialKey] || ''}
              setValue={(value) => handleCredentialChange(credentialKey, value)}
              label={`${credentialLabel(credentialKey)}${isOptional ? ' (Optional)' : ''}`}
              placeholder={
                mustReenter
                  ? `Re-enter to change ${movedEndpoints.map(credentialLabel).join(', ')}`
                  : isStored
                    ? '•'.repeat(40)
                    : undefined
              }
              required={isRequired || mustReenter}
              secret={isSealed}
              readOnly={!allowEdit}
              disabled={!allowEdit}
            />
          )

          if (provider?.id !== 'aws_assume_role' || credentialKey !== 'external_id') return input

          // The stored External ID can't be shown, so replacing it must hand the
          // new one over for the role's trust policy
          const externalId = credentials[credentialKey]
          return (
            <div key={credentialKey} className="space-y-2">
              <div className="flex items-end gap-2">
                {input}
                {allowEdit && (
                  <Button
                    type="button"
                    variant="secondary"
                    classString="shrink-0"
                    onClick={async () =>
                      handleCredentialChange(credentialKey, await generateExternalId())
                    }
                  >
                    {isStored ? 'Regenerate' : 'Generate'}
                  </Button>
                )}
                {externalId && (
                  <div className="shrink-0">
                    <CopyButton value={externalId} />
                  </div>
                )}
              </div>
              {externalId && (
                <p className="text-2xs text-neutral-500">
                  Add this External ID to the role&apos;s trust policy, then save.
                </p>
              )}
            </div>
          )
        })}

      {(credential.provider?.id === 'aws' || credential.provider?.id === 'aws_assume_role') && (
        <AWSRegionPicker
          value={credentials['region']}
          onChange={(region) => handleCredentialChange('region', region)}
          disabled={!allowEdit}
        />
      )}
      {/* Google Cloud: only the provider name is editable; Phase minted the rest */}
      {credential.provider?.id === 'gcp' && credential.credentials && (
        <>
          <Input
            value={credentials['workload_identity_provider'] || ''}
            setValue={(value) => handleCredentialChange('workload_identity_provider', value)}
            label="WORKLOAD IDENTITY PROVIDER"
            required
            readOnly={!allowEdit}
            disabled={!allowEdit}
          />
          <GCPWorkloadIdentityDetails credentials={credentials} />
        </>
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
