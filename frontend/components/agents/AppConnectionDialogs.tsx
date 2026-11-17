'use client'

import { FormEvent, ReactNode, useContext, useId, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaEdit, FaPlus } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { EnvironmentChecklist, environmentsProblem } from '@/components/agents/EnvironmentChecklist'
import { PhaseAppMark } from '@/components/agents/AgentBrandIcons'
import { organisationContext } from '@/contexts/organisationContext'
import { GetApps } from '@/graphql/queries/getApps.gql'
import {
  CreateAgentAppConnectionOp,
  UpdateAgentAppConnectionOp,
} from '@/graphql/mutations/agents/manageAgentAssets.gql'
import { HTTP_LIMITS } from '@/utils/agents/httpDefinition'
import {
  SSE_REQUIRED_LINE,
  defaultAppConnectionName,
  type AppRef,
  type EnvironmentRef,
} from '@/utils/agents/appAccess'

const REFETCH = ['GetAgentAssets', 'GetAgentDetail', 'GetAgentMesh']

type AppChoice = AppRef & { environments: EnvironmentRef[] }

const readApps = (value: unknown): AppChoice[] =>
  Array.isArray(value)
    ? value.flatMap((app): AppChoice[] =>
        app && typeof app.id === 'string'
          ? [
              {
                id: app.id,
                name: app.name,
                sseEnabled: app.sseEnabled === true,
                environments: (app.environments || []).filter(Boolean),
              },
            ]
          : []
      )
    : []

/** The app Connection form inside "Create Connection", once App secrets is chosen. */
export function CreateAppConnectionForm({
  organisationId,
  serviceSelect,
  onCreated,
}: {
  organisationId: string
  serviceSelect: ReactNode
  onCreated: () => void
}) {
  const id = useId()
  const [appId, setAppId] = useState('')
  const [environmentIds, setEnvironmentIds] = useState<string[]>([])
  // The environment message waits until the person has chosen or tried to create.
  const [environmentsTouched, setEnvironmentsTouched] = useState(false)
  const [name, setName] = useState('')
  // The name follows the app until the member types their own.
  const [nameTouched, setNameTouched] = useState(false)
  const [failure, setFailure] = useState('')
  const { data, loading: appsLoading } = useQuery(GetApps, {
    variables: { organisationId },
    skip: !organisationId,
    fetchPolicy: 'cache-and-network',
  })
  const [create, { loading }] = useMutation(CreateAgentAppConnectionOp)
  const apps = readApps(data?.apps)
  const app = apps.find((candidate) => candidate.id === appId)
  const anyEncrypted = apps.some((candidate) => candidate.sseEnabled)
  const problem = !app
    ? 'Choose an app.'
    : environmentsProblem(environmentIds) || (!name.trim() ? 'Enter a name.' : '')

  const chooseApp = (next: string) => {
    const chosen = apps.find((candidate) => candidate.id === next)
    setAppId(next)
    // None to start with: the member chooses what the Agent can reach.
    setEnvironmentIds([])
    setEnvironmentsTouched(false)
    if (chosen && !nameTouched) setName(defaultAppConnectionName(chosen.name))
    setFailure('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    setEnvironmentsTouched(true)
    if (problem || !app) return
    try {
      await create({
        variables: { organisationId, name: name.trim(), appId: app.id, environmentIds },
        refetchQueries: REFETCH,
        awaitRefetchQueries: true,
      })
      toast.success('Connection created')
      onCreated()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not create the Connection')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {serviceSelect}
      <div className="space-y-2">
        <label htmlFor={`${id}-app`} className="block text-xs text-neutral-500">
          App
        </label>
        <AgentSelect
          id={`${id}-app`}
          value={appId}
          onChange={chooseApp}
          placeholder={appsLoading && !data ? 'Loading apps' : 'Select an app'}
          options={apps.map((candidate) => ({
            value: candidate.id,
            label: candidate.sseEnabled ? (
              candidate.name
            ) : (
              <span title={SSE_REQUIRED_LINE}>{candidate.name} · No server-side encryption</span>
            ),
            disabled: !candidate.sseEnabled,
          }))}
          required
        />
        {apps.some((candidate) => !candidate.sseEnabled) && (
          <p className="text-xs text-neutral-500">{SSE_REQUIRED_LINE}</p>
        )}
        {!appsLoading && apps.length > 0 && !anyEncrypted && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            None of your apps has server-side encryption yet.
          </p>
        )}
        {!appsLoading && data && apps.length === 0 && (
          <p className="text-xs text-neutral-500">You do not have access to any apps.</p>
        )}
      </div>
      {app && (
        <EnvironmentChecklist
          id={`${id}-environments`}
          label="Environments"
          environments={app.environments}
          selected={environmentIds}
          onChange={(next) => {
            setEnvironmentIds(next)
            setEnvironmentsTouched(true)
          }}
        />
      )}
      <Input
        id={`${id}-name`}
        label="Connection name"
        value={name}
        setValue={(next) => {
          setName(next)
          setNameTouched(true)
        }}
        maxLength={HTTP_LIMITS.connectionName}
        required
      />
      <p className="text-xs text-neutral-500">
        Workflows granted this Connection can read these environments&apos; secrets. Writes ask for
        a Change Request until you change the access rules.
      </p>
      {app && environmentsTouched && environmentsProblem(environmentIds) && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {environmentsProblem(environmentIds)}
        </p>
      )}
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
          icon={FaPlus}
          isLoading={loading}
          disabled={!!problem}
          title={problem || undefined}
        >
          Create Connection
        </Button>
      </div>
    </form>
  )
}

