'use client'

import { useApolloClient } from '@apollo/client'
import { useCallback, useEffect, useState } from 'react'
import { FaCog } from 'react-icons/fa'
import type { ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import GetSavedCredential from '@/graphql/queries/syncing/getSavedCredential.gql'
import type { IntegrationCredentialSummary } from '@/utils/integrationCredentials'
import { UpdateProviderCredentials } from './UpdateProviderCredentials'

type ProviderCredentialManagerProps = {
  credential: IntegrationCredentialSummary
  onChanged: () => void | Promise<unknown>
}

export const ProviderCredentialEditor = ({
  credential,
  onChanged,
}: ProviderCredentialManagerProps) => {
  const client = useApolloClient()
  const [detail, setDetail] = useState<ProviderCredentialsType>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadCredential = useCallback(async () => {
    setLoading(true)
    setError('')
    setDetail(undefined)
    try {
      const result = await client.query<{ providerCredential?: ProviderCredentialsType | null }>({
        query: GetSavedCredential,
        variables: { credentialId: credential.id },
        fetchPolicy: 'no-cache',
      })
      if (!result.data.providerCredential) throw new Error('Credential not found')
      setDetail(result.data.providerCredential)
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Could not load credential')
    } finally {
      setLoading(false)
    }
  }, [client, credential.id])

  useEffect(() => {
    void loadCredential()
  }, [loadCredential])

  if (loading)
    return (
      <div className="space-y-3 py-6" aria-label="Loading credential">
        <div className="h-9 animate-pulse rounded-md bg-neutral-500/10 motion-reduce:animate-none" />
        <div className="h-9 animate-pulse rounded-md bg-neutral-500/10 motion-reduce:animate-none" />
        <div className="h-9 animate-pulse rounded-md bg-neutral-500/10 motion-reduce:animate-none" />
      </div>
    )

  if (error)
    return (
      <div className="space-y-3 py-6">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
        <Button type="button" variant="secondary" onClick={() => void loadCredential()}>
          Retry
        </Button>
      </div>
    )

  return detail ? <UpdateProviderCredentials credential={detail} onChanged={onChanged} /> : null
}

export const ProviderCredentialManagerDialog = ({
  credential,
  onChanged,
}: ProviderCredentialManagerProps) => {
  const [isActive, setIsActive] = useState(false)

  return (
    <GenericDialog
      title={`Manage ${credential.name}`}
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaCog /> Manage
        </>
      }
      onOpen={() => setIsActive(true)}
      onClose={() => setIsActive(false)}
      size="md"
    >
      {isActive && <ProviderCredentialEditor credential={credential} onChanged={onChanged} />}
    </GenericDialog>
  )
}
