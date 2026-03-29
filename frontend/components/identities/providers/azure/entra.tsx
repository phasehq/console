'use client'

import { useState, useMemo, useEffect } from 'react'
import { useMutation } from '@apollo/client'
import CreateIdentity from '@/graphql/mutations/identities/createIdentity.gql'
import UpdateIdentity from '@/graphql/mutations/identities/updateIdentity.gql'
import GetOrganisationIdentities from '@/graphql/queries/identities/getOrganisationIdentities.gql'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { parseTTL, formatTTL, isValidTTL, getTTLExamples } from '@/utils/ttl'
import { IdentityType } from '@/apollo/graphql'
import type { AzureEntraConfigType } from '@/apollo/graphql'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface AzureEntraIdentityFormProps {
  organisationId: string
  identity?: IdentityType | null
  onSuccess: () => void
  onBack?: () => void
}

export const AzureEntraIdentityForm = ({
  organisationId,
  identity,
  onSuccess,
  onBack,
}: AzureEntraIdentityFormProps) => {
  const [createIdentity, { loading: creating }] = useMutation(CreateIdentity)
  const [updateIdentity, { loading: updating }] = useMutation(UpdateIdentity)

  const [initialState, setInitialState] = useState<{
    name: string
    description: string
    tenantId: string
    resource: string
    allowedServicePrincipalIds: string
    tokenNamePattern: string
    defaultTtlInput: string
    maxTtlInput: string
    defaultTtlSeconds: number
    maxTtlSeconds: number
  } | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [resource, setResource] = useState('https://management.azure.com/')
  const [allowedServicePrincipalIds, setAllowedServicePrincipalIds] = useState('')
  const [tokenNamePattern, setTokenNamePattern] = useState('')
  const [defaultTtlInput, setDefaultTtlInput] = useState<string>('1h')
  const [maxTtlInput, setMaxTtlInput] = useState<string>('24h')
  const [defaultTtlSeconds, setDefaultTtlSeconds] = useState<number>(3600)
  const [maxTtlSeconds, setMaxTtlSeconds] = useState<number>(86400)

  useEffect(() => {
    if (identity) {
      const cfg = identity.config as AzureEntraConfigType | undefined
      setName(identity.name)
      setDescription(identity.description || '')
      setTenantId(cfg?.tenantId || '')
      setResource(cfg?.resource || 'https://management.azure.com/')
      setAllowedServicePrincipalIds(
        cfg?.allowedServicePrincipalIds?.join(', ') || ''
      )
      setTokenNamePattern(identity.tokenNamePattern || '')
      setDefaultTtlInput(formatTTL(identity.defaultTtlSeconds))
      setMaxTtlInput(formatTTL(identity.maxTtlSeconds))
      setDefaultTtlSeconds(identity.defaultTtlSeconds)
      setMaxTtlSeconds(identity.maxTtlSeconds)
      setInitialState({
        name: identity.name,
        description: identity.description || '',
        tenantId: cfg?.tenantId || '',
        resource: cfg?.resource || 'https://management.azure.com/',
        allowedServicePrincipalIds:
          cfg?.allowedServicePrincipalIds?.join(', ') || '',
        tokenNamePattern: identity.tokenNamePattern || '',
        defaultTtlInput: formatTTL(identity.defaultTtlSeconds),
        maxTtlInput: formatTTL(identity.maxTtlSeconds),
        defaultTtlSeconds: identity.defaultTtlSeconds,
        maxTtlSeconds: identity.maxTtlSeconds,
      })
    }
  }, [identity])

  const handleDefaultTtlChange = (value: string) => {
    setDefaultTtlInput(value)
    if (isValidTTL(value)) {
      setDefaultTtlSeconds(parseTTL(value))
    }
  }

  const handleMaxTtlChange = (value: string) => {
    setMaxTtlInput(value)
    if (isValidTTL(value)) {
      setMaxTtlSeconds(parseTTL(value))
    }
  }

  const isValidTenantId = tenantId === '' || UUID_REGEX.test(tenantId)

  const handleSave = async () => {
    if (defaultTtlSeconds > maxTtlSeconds) {
      toast.error('Default token expiry must be less than or equal to Maximum token expiry')
      return
    }
    if (allowedServicePrincipalIds.trim() === '*') {
      toast.error("'*' is not allowed as a trusted principal pattern")
      return
    }
    if (!UUID_REGEX.test(tenantId)) {
      toast.error('Tenant ID must be a valid UUID')
      return
    }

    try {
      if (identity) {
        await updateIdentity({
          variables: {
            id: identity.id,
            name,
            description: description || null,
            trustedPrincipals: allowedServicePrincipalIds,
            tenantId,
            resource,
            tokenNamePattern: tokenNamePattern || null,
            defaultTtlSeconds,
            maxTtlSeconds,
          },
        })
        toast.success('Identity updated')
      } else {
        await createIdentity({
          variables: {
            organisationId,
            provider: 'azure_entra',
            name,
            description: description || null,
            trustedPrincipals: allowedServicePrincipalIds,
            tenantId,
            resource,
            tokenNamePattern: tokenNamePattern || null,
            defaultTtlSeconds,
            maxTtlSeconds,
          },
          refetchQueries: [{ query: GetOrganisationIdentities, variables: { organisationId } }],
        })
        toast.success('Created new Azure External Identity')
      }
      onSuccess()
    } catch (e: any) {
      const hasGraphQLErrors = Array.isArray(e?.graphQLErrors) && e.graphQLErrors.length > 0
      if (!hasGraphQLErrors) {
        toast.error('Failed to create External Identity')
      } else {
        toast.error(e.message)
      }
    }
  }

  const isSaving = creating || updating

  const hasChanges = useMemo(() => {
    if (!initialState) return true
    return (
      name !== initialState.name ||
      description !== initialState.description ||
      tenantId !== initialState.tenantId ||
      resource !== initialState.resource ||
      allowedServicePrincipalIds !== initialState.allowedServicePrincipalIds ||
      tokenNamePattern !== initialState.tokenNamePattern ||
      defaultTtlInput !== initialState.defaultTtlInput ||
      maxTtlInput !== initialState.maxTtlInput
    )
  }, [
    name,
    description,
    tenantId,
    resource,
    allowedServicePrincipalIds,
    tokenNamePattern,
    defaultTtlInput,
    maxTtlInput,
    initialState,
  ])

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        <div className="space-y-2">
          <Input
            value={name}
            setValue={setName}
            label="Identity name"
            placeholder="e.g. prod-azure-identity"
            required
            maxLength={100}
          />
          <Input
            value={description}
            setValue={setDescription}
            label="Description (optional)"
            placeholder="e.g. production AKS workload identity"
          />
        </div>

        <div className="space-y-2">
          <div className="font-medium text-black dark:text-white">Azure configuration</div>
          <Input
            value={tenantId}
            setValue={setTenantId}
            label="Tenant ID"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            required
          />
          {tenantId && !isValidTenantId && (
            <p className="text-red-500 text-xs">Tenant ID must be a valid UUID</p>
          )}
          <Input
            value={resource}
            setValue={setResource}
            label="Resource / Audience"
            placeholder="https://management.azure.com/"
            required
          />
          <p className="text-neutral-500 text-xs">
            The App ID URI that maps to the IMDS <code>?resource=</code> parameter and the JWT{' '}
            <code>aud</code> claim
          </p>
        </div>

        <div className="space-y-2">
          <div className="font-medium text-black dark:text-white">Trusted entities</div>
          <div className="space-y-2">
            <label className="block text-neutral-500 text-sm font-bold mb-2">
              Allowed Service Principal IDs <span className="text-red-500 ml-1">*</span>
            </label>
            <textarea
              rows={2}
              value={allowedServicePrincipalIds}
              className="w-full"
              onChange={(e) => setAllowedServicePrincipalIds(e.target.value)}
              placeholder="a1b2c3d4-e5f6-7890-abcd-ef1234567890, b2c3d4e5-f6a7-8901-bcde-f12345678901"
              required
            />
            <p className="text-neutral-500 text-xs">
              Comma-separated Azure AD service principal object IDs (matched against the{' '}
              <code>oid</code> claim in the JWT)
            </p>
          </div>
        </div>

        <div className="py-2">
          <div className="border-b border-neutral-500/40 w-full"></div>
        </div>

        <div className="space-y-4">
          <div className="font-medium text-black dark:text-white">Token configuration</div>
          <Input
            value={tokenNamePattern}
            setValue={setTokenNamePattern}
            label="Token name"
            placeholder="Optional identifier (e.g. prod, staging)"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              value={defaultTtlInput}
              setValue={handleDefaultTtlChange}
              label="Default TTL"
              placeholder={getTTLExamples().join(', ')}
              required
            />
            <Input
              value={maxTtlInput}
              setValue={handleMaxTtlChange}
              label="Max TTL"
              placeholder={getTTLExamples().join(', ')}
              required
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-4">
          <div>
            {onBack && (
              <Button variant="secondary" onClick={onBack}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={handleSave}
              isLoading={isSaving}
              disabled={
                !hasChanges ||
                !name ||
                !tenantId ||
                !UUID_REGEX.test(tenantId) ||
                !resource ||
                !allowedServicePrincipalIds ||
                !isValidTTL(defaultTtlInput) ||
                !isValidTTL(maxTtlInput)
              }
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
