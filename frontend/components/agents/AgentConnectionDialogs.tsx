'use client'

import { FormEvent, useContext, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaEdit, FaExternalLinkAlt, FaGlobe, FaPlus } from 'react-icons/fa'
import Link from 'next/link'
import { toast } from 'react-toastify'
import type { ProviderType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { PhaseAppMark, agentServiceMeta } from '@/components/agents/AgentBrandIcons'
import { CreateAppConnectionForm } from '@/components/agents/AppConnectionDialogs'
import type { AgentHostRulesMode } from '@/components/agents/AgentConnectionHostRules'
import { AgentPresetPicker } from '@/components/agents/AgentPresetPicker'
import { CreateCustomConnectionForm } from '@/components/agents/CustomConnectionDialogs'
import type { ConnectionPreset } from '@/utils/agents/connectionPresets'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'
import type { CreatedProviderCredential } from '@/components/syncing/CreateProviderCredentials'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { organisationContext } from '@/contexts/organisationContext'
import {
  CreateAgentConnectionOp,
  UpdateAgentConnectionOp,
} from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { userHasPermission } from '@/utils/access/permissions'
import {
  canonicalIntegrationId,
  integrationCredentialHref,
  type IntegrationCredentialSummary,
} from '@/utils/integrationCredentials'
import { generateConnectionName } from '@/utils/agents/names'
import { HTTP_SERVICE_TYPE, isCustomConnection } from '@/utils/agents/httpDefinition'
import { APP_SERVICE_TYPE, isAppConnection } from '@/utils/agents/appAccess'

type AgentService = {
  serviceType: string
  displayName: string
  provider?: string | null
  hostRulesMode?: AgentHostRulesMode | null
}

type ConnectionProps = {
  organisationId?: string
  services?: AgentService[]
  connection?: {
    id: string
    name: string
    serviceType: string
    config?: Record<string, unknown> | null
    authentication?: IntegrationCredentialSummary | null
  }
  onDone?: () => void | Promise<unknown>
}

const ADD_INTEGRATION_VALUE = '__add_integration__'

const matchesProvider = (credential: IntegrationCredentialSummary, providerId: string) =>
  canonicalIntegrationId(credential.provider?.id) === canonicalIntegrationId(providerId)

function ConnectionDialog({
  organisationId: suppliedOrganisationId,
  services = [],
  connection,
  onDone,
}: ConnectionProps) {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const organisationId = suppliedOrganisationId || organisation?.id || ''
  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const id = useId()
  const [name, setName] = useState(() => (connection ? connection.name : generateConnectionName()))
  const [serviceType, setServiceType] = useState(connection?.serviceType || '')
  const [authenticationId, setAuthenticationId] = useState(connection?.authentication?.id || '')
  const [createdCredential, setCreatedCredential] = useState<IntegrationCredentialSummary>()
  const [creatingCredential, setCreatingCredential] = useState(false)
  const [failure, setFailure] = useState('')
  // Once "Custom HTTP" is picked: undefined until a provider or a blank form is chosen.
  const [presetChoice, setPresetChoice] = useState<
    { preset: ConnectionPreset | null } | undefined
  >()
  const [save, { loading }] = useMutation(
    connection ? UpdateAgentConnectionOp : CreateAgentConnectionOp
  )
  const permissions = organisation?.role?.permissions
  const canReadCredentials =
    !!permissions && userHasPermission(permissions, 'IntegrationCredentials', 'read')
  const canCreateCredentials =
    !!permissions && userHasPermission(permissions, 'IntegrationCredentials', 'create')
  const { data: credentialsData, refetch: refetchCredentials } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisationId },
    skip: !organisationId || !canReadCredentials,
    fetchPolicy: 'cache-and-network',
  })
  const { data: providersData } = useQuery(GetProviderList, {
    skip: !canCreateCredentials,
  })
  const selectedService = services.find(
    (service) => service.serviceType.toLowerCase() === serviceType.toLowerCase()
  )
  // Hosts of GitHub and GitLab come from the credential; the other new
  // services have fixed hosts. Neither takes a `config`.
  const hostMode = selectedService?.hostRulesMode
  const sendsNoConfig = hostMode === 'credential_endpoint' || hostMode === 'fixed'
  const serviceMeta = agentServiceMeta(serviceType)
  const ServiceIcon = serviceMeta.Icon
  const serviceDisplayName = selectedService?.displayName || serviceMeta.label
  const providerId = selectedService?.provider || serviceType
  const credentials = useMemo(() => {
    const queried = (
      (credentialsData?.savedCredentials || []).filter(Boolean) as IntegrationCredentialSummary[]
    ).filter((credential) => matchesProvider(credential, providerId))
    const current = connection?.authentication
    const compatible = [createdCredential, current, ...queried]
      .filter(
        (credential): credential is IntegrationCredentialSummary =>
          !!credential && matchesProvider(credential, providerId)
      )
      .filter(
        (credential, index, all) =>
          all.findIndex((candidate) => candidate.id === credential.id) === index
      )
    return compatible.sort(
      (left, right) =>
        Number(right.provider?.id === providerId) - Number(left.provider?.id === providerId)
    )
  }, [connection?.authentication, createdCredential, credentialsData, providerId])
  const providerOptions = (providersData?.providers || []) as ProviderType[]
  const provider =
    providerOptions.find((candidate) => candidate.id === providerId) ??
    providerOptions.find(
      (candidate) => canonicalIntegrationId(candidate.id) === canonicalIntegrationId(providerId)
    )
  const selectedCredential = credentials.find((credential) => credential.id === authenticationId)

  const clearTransientState = () => {
    setPresetChoice(undefined)
    setCreatingCredential(false)
    setFailure('')
  }

  const reset = () => {
    setName(connection ? connection.name : generateConnectionName())
    setServiceType(connection?.serviceType || '')
    setAuthenticationId(connection?.authentication?.id || '')
    setCreatedCredential(undefined)
    setPresetChoice(undefined)
    clearTransientState()
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
            (candidate: ProviderType) => candidate.id === credential.providerId
          )?.name || credential.providerId,
      },
    }
    setCreatedCredential(created)
    setAuthenticationId(created.id)
    void refetchCredentials()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    try {
      if (!name.trim() || !serviceType || (!connection && !selectedCredential))
        throw new Error('Choose a Connection name, service, and compatible credentials.')
      if (connection && canReadCredentials && !selectedCredential)
        throw new Error('Choose compatible credentials or keep the current selection.')

      const authenticationChanged =
        !!connection &&
        !!selectedCredential &&
        selectedCredential.id !== connection.authentication?.id
      await save({
        variables: connection
          ? {
              connectionId: connection.id,
              name: name.trim(),
              ...(authenticationChanged ? { authenticationId: selectedCredential.id } : {}),
            }
          : {
              organisationId,
              name: name.trim(),
              serviceType,
              authenticationId: selectedCredential!.id,
              ...(sendsNoConfig ? {} : { config: {} }),
            },
        refetchQueries: ['GetAgentAssets', 'GetAgentDetail', 'GetAgentMesh'],
        awaitRefetchQueries: true,
      })
      toast.success(connection ? 'Connection updated' : 'Connection created')
      if (!connection) reset()
      onDone?.()
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not save Connection')
    }
  }

  // A service Phase has no packaged integration for: the member defines it.
  const custom = !connection && isCustomConnection(serviceType)
  // An app's own secrets: no credential and no host, only the app and its environments.
  const appSecrets = !connection && isAppConnection(serviceType)
  const serviceSelect = connection ? null : (
    <div>
      <label htmlFor={`${id}-service`} className="mb-2 block text-xs text-neutral-500">
        Service
      </label>
      <AgentSelect
        id={`${id}-service`}
        value={serviceType}
        onChange={(next) => {
          setServiceType(next)
          setPresetChoice(undefined)
          setAuthenticationId('')
          setCreatedCredential(undefined)
          setFailure('')
        }}
        options={[
          { value: '', label: 'Select a service' },
          ...services.map((service) => {
            const meta = agentServiceMeta(service.serviceType)
            const Icon = meta.Icon
            return {
              value: service.serviceType,
              label: service.displayName,
              icon: <Icon aria-hidden="true" className={meta.iconClass} />,
            }
          }),
          {
            value: HTTP_SERVICE_TYPE,
            label: 'Custom HTTP',
            icon: <FaGlobe aria-hidden="true" className="text-neutral-500" />,
            separatorBefore: services.length > 0,
          },
          {
            value: APP_SERVICE_TYPE,
            label: 'App secrets',
            icon: <PhaseAppMark aria-hidden="true" className="text-zinc-900 dark:text-zinc-100" />,
          },
        ]}
        required
      />
    </div>
  )

  return (
    <GenericDialog
      ref={dialogRef}
      title={connection ? `Edit ${serviceDisplayName} Connection` : 'Create Connection'}
      dialogTitle={
        connection ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-neutral-500/10">
              <ServiceIcon aria-hidden="true" className={serviceMeta.iconClass} />
            </span>
            <h3 className="truncate text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
              Edit {serviceDisplayName} Connection
            </h3>
          </div>
        ) : undefined
      }
      size="md"
      buttonVariant={connection ? 'ghost' : 'primary'}
      buttonContent={connection ? 'Edit' : 'Create Connection'}
      buttonProps={{ icon: connection ? FaEdit : FaPlus }}
      onOpen={connection ? reset : clearTransientState}
      onClose={connection ? reset : clearTransientState}
      canClose={() => !creatingCredential}
    >
      {custom && !presetChoice && (
        <div className="space-y-4 pt-4">
          {serviceSelect}
          <AgentPresetPicker
            organisationId={organisationId}
            onChoose={(preset) => setPresetChoice({ preset })}
          />
        </div>
      )}
      {custom && presetChoice && (
        <div className="pt-4">
          <CreateCustomConnectionForm
            key={presetChoice.preset?.id ?? 'scratch'}
            organisationId={organisationId}
            initialName={name}
            preset={presetChoice.preset}
            onChangePreset={() => setPresetChoice(undefined)}
            onNameChange={setName}
            serviceSelect={serviceSelect}
            onCreated={() => {
              reset()
              onDone?.()
              dialogRef.current?.closeModal()
            }}
          />
        </div>
      )}
      {appSecrets && (
        <div className="pt-4">
          <CreateAppConnectionForm
            organisationId={organisationId}
            serviceSelect={serviceSelect}
            onCreated={() => {
              reset()
              onDone?.()
              dialogRef.current?.closeModal()
            }}
          />
        </div>
      )}
      {!custom && !appSecrets && (
        <form onSubmit={submit} className="space-y-4 pt-4">
          <Input
            id={`${id}-name`}
            label="Connection name"
            value={name}
            setValue={setName}
            required
          />
          {serviceSelect}
          {serviceType && canReadCredentials && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`${id}-credentials`} className="block text-xs text-neutral-500">
                  Third-party credentials
                </label>
                {connection && selectedCredential && organisation?.name && (
                  <Link
                    href={integrationCredentialHref(organisation.name, selectedCredential)}
                    className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
                  >
                    View credential
                    <FaExternalLinkAlt aria-hidden="true" className="text-2xs" />
                  </Link>
                )}
              </div>
              <AgentSelect
                id={`${id}-credentials`}
                value={authenticationId}
                onChange={(next) => {
                  if (next === ADD_INTEGRATION_VALUE) {
                    setCreatingCredential(true)
                    return
                  }
                  setAuthenticationId(next)
                }}
                options={[
                  { value: '', label: 'Select credentials' },
                  ...credentials.map((credential) => ({
                    value: credential.id,
                    label: `${credential.name} (${credential.provider?.name || 'Integration'})`,
                    icon: <ProviderIcon providerId={credential.provider?.id || providerId} />,
                  })),
                  ...(canCreateCredentials && provider
                    ? [
                        {
                          value: ADD_INTEGRATION_VALUE,
                          label: 'Add integration',
                          icon: <FaPlus aria-hidden="true" />,
                          separatorBefore: true,
                        },
                      ]
                    : []),
                ]}
                required
              />
              {credentials.length === 0 && (
                <p className="text-xs text-neutral-500">
                  No compatible credentials are connected for this service.
                </p>
              )}
            </div>
          )}
          {serviceType && !canReadCredentials && (
            <Alert variant="info" icon size="sm">
              <span className="text-xs">
                {connection
                  ? 'Credential details are hidden. You can rename this Connection, but Integration Credentials read permission is required to switch its credential.'
                  : 'Integration Credentials read permission is required to create a Connection.'}
              </span>
            </Alert>
          )}
          {hostMode === 'credential_endpoint' && (
            <p className="text-xs text-neutral-500">
              The host comes from the chosen credential, so there is nothing to configure here.
            </p>
          )}
          <p className="text-xs text-neutral-500">
            At runtime, the Phase proxy on the developer&apos;s machine receives this
            credential&apos;s secret values and adds them to the Agent&apos;s requests. The Agent
            itself is given placeholders in their place.
          </p>
          {failure && (
            <div role="alert">
              <Alert variant="danger" icon size="sm">
                <span className="text-xs">{failure}</span>
              </Alert>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              icon={connection ? FaCheck : FaPlus}
              isLoading={loading}
              disabled={
                !name.trim() ||
                !serviceType ||
                (!connection && !selectedCredential) ||
                (!!connection && canReadCredentials && !selectedCredential)
              }
            >
              {connection ? 'Save Connection' : 'Create Connection'}
            </Button>
          </div>
        </form>
      )}
      {serviceType && !custom && !appSecrets && canCreateCredentials && provider && (
        <CreateProviderCredentialsDialog
          key={`${serviceType}-${provider.id}`}
          showButton={false}
          defaultOpen={creatingCredential}
          initialProvider={provider}
          exactProvider
          initialName={name.trim() || `${serviceDisplayName} for Agents`}
          closeDialogCallback={() => setCreatingCredential(false)}
          onCreated={handleCreated}
        />
      )}
    </GenericDialog>
  )
}

export function CreateConnectionDialog(props: ConnectionProps) {
  return <ConnectionDialog {...props} />
}

export function UpdateConnectionDialog(props: ConnectionProps) {
  return <ConnectionDialog {...props} />
}
