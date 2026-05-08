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

interface OktaSetupProps {
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

export const OktaSetup = ({
  orgId,
  serverPublicKey,
  existingProvider,
  onSuccess,
  onCancel,
}: OktaSetupProps) => {
  const isEditing = !!existingProvider

  const initialName = existingProvider?.name || 'Okta'
  const initialIssuer = existingProvider?.publicConfig?.issuer || ''
  const initialClientId = existingProvider?.publicConfig?.client_id || ''

  const [name, setName] = useState(initialName)
  const [issuer, setIssuer] = useState(initialIssuer)
  const [clientId, setClientId] = useState(initialClientId)
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)

  const hasChanges = !isEditing ||
    name !== initialName ||
    issuer !== initialIssuer ||
    clientId !== initialClientId ||
    clientSecret !== ''

  const [createProvider] = useMutation(CreateOrgSSOProvider)
  const [updateProvider] = useMutation(UpdateOrgSSOProvider)

  const redirectUri = `${getHostname()}/api/auth/callback/okta-oidc`

  const handleSave = async () => {
    if (!issuer || !clientId || (!isEditing && !clientSecret)) {
      toast.error('Please fill in all required fields')
      return
    }

    // Validate issuer URL format
    try {
      const url = new URL(issuer)
      if (url.protocol !== 'https:') {
        toast.error('Issuer URL must use HTTPS')
        return
      }
    } catch {
      toast.error('Invalid issuer URL')
      return
    }

    setSaving(true)
    try {
      const config: Record<string, string> = {
        issuer: issuer.replace(/\/$/, ''),
        client_id: clientId,
      }

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
            providerType: 'okta',
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
            Create an OIDC application in your{' '}
            <a
              href="https://login.okta.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline inline-flex items-center gap-1"
            >
              Okta admin console <FaExternalLinkAlt className="text-2xs" />
            </a>
          </p>
          <p>Add the following redirect URI to your Okta application:</p>
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
        value={issuer}
        setValue={setIssuer}
        label="Issuer URL"
        placeholder="https://dev-12345.okta.com"
        required
      />

      <Input
        value={clientId}
        setValue={setClientId}
        label="Client ID"
        placeholder="0oaxxxxxxxxxxxxxxxx"
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
