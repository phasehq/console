'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaArrowRight, FaCheck, FaKey, FaSyncAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import type { ProviderType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import clsx from 'clsx'
import { Button } from '@/components/common/Button'
import { AgentCredentialPicker } from '@/components/agents/AgentCredentialPicker'
import { Textarea } from '@/components/common/TextArea'
import { GrantDurationField } from '@/components/agents/AgentAccessControls'
import {
  grantDurationResult,
  initialGrantDuration,
  type GrantDuration,
} from '@/utils/agents/accessDuration'
import { AgentBadge, humanizeAgentValue } from '@/components/agents/AgentUI'
import { AgentHarnessTile, AgentServiceTile } from '@/components/agents/AgentBrandIcons'
import { isAgentRequestPending, normalizeAgentEnum } from '@/components/agents/AgentEnums'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import type { CreatedProviderCredential } from '@/components/syncing/CreateProviderCredentials'
import { FulfillAgentRequestOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetAgentSettings from '@/graphql/queries/agents/getAgentSettings.gql'
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
  /** How long the access this request ends in was asked to last. */
  durationSeconds?: number | null
  progress?: Record<string, unknown> | null
  credential?: IntegrationCredentialSummary | null
  connection?: {
    id: string
    name: string
    authentication?: IntegrationCredentialSummary | null
  } | null
  workflow?: { name: string } | null
  agent: { name: string; harnessType?: string | null }
}

const credentialMatches = (credential: IntegrationCredentialSummary, providerId: string) =>
  canonicalIntegrationId(credential.provider?.id) === canonicalIntegrationId(providerId)

