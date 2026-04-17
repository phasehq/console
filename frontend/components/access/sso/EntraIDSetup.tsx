'use client'

import { useState } from 'react'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import CopyButton from '@/components/common/CopyButton'
import { encryptAsymmetric } from '@/utils/crypto/general'
import { useMutation } from '@apollo/client'
import { CreateOrgSSOProvider } from '@/graphql/mutations/sso/createOrgSSOProvider.gql'
import { UpdateOrgSSOProvider } from '@/graphql/mutations/sso/updateOrgSSOProvider.gql'
import { toast } from 'react-toastify'
import { getHostname } from '@/utils/appConfig'
import { Alert } from '@/components/common/Alert'
import { FaExternalLinkAlt } from 'react-icons/fa'

interface EntraIDSetupProps {
  orgId: string
  serverPublicKey: string
  existingProvider?: {
    id: string
    name: string
    publicConfig: Record<string, string>
  } | null
  onSuccess: () => void
  onCancel: () => void
}

export const EntraIDSetup = ({
  orgId,
  serverPublicKey,
  existingProvider,
  onSuccess,
  onCancel,
}: EntraIDSetupProps) => {
  const isEditing = !!existingProvider

  const initialName = existingProvider?.name || 'Microsoft Entra ID'
  const initialTenantId = existingProvider?.publicConfig?.tenant_id || ''
  const initialClientId = existingProvider?.publicConfig?.client_id || ''

  const [name, setName] = useState(initialName)
  const [tenantId, setTenantId] = useState(initialTenantId)
  const [clientId, setClientId] = useState(initialClientId)
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)

  const hasChanges = !isEditing ||
    name !== initialName ||
    tenantId !== initialTenantId ||
    clientId !== initialClientId ||
    clientSecret !== ''

  const [createProvider] = useMutation(CreateOrgSSOProvider)
  const [updateProvider] = useMutation(UpdateOrgSSOProvider)

  const redirectUri = `${getHostname()}/api/auth/callback/entra-id-oidc`

  const handleSave = async () => {
    if (!tenantId || !clientId || (!isEditing && !clientSecret)) {
      toast.error('Please fill in all required fields')
      return
    }

    // Validate tenant ID is a UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(tenantId)) {
      toast.error('Tenant ID must be a valid UUID')
      return
    }

    setSaving(true)
    try {
      const config: Record<string, string> = {
        tenant_id: tenantId,
        client_id: clientId,
      }

      // Only encrypt and include client_secret if provided
      if (clientSecret) {
        config.client_secret = await encryptAsymmetric(clientSecret, serverPublicKey)
      }

      if (isEditing) {
        await updateProvider({
          variables: {
            providerId: existingProvider!.id,
            name,
            config: JSON.stringify(config),
          },
        })
        toast.success('SSO provider updated')
      } else {
        await createProvider({
          variables: {
            orgId,
            providerType: 'entra_id',
            name,
            config: JSON.stringify(config),
          },
        })
        toast.success('SSO provider configured')
      }

      onSuccess()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save SSO configuration')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 py-4">
      <Alert variant="info" icon>
        <div className="space-y-1">
          <p>
            To configure Entra ID OIDC, register a new application in the{' '}
            <a
              href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline inline-flex items-center gap-1"
            >
              Azure Portal <FaExternalLinkAlt className="text-2xs" />
            </a>
          </p>
          <p>Add the following redirect URI to your app registration:</p>
        </div>
      </Alert>

      <div className="space-y-1">
        <label className="block text-neutral-500 text-xs">Redirect URI</label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md px-3 py-2 text-emerald-600 dark:text-emerald-400 font-mono break-all">
            {redirectUri}
          </code>
          <CopyButton value={redirectUri} />
        </div>
      </div>

      <Input value={name} setValue={setName} label="Display Name" required />

      <Input
        value={tenantId}
        setValue={setTenantId}
        label="Tenant ID"
        placeholder="72f988bf-86f1-41af-91ab-2d7cd011db47"
        required
      />

      <Input
        value={clientId}
        setValue={setClientId}
        label="Client ID (Application ID)"
        placeholder="6731de76-14a6-49ae-97bc-6eba6914391e"
        required
      />

      <Input
        value={clientSecret}
        setValue={setClientSecret}
        label={isEditing ? 'Client Secret (leave blank to keep existing)' : 'Client Secret'}
        placeholder={isEditing ? '•'.repeat(40) : 'Enter client secret'}
        secret
        required={!isEditing}
      />

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} isLoading={saving} disabled={saving || !hasChanges}>
          {isEditing ? 'Update' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
