'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaKey, FaSyncAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import type { ProviderType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { AgentBadge, humanizeAgentValue } from '@/components/agents/AgentUI'
import { isAgentRequestPending, normalizeAgentEnum } from '@/components/agents/AgentEnums'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import type { CreatedProviderCredential } from '@/components/syncing/CreateProviderCredentials'
import { FulfillAgentRequestOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import {
  canonicalIntegrationId,
  type IntegrationCredentialSummary,
} from '@/utils/integrationCredentials'

type AgentIntegrationRequest = {
  id: string
  kind: string
  status: string
  serviceType?: string | null
  credentialProvider?: string | null
  credentialName?: string | null
  revision: string
  progress?: Record<string, unknown> | null
  credential?: IntegrationCredentialSummary | null
  connection?: {
    id: string
    name: string
    authentication?: IntegrationCredentialSummary | null
  } | null
  workflow?: { name: string } | null
  agent: { name: string }
}

const credentialMatches = (credential: IntegrationCredentialSummary, providerId: string) =>
  canonicalIntegrationId(credential.provider?.id) === canonicalIntegrationId(providerId)

export function AgentSetupRequestDialog({
  organisationId,
  request,
  autoOpen,
  canCreateCredentials,
  onDone,
}: {
  organisationId: string
  request: AgentIntegrationRequest
  autoOpen?: boolean
  canCreateCredentials: boolean
  onDone?: () => void
}) {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const opened = useRef(false)
  const reviewedRevision = useRef(request.revision)
  const reviewing = useRef(false)
  const providerId = request.credentialProvider || request.serviceType || ''
  const defaultCredentialId =
    (request.progress?.credentialId as string | undefined) ||
    request.credential?.id ||
    request.connection?.authentication?.id ||
    ''
  const [credentialId, setCredentialId] = useState(defaultCredentialId)
  const [createdCredential, setCreatedCredential] = useState<IntegrationCredentialSummary>()
  const [resolutionNote, setResolutionNote] = useState('')
  const [failure, setFailure] = useState('')
  const [requestChanged, setRequestChanged] = useState(false)
  const [fulfill, { loading }] = useMutation(FulfillAgentRequestOp)
  const {
    data: credentialsData,
    loading: credentialsLoading,
    error: credentialsError,
    refetch: refetchCredentials,
  } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisationId },
    fetchPolicy: 'cache-and-network',
  })
  const { data: providersData } = useQuery(GetProviderList, {
    skip: !canCreateCredentials,
  })
  const credentials = useMemo(() => {
    const queried = (credentialsData?.savedCredentials || []).filter(
      Boolean
    ) as IntegrationCredentialSummary[]
    const compatible = [
      createdCredential,
      request.credential,
      request.connection?.authentication,
      ...queried,
    ]
      .filter(
        (credential): credential is IntegrationCredentialSummary =>
          !!credential && credentialMatches(credential, providerId)
      )
      .filter(
        (credential, index, all) =>
          all.findIndex((candidate) => candidate.id === credential.id) === index
      )
    return compatible.sort(
      (left, right) =>
        Number(right.provider?.id === providerId) - Number(left.provider?.id === providerId)
    )
  }, [createdCredential, credentialsData, providerId, request.connection, request.credential])
  const selectedCredential = credentials.find((credential) => credential.id === credentialId)
  const providerOptions = (providersData?.providers || []) as ProviderType[]
  const initialProvider =
    providerOptions.find((provider) => provider.id === providerId) ??
    providerOptions.find(
      (provider) => canonicalIntegrationId(provider.id) === canonicalIntegrationId(providerId)
    )
  const isUpdate = normalizeAgentEnum(request.kind) === 'CREDENTIAL_UPDATE'

  useEffect(() => {
    if (autoOpen && !opened.current) {
      opened.current = true
      dialogRef.current?.openModal()
    }
  }, [autoOpen])

  useEffect(() => {
    if (reviewing.current && reviewedRevision.current !== request.revision) setRequestChanged(true)
  }, [request.revision])

  useEffect(() => {
    if (selectedCredential || credentials.length === 0) return
    const preferred = credentials.find((credential) => credential.id === defaultCredentialId)
    setCredentialId((preferred || credentials[0]).id)
  }, [credentials, defaultCredentialId, selectedCredential])

  const resetFields = () => {
    setCredentialId(defaultCredentialId)
    setCreatedCredential(undefined)
    setResolutionNote('')
    setFailure('')
  }

  const beginReview = () => {
    reviewing.current = true
    reviewedRevision.current = request.revision
    setRequestChanged(false)
    resetFields()
    void refetchCredentials()
  }

  const endReview = () => {
    reviewing.current = false
    setRequestChanged(false)
    resetFields()
  }

  const handleCreated = (credential: CreatedProviderCredential) => {
    const created: IntegrationCredentialSummary = {
      id: credential.id,
      name: credential.name,
      revision: credential.revision,
      provider: {
        id: credential.providerId,
        name:
          (providersData?.providers || []).find(
            (provider: ProviderType) => provider.id === credential.providerId
          )?.name || credential.providerId,
      },
    }
    setCreatedCredential(created)
    setCredentialId(created.id)
    void refetchCredentials()
  }

  const finish = async () => {
    setFailure('')
    try {
      if (requestChanged || reviewedRevision.current !== request.revision)
        throw new Error('This request changed while you were reviewing it. Close and reopen it.')
      if (!selectedCredential?.revision)
        throw new Error('Choose compatible credentials with a current revision.')
      await fulfill({
        variables: {
          requestId: request.id,
          expectedRevision: reviewedRevision.current,
          credentialId: selectedCredential.id,
          expectedCredentialRevision: selectedCredential.revision,
          resolutionNote: resolutionNote.trim() || null,
        },
        refetchQueries: [
          'GetAgentRequests',
          'GetAgentRequestMesh',
          'GetPendingAgentRequestIds',
          'GetAgentAssets',
          'GetAgentDetail',
          'GetAgentMesh',
          'GetSavedCredentials',
        ],
        awaitRefetchQueries: true,
      })
      toast.success(isUpdate ? 'Connection credentials updated' : 'Connection setup complete')
      onDone?.()
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not fulfill request')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={isUpdate ? 'Update Connection credentials' : 'Set up Connection'}
      size="md"
      buttonContent={
        <>
          {isUpdate ? <FaSyncAlt /> : <FaKey />}
          {isUpdate ? 'Update credentials' : 'Set up Connection'}
        </>
      }
      onOpen={beginReview}
      onClose={endReview}
    >
      <div className="space-y-4 pt-4">
        <div className="rounded-lg border border-neutral-500/20 bg-neutral-500/[0.035] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {request.connection?.name || `${humanizeAgentValue(request.serviceType)} Connection`}
            </p>
            <AgentBadge tone="blue">{humanizeAgentValue(providerId)}</AgentBadge>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Requested for {request.workflow?.name || request.agent.name}. The selected integration
            credential stays inside the Phase proxy.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor={`request-${request.id}-credential`}
            className="block text-xs text-neutral-500"
          >
            Third-party credentials
          </label>
          <AgentSelect
            id={`request-${request.id}-credential`}
            value={credentialId}
            onChange={(value) => {
              setCredentialId(value)
            }}
            options={[
              {
                value: '',
                label: credentialsLoading ? 'Loading credentials' : 'Select credentials',
              },
              ...credentials.map((credential) => ({
                value: credential.id,
                label: `${credential.name} (${credential.provider?.name || providerId})${
                  credential.provider?.id === providerId ? ' · Recommended' : ''
                }`,
              })),
            ]}
            required
          />
          {credentialsError && (
            <p role="alert" className="text-xs text-red-500">
              {credentialsError.message}
            </p>
          )}
          {!credentialsLoading && credentials.length === 0 && !credentialsError && (
            <p className="text-xs text-neutral-500">
              No compatible credentials are connected yet. Add the integration proposed by the
              Agent, then complete this request.
            </p>
          )}
          {canCreateCredentials && initialProvider && (
            <div className="flex justify-start">
              <CreateProviderCredentialsDialog
                key={`${request.id}-${initialProvider.id}`}
                buttonVariant="secondary"
                initialProvider={initialProvider}
                initialName={
                  request.credentialName || `${humanizeAgentValue(providerId)} for Agents`
                }
                triggerLabel="Add integration"
                onCreated={handleCreated}
              />
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor={`request-${request.id}-note`}
            className="mb-2 block text-xs text-neutral-500"
          >
            Note to the Agent (optional)
          </label>
          <textarea
            id={`request-${request.id}-note`}
            rows={3}
            maxLength={20000}
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
            className="custom w-full rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus:ring-emerald-500 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        {selectedCredential && (
          <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-neutral-600 dark:text-neutral-400">
            Phase will bind <strong>{selectedCredential.name}</strong> to this Connection. Secret
            values are served dynamically and are never copied into Agent configuration.
          </p>
        )}
        {failure && (
          <p role="alert" className="text-sm text-red-500">
            {failure}
          </p>
        )}
        {requestChanged && (
          <p
            role="alert"
            className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300"
          >
            This request changed while you were reviewing it. Close and reopen it to review the
            latest proposal.
          </p>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={finish}
            isLoading={loading}
            disabled={
              !selectedCredential?.revision ||
              !isAgentRequestPending(request.status) ||
              !!credentialsError ||
              requestChanged
            }
          >
            {isUpdate ? 'Update credentials' : 'Complete setup'}
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