export type AppConnection = {
  id: string
  name: string
  app?: AppRef | null
  environments?: EnvironmentRef[] | null
}

/** "Edit" on an app Connection: its name and the environments it covers. */
export function EditAppConnectionDialog({ connection }: { connection: AppConnection }) {
  const id = useId()
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const current = () => (connection.environments ?? []).map((environment) => environment.id)
  const [name, setName] = useState(connection.name)
  const [environmentIds, setEnvironmentIds] = useState<string[]>(current)
  const [failure, setFailure] = useState('')
  // The Apps are read once the dialog has been opened, not for every row on the page.
  const [opened, setOpened] = useState(false)
  const [save, { loading }] = useMutation(UpdateAgentAppConnectionOp)
  // Every environment of the app, not only the ones covered now.
  const { data } = useQuery(GetApps, {
    variables: { organisationId: organisation?.id, appId: connection.app?.id },
    skip: !opened || !organisation?.id || !connection.app?.id,
  })
  const appEnvironments: EnvironmentRef[] =
    readApps(data?.apps).find((app) => app.id === connection.app?.id)?.environments ??
    connection.environments ??
    []
  const sameEnvironments =
    environmentIds.length === current().length &&
    environmentIds.every((environmentId) => current().includes(environmentId))
  const changed = name.trim() !== connection.name || !sameEnvironments
  const problem = !name.trim() ? 'Enter a name.' : environmentsProblem(environmentIds)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (problem || !changed) return
    try {
      await save({
        variables: {
          connectionId: connection.id,
          ...(name.trim() !== connection.name ? { name: name.trim() } : {}),
          ...(!sameEnvironments ? { environmentIds } : {}),
        },
        refetchQueries: REFETCH,
        awaitRefetchQueries: true,
      })
      toast.success('Connection updated')
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not save the Connection')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Edit ${connection.name}`}
      dialogTitle={
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-neutral-500/10">
            <PhaseAppMark aria-hidden="true" className="text-zinc-900 dark:text-zinc-100" />
          </span>
          <h3 className="truncate text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
            Edit App secrets Connection
          </h3>
        </div>
      }
      size="md"
      buttonVariant="ghost"
      buttonContent="Edit"
      buttonProps={{ icon: FaEdit }}
      onOpen={() => {
        setOpened(true)
        setName(connection.name)
        setEnvironmentIds(current())
        setFailure('')
      }}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <Input
          id={`${id}-name`}
          label="Connection name"
          value={name}
          setValue={setName}
          maxLength={HTTP_LIMITS.connectionName}
          required
        />
        <p className="truncate text-xs text-neutral-500">
          App{' '}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {connection.app?.name}
          </span>
        </p>
        <EnvironmentChecklist
          id={`${id}-environments`}
          label="Environments"
          environments={appEnvironments}
          selected={environmentIds}
          onChange={setEnvironmentIds}
        />
        <p className="text-xs text-neutral-500">
          Workflows granted this Connection reach only these environments, from their next call.
        </p>
        {environmentsProblem(environmentIds) && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {environmentsProblem(environmentIds)}
          </p>
        )}
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
            icon={FaCheck}
            isLoading={loading}
            disabled={!changed || !!problem}
            title={problem || (changed ? undefined : 'Nothing has changed.')}
          >
            Save Connection
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