export function AgentSetupRequestDialog({
  organisationId,
  request,
  autoOpen,
  onAutoOpened,
  canCreateCredentials,
  onDone,
}: {
  organisationId: string
  request: AgentIntegrationRequest
  autoOpen?: boolean
  /** Lets the page consume a deep link, so a remounted card does not reopen it. */
  onAutoOpened?: () => void
  canCreateCredentials: boolean
  onDone?: () => void
}) {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const opened = useRef(false)
  const reviewedRevision = useRef(request.revision)
  const reviewing = useRef(false)
  const providerId = request.credentialProvider || request.serviceType || ''
  const serviceLabel = humanizeAgentValue(request.serviceType || canonicalIntegrationId(providerId))
  const workflowName = request.workflow?.name
  // A setup request can arrive before its Connection exists.
  const connectionPhrase = request.connection?.name ? (
    <>
      the <strong>{request.connection.name}</strong> Connection
    </>
  ) : (
    <>
      a new <strong>{serviceLabel}</strong> Connection
    </>
  )
  const currentCredential = request.connection?.authentication?.name
  const defaultCredentialId =
    (request.progress?.credentialId as string | undefined) ||
    request.credential?.id ||
    request.connection?.authentication?.id ||
    ''
  const [credentialId, setCredentialId] = useState(defaultCredentialId)
  const [createdCredential, setCreatedCredential] = useState<IntegrationCredentialSummary>()
  const [addingIntegration, setAddingIntegration] = useState(false)
  const [resolutionNote, setResolutionNote] = useState('')
  // Only a setup request ends in access that lasts for a time; a credential update takes none.
  const isUpdate = normalizeAgentEnum(request.kind) === 'CREDENTIAL_UPDATE'
  const takesDuration = !isUpdate
  const namedDuration = typeof request.durationSeconds === 'number' && request.durationSeconds > 0
  // A request that names no duration starts at the organisation default.
  const { data: settingsData, loading: settingsLoading } = useQuery(GetAgentSettings, {
    variables: { organisationId },
    skip: !takesDuration || !organisationId,
  })
  const defaultSeconds: number | null =
    settingsData?.agentSettings?.defaultRequestDurationSeconds ?? null
  const [duration, setDuration] = useState<GrantDuration>(() =>
    initialGrantDuration(request.durationSeconds, true, defaultSeconds)
  )
  const [durationTouched, setDurationTouched] = useState(false)
  const durationResult = grantDurationResult(duration, request.durationSeconds, {
    allowUntilRevoked: true,
  })
  const durationProblem = !takesDuration
    ? ''
    : !namedDuration && !!organisationId && settingsLoading
      ? 'Reading the organisation default duration.'
      : durationResult.problem
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

  useEffect(() => {
    if (autoOpen && !opened.current) {
      opened.current = true
      dialogRef.current?.openModal()
      onAutoOpened?.()
    }
  }, [autoOpen, onAutoOpened])

  useEffect(() => {
    if (reviewing.current && reviewedRevision.current !== request.revision) setRequestChanged(true)
  }, [request.revision])

  // The organisation default can arrive after the dialog opened: until the reviewer picks
  // something, the control follows it.
  useEffect(() => {
    if (!durationTouched)
      setDuration(initialGrantDuration(request.durationSeconds, true, defaultSeconds))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSeconds])

  // Preselect only a credential the request names; otherwise the reviewer picks one.
  useEffect(() => {
    if (selectedCredential) return
    const preferred = credentials.find((credential) => credential.id === defaultCredentialId)
    setCredentialId(preferred?.id ?? '')
  }, [credentials, defaultCredentialId, selectedCredential])

  const resetFields = () => {
    setCredentialId(defaultCredentialId)
    setCreatedCredential(undefined)
    setResolutionNote('')
    setDuration(initialGrantDuration(request.durationSeconds, true, defaultSeconds))
    setDurationTouched(false)
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
      if (durationProblem) throw new Error(durationProblem)
      await fulfill({
        variables: {
          requestId: request.id,
          expectedRevision: reviewedRevision.current,
          credentialId: selectedCredential.id,
          expectedCredentialRevision: selectedCredential.revision,
          resolutionNote: resolutionNote.trim() || null,
          // Sent as shown, for a setup request; a credential update takes no duration.
          ...(takesDuration && durationResult.args ? durationResult.args : {}),
        },
        refetchQueries: [
          'GetAgentRequests',
          'GetAgentRequestMesh',
          'GetPendingAgentRequestCount',
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
      buttonVariant="success"
      buttonContent={isUpdate ? 'Update credentials' : 'Set up Connection'}
      buttonProps={{ icon: isUpdate ? FaSyncAlt : FaKey }}
      onOpen={beginReview}
      onClose={endReview}
    >
      <div className="space-y-4 pt-4">
        {/* Who asks for what, since this is where the reviewer picks the credential. */}
        <section
          aria-label="Request summary"
          className="rounded-lg border border-neutral-500/20 bg-neutral-500/[0.035]"
        >
          {/* Agent, arrow and credential spread with equal gaps; the arrow sits level with the tiles. */}
          <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-neutral-500">
                Requested by
              </p>
              <div className="flex items-center gap-3">
                <AgentHarnessTile harnessType={request.agent.harnessType || 'other'} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{request.agent.name}</p>
                  {workflowName && (
                    <p className="truncate text-xs text-neutral-500">{workflowName} Workflow</p>
                  )}
                </div>
              </div>
            </div>
            <FaArrowRight
              aria-hidden="true"
              className="hidden size-3.5 shrink-0 text-neutral-500 sm:mt-6 sm:block sm:self-center"
            />
            <div className="min-w-0">
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-neutral-500">
                Credential
              </p>
              <div className="flex items-center gap-3">
                <AgentServiceTile
                  serviceType={request.serviceType || canonicalIntegrationId(providerId)}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {request.credentialName ||
                      request.connection?.name ||
                      `${serviceLabel} credentials`}
                  </p>
                  <AgentBadge tone="blue">{humanizeAgentValue(providerId)}</AgentBadge>
                </div>
              </div>
            </div>
          </div>
          <p className="border-t border-neutral-500/20 px-3 py-2 text-xs text-neutral-500">
            {isUpdate ? (
              <>
                <strong>Update credentials</strong> replaces{' '}
                {currentCredential ? <strong>{currentCredential}</strong> : 'the credentials'} on{' '}
                {connectionPhrase}.
              </>
            ) : (
              <>
                <strong>Complete setup</strong> connects the credential you pick to{' '}
                {connectionPhrase}.
              </>
            )}{' '}
            It stays inside the Phase proxy, and its secret values are never copied into the
            Agent&apos;s configuration.
          </p>
        </section>

        <div className="space-y-2">
          <label
            htmlFor={`request-${request.id}-credential`}
            className="block text-xs text-neutral-500"
          >
            Third-party credentials
          </label>
          <AgentCredentialPicker
            id={`request-${request.id}-credential`}
            value={credentialId}
            onChange={setCredentialId}
            credentials={credentials}
            recommendedProviderId={providerId}
            loading={credentialsLoading}
            onAdd={
              canCreateCredentials && initialProvider ? () => setAddingIntegration(true) : undefined
            }
          />
          {credentialsError && (
            <div role="alert">
              <Alert variant="danger" icon size="sm">
                <span className="text-xs">{credentialsError.message}</span>
              </Alert>
            </div>
          )}
          {canCreateCredentials && initialProvider && (
            <CreateProviderCredentialsDialog
              key={`${request.id}-${initialProvider.id}`}
              showButton={false}
              defaultOpen={addingIntegration}
              closeDialogCallback={() => setAddingIntegration(false)}
              initialProvider={initialProvider}
              exactProvider
              initialName={request.credentialName || `${humanizeAgentValue(providerId)} for Agents`}
              onCreated={handleCreated}
            />
          )}
        </div>

        {takesDuration && (
          <GrantDurationField
            id={`request-${request.id}-duration`}
            value={duration}
            onChange={(next) => {
              setDuration(next)
              setDurationTouched(true)
            }}
            requestedSeconds={request.durationSeconds}
            allowUntilRevoked
            problem={durationProblem}
          />
        )}

        <Textarea
          id={`request-${request.id}-note`}
          label="Note to the Agent (optional)"
          rows={3}
          maxLength={20000}
          value={resolutionNote}
          setValue={setResolutionNote}
        />

        {failure && (
          <div role="alert">
            <Alert variant="danger" icon size="sm">
              <span className="text-xs">{failure}</span>
            </Alert>
          </div>
        )}
        {requestChanged && (
          <div role="alert">
            <Alert variant="warning" icon size="sm">
              <span className="text-xs">
                This request changed while you were reviewing it. Close and reopen it to review the
                latest request.
              </span>
            </Alert>
          </div>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            icon={isUpdate ? FaSyncAlt : FaCheck}
            onClick={finish}
            isLoading={loading}
            disabled={
              !selectedCredential?.revision ||
              !isAgentRequestPending(request.status) ||
              !!credentialsError ||
              !!durationProblem ||
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
