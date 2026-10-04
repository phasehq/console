'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { FaEdit, FaKey, FaPlus, FaTimes, FaUnlink } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Button, ButtonVariant } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import CopyButton from '@/components/common/CopyButton'
import { agentHarnessMeta } from '@/components/agents/AgentBrandIcons'
import { AgentHarnessPicker } from '@/components/agents/AgentHarnessPicker'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { generateAgentName } from '@/utils/agents/names'
import {
  CreateAgentOp,
  CreateAgentWorkflowOp,
  DeleteAgentOp,
  GrantAgentWorkflowOp,
  MintAgentTokenOp,
  UpdateAgentOp,
  UpdateAgentWorkflowOp,
} from '@/graphql/mutations/agents/manageAgents.gql'

type DialogHandle = { closeModal: () => void; openModal: () => void }
type NamedItem = { id: string; name: string }
const TOKEN_EXPIRY_PRESETS: Array<{ value: string; label: string; seconds?: number }> = [
  { value: 'none', label: 'No expiry' },
  { value: '24h', label: '24 hours', seconds: 86400 },
  { value: '7d', label: '7 days', seconds: 604800 },
  { value: '30d', label: '30 days', seconds: 2592000 },
  { value: 'custom', label: 'Custom' },
]

const selectClass =
  'custom w-full rounded-md bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100 ring-1 ring-inset ring-neutral-500/40 px-3 py-2 text-sm focus:ring-emerald-500'

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The operation could not be completed'

const CLI_HARNESS_FLAGS: Record<string, string> = {
  claude_code: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  devin: 'devin',
  opencode: 'opencode',
  copilot: 'copilot',
}

const aiEnableCommand = (harnessType?: string) => {
  const harness = harnessType ? CLI_HARNESS_FLAGS[harnessType.toLowerCase()] : undefined
  return harness ? `phase ai enable --harness ${harness}` : 'phase ai enable'
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-neutral-500 mb-2">{children}</label>
}

/**
 * One-time token reveal panel shared by the Agent creation and token minting
 * flows: a manual authentication sequence, safety notice, and copy actions.
 */
function AgentTokenReveal({
  token,
  harnessType,
  footer,
}: {
  token: string
  harnessType?: string
  footer?: React.ReactNode
}) {
  const enableCommand = aiEnableCommand(harnessType)
  const harness = harnessType ? agentHarnessMeta(harnessType) : null

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-neutral-500/20 bg-neutral-500/5 p-3">
        <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Initial setup</h4>
        <ol className="mt-3 space-y-3 text-xs text-neutral-600 dark:text-neutral-400">
          <li className="flex gap-2.5">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">1.</span>
            <span>Open a terminal on the machine where your Agent harness runs.</span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">2.</span>
            <div className="min-w-0 flex-1">
              <span>Run this command:</span>
              <div className="mt-2 flex min-w-0 items-center justify-between gap-3 rounded-lg bg-zinc-950 px-3 py-2 text-zinc-100">
                <code className="min-w-0 overflow-x-auto font-mono text-xs">
                  phase auth --mode token
                </code>
                <CopyButton
                  value="phase auth --mode token"
                  buttonVariant="secondary"
                  title="Copy authentication command"
                />
              </div>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">3.</span>
            <div className="min-w-0 flex-1">
              <span>
                Paste this token only into the Phase CLI prompt. Don&apos;t paste it into your AI
                chat.
              </span>
              <div className="mt-2 overflow-hidden rounded-xl border border-emerald-500/30 shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                  <span className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    <FaKey aria-hidden="true" /> Agent token
                  </span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-medium text-amber-700 dark:text-amber-400">
                    Don&apos;t share with AI
                  </span>
                </div>
                <div className="ph-no-capture flex items-start gap-3 bg-white px-3 py-3 dark:bg-zinc-900">
                  <code className="min-w-0 flex-1 select-all break-all font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
                    {token}
                  </code>
                  <CopyButton value={token} buttonVariant="primary" title="Copy Agent token" />
                </div>
              </div>
            </div>
          </li>
          <li className="flex gap-2.5">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">4.</span>
            <div className="min-w-0 flex-1">
              <span>
                {harness && harness.value !== 'other'
                  ? `Install the Phase skill for ${harness.label}:`
                  : 'Select your Agent harness and install the Phase skill:'}
              </span>
              <div className="mt-2 flex min-w-0 items-center justify-between gap-3 rounded-lg bg-zinc-950 px-3 py-2 text-zinc-100">
                <code className="min-w-0 overflow-x-auto font-mono text-xs">{enableCommand}</code>
                <CopyButton
                  value={enableCommand}
                  buttonVariant="secondary"
                  title="Copy AI enable command"
                />
              </div>
            </div>
          </li>
        </ol>
      </div>
      {footer}
    </div>
  )
}

export function CreateAgentDialog({
  organisationId,
  onCreated,
}: {
  organisationId: string
  onCreated?: (agentId: string) => void
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [name, setName] = useState(generateAgentName)
  const [harnessType, setHarnessType] = useState('')
  const [createdAgent, setCreatedAgent] = useState<{
    id: string
    name: string
    workflowName: string
    token?: string
  } | null>(null)
  const [createAgent, { loading }] = useMutation(CreateAgentOp)
  const [mintInitialToken, { loading: minting }] = useMutation(MintAgentTokenOp)
  const selectedHarness = harnessType ? agentHarnessMeta(harnessType) : null
  const SelectedHarnessIcon = selectedHarness?.Icon
  const dialogTitle = createdAgent
    ? `Agent identity for ${createdAgent.name}'s ${createdAgent.workflowName} workflow`
    : 'Create AI Agent'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const result = await createAgent({
        variables: {
          organisationId,
          name: name.trim(),
          defaultWorkflowName: 'Default',
          harnessType,
        },
        refetchQueries: ['GetAgents', 'GetAgentMesh'],
        awaitRefetchQueries: true,
      })
      const created = result.data?.createAgent
      if (!created?.agent.id || !created.defaultWorkflow.id) {
        throw new Error('The Agent was created without its default workflow')
      }
      let initialToken: string | undefined
      try {
        const tokenResult = await mintInitialToken({
          variables: {
            agentId: created.agent.id,
            workflowId: created.defaultWorkflow.id,
            name: 'Initial setup',
            expiresAt: null,
          },
          refetchQueries: ['GetAgentDetail'],
        })
        initialToken = tokenResult.data?.mintAgentToken?.minted.fullToken
      } catch (tokenError) {
        toast.error(
          `Agent created, but its setup token could not be generated: ${errorMessage(tokenError)}`
        )
      }
      setCreatedAgent({
        id: created.agent.id,
        name: created.agent.name,
        workflowName: created.defaultWorkflow.name,
        token: initialToken,
      })
      toast.success('AI Agent created')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={dialogTitle}
      dialogTitle={
        <div className="flex min-w-0 items-center gap-2.5">
          {SelectedHarnessIcon && selectedHarness && (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-neutral-500/20 bg-neutral-500/5">
              <SelectedHarnessIcon
                role="img"
                aria-label={`${selectedHarness.label} harness`}
                className={`size-[18px] ${selectedHarness.iconClass}`}
              />
            </span>
          )}
          <h3 className="break-words text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
            {dialogTitle}
          </h3>
        </div>
      }
      size="md"
      buttonContent={
        <>
          <FaPlus /> Create Agent
        </>
      }
      onClose={() => {
        // Keep an unfinished draft when the dialog is dismissed. Only prepare
        // a fresh form after the Agent creation flow has completed.
        if (createdAgent) {
          setCreatedAgent(null)
          setName(generateAgentName())
          setHarnessType('')
        }
      }}
    >
      {createdAgent ? (
        <div className="space-y-4 pt-4">
          {createdAgent.token ? (
            <AgentTokenReveal token={createdAgent.token} harnessType={harnessType} />
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              The Agent was created without a setup token. Open its detail page to generate one.
            </div>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => {
                const agentId = createdAgent.id
                dialogRef.current?.closeModal()
                onCreated?.(agentId)
              }}
            >
              Continue to Agent
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 pt-4">
          <Input
            id="agent-name"
            label="Name"
            value={name}
            setValue={setName}
            required
            maxLength={64}
          />
          <div>
            <FieldLabel>Harness *</FieldLabel>
            <AgentHarnessPicker value={harnessType} onChange={setHarnessType} />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              isLoading={loading || minting}
              disabled={!name.trim() || !harnessType}
            >
              Create
            </Button>
          </div>
        </form>
      )}
    </GenericDialog>
  )
}

export function EditAgentDialog({
  agent,
}: {
  agent: {
    id: string
    name: string
    harnessType: string
  }
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [name, setName] = useState(agent.name)
  const [harnessType, setHarnessType] = useState(agent.harnessType.toLowerCase())
  const [updateAgent, { loading }] = useMutation(UpdateAgentOp)

  useEffect(() => {
    setName(agent.name)
    setHarnessType(agent.harnessType.toLowerCase())
  }, [agent])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await updateAgent({
        variables: {
          agentId: agent.id,
          name: name.trim(),
          harnessType,
        },
        refetchQueries: ['GetAgentDetail', 'GetAgents'],
        awaitRefetchQueries: true,
      })
      toast.success('AI Agent updated')
      dialogRef.current?.closeModal()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Edit AI Agent"
      size="sm"
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaEdit /> Edit
        </>
      }
      onClose={() => {
        setName(agent.name)
        setHarnessType(agent.harnessType.toLowerCase())
      }}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <Input
          id={`agent-name-${agent.id}`}
          label="Name"
          value={name}
          setValue={setName}
          required
          maxLength={64}
        />
        <div>
          <FieldLabel>Harness *</FieldLabel>
          <AgentHarnessPicker value={harnessType} onChange={setHarnessType} />
        </div>
        <div className="flex justify-end pt-2">
          <Button type="submit" isLoading={loading} disabled={!name.trim()}>
            Save changes
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

export function DeleteAgentDialog({
  agentId,
  agentName,
  onDeleted,
}: {
  agentId: string
  agentName: string
  onDeleted: () => void
}) {
  const [deleteAgent] = useMutation(DeleteAgentOp)

  return (
    <ConfirmAgentAction
      title="Delete Agent"
      description={`Delete ${agentName}? Its tokens and active sessions will stop working, and pending or approved runtime access will be revoked. This cannot be undone.`}
      actionLabel="Delete"
      onConfirm={async () => {
        const result = await deleteAgent({
          variables: { agentId },
          refetchQueries: ['GetAgents', 'GetAgentMesh'],
          awaitRefetchQueries: true,
        })
        if (!result.data?.deleteAgent?.ok) throw new Error('The Agent could not be deleted')
        toast.success('Agent deleted')
        onDeleted()
      }}
    />
  )
}

export function MintAgentTokenDialog({
  agentId,
  workflows,
  harnessType,
  triggerContent,
  triggerVariant,
}: {
  agentId: string
  workflows: NamedItem[]
  harnessType?: string
  /** Custom trigger for embedding surfaces, e.g. the compact icon button on Overview mesh cards. */
  triggerContent?: React.ReactNode
  triggerVariant?: ButtonVariant
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [name, setName] = useState(generateAgentName)
  const [workflowId, setWorkflowId] = useState(workflows[0]?.id || '')
  const [expiryPreset, setExpiryPreset] = useState('none')
  const [customExpiry, setCustomExpiry] = useState('')
  const [revealedToken, setRevealedToken] = useState('')
  const [mint, { loading }] = useMutation(MintAgentTokenOp)

  useEffect(() => {
    if (!workflowId && workflows[0]) setWorkflowId(workflows[0].id)
  }, [workflowId, workflows])

  const close = () => {
    setRevealedToken('')
    // Preserve an unsubmitted draft across dismissal. Once a token has been
    // generated, prepare a fresh form for the next token instead of reusing
    // the completed token's metadata.
    if (revealedToken) {
      setName(generateAgentName())
      setExpiryPreset('none')
      setCustomExpiry('')
    }
  }

  const tokenExpiry = () => {
    const preset = TOKEN_EXPIRY_PRESETS.find((option) => option.value === expiryPreset)
    if (preset?.seconds) return new Date(Date.now() + preset.seconds * 1000).toISOString()
    // Custom is date-only; the token stays valid through the selected day.
    if (expiryPreset === 'custom' && customExpiry)
      return new Date(`${customExpiry}T23:59:59`).toISOString()
    return null
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const result = await mint({
        variables: {
          agentId,
          workflowId,
          name: name.trim(),
          expiresAt: tokenExpiry(),
        },
        refetchQueries: ['GetAgentDetail'],
      })
      const token = result.data?.mintAgentToken?.minted.fullToken
      if (!token) throw new Error('The token was not returned')
      setRevealedToken(token)
      toast.success('Agent token generated')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Generate agent token"
      dialogTitle={
        <div className="min-w-0 pr-2">
          <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
            Generate agent token
          </h3>
          <p className="mt-1 max-w-md text-2xs leading-4 text-neutral-500">
            Agent tokens only authorize the Phase AI runtime for the selected workflow. They can
            never read your application secrets.
          </p>
        </div>
      }
      size="sm"
      onClose={close}
      buttonVariant={triggerVariant || 'secondary'}
      buttonContent={
        triggerContent ?? (
          <>
            <FaKey /> Generate token
          </>
        )
      }
    >
      {revealedToken ? (
        <div className="space-y-4 pt-4">
          <AgentTokenReveal
            token={revealedToken}
            harnessType={harnessType}
            footer={
              <p className="text-xs text-neutral-500">
                This token can use only the Phase AI runtime endpoints for its assigned workflow. It
                cannot read application secrets through standard Phase APIs.
              </p>
            }
          />
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 pt-4">
          <Input
            id="token-name"
            label="Token name"
            value={name}
            setValue={setName}
            required
            maxLength={64}
          />
          <div>
            <FieldLabel>Workflow *</FieldLabel>
            <AgentSelect
              id="agent-token-workflow"
              value={workflowId}
              onChange={setWorkflowId}
              options={workflows.map((workflow) => ({
                value: workflow.id,
                label: workflow.name,
              }))}
              required
            />
          </div>
          <div>
            <FieldLabel>Expires</FieldLabel>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Token expiry">
              {TOKEN_EXPIRY_PRESETS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={expiryPreset === option.value}
                  onClick={() => setExpiryPreset(option.value)}
                  className={
                    expiryPreset === option.value
                      ? 'rounded-full border border-emerald-500 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition dark:text-emerald-300'
                      : 'rounded-full border border-neutral-500/30 px-3 py-1 text-xs text-neutral-500 transition hover:border-neutral-500/60 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            {expiryPreset === 'custom' && (
              <input
                className={`${selectClass} mt-2`}
                type="date"
                aria-label="Custom expiry date"
                value={customExpiry}
                onChange={(event) => setCustomExpiry(event.target.value)}
              />
            )}
            <p className="mt-1.5 text-2xs text-neutral-500">
              {expiryPreset === 'none'
                ? 'The token never expires. You can revoke it at any time.'
                : expiryPreset === 'custom'
                  ? 'The token stays valid through the selected day.'
                  : `The token expires ${
                      TOKEN_EXPIRY_PRESETS.find((option) => option.value === expiryPreset)?.label
                    } from now.`}
            </p>
          </div>
          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              isLoading={loading}
              disabled={!name.trim() || !workflowId || (expiryPreset === 'custom' && !customExpiry)}
            >
              Generate token
            </Button>
          </div>
        </form>
      )}
    </GenericDialog>
  )
}

export function CreateWorkflowDialog({ agentId }: { agentId: string }) {
  const dialogRef = useRef<DialogHandle>(null)
  const [name, setName] = useState('')
  const [createWorkflow, { loading }] = useMutation(CreateAgentWorkflowOp)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await createWorkflow({
        variables: { agentId, name: name.trim() },
        refetchQueries: ['GetAgentDetail'],
        awaitRefetchQueries: true,
      })
      toast.success('Workflow created')
      dialogRef.current?.closeModal()
      setName('')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <GenericDialog
      ref={dialogRef}
      title="Create workflow"
      size="sm"
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaPlus /> Workflow
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <Input
          id="workflow-new-name"
          label="Name"
          value={name}
          setValue={setName}
          required
          maxLength={64}
        />
        <div className="flex justify-end">
          <Button type="submit" isLoading={loading} disabled={!name.trim()}>
            Create workflow
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

export function EditWorkflowDialog({
  workflow,
}: {
  workflow: { id: string; name: string }
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [name, setName] = useState(workflow.name)
  const [updateWorkflow, { loading }] = useMutation(UpdateAgentWorkflowOp)

  const reset = () => {
    setName(workflow.name)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await updateWorkflow({
        variables: {
          workflowId: workflow.id,
          name: name.trim(),
        },
        refetchQueries: ['GetAgentDetail'],
        awaitRefetchQueries: true,
      })
      toast.success('Workflow updated')
      dialogRef.current?.closeModal()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Edit workflow"
      size="sm"
      buttonVariant="ghost"
      buttonContent={
        <>
          <FaEdit /> Edit
        </>
      }
      onClose={reset}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <Input
          id={`workflow-${workflow.id}-name`}
          label="Name"
          value={name}
          setValue={setName}
          required
          maxLength={64}
        />
        <div className="flex justify-end">
          <Button type="submit" isLoading={loading} disabled={!name.trim()}>
            Save workflow
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

export function GrantWorkflowDialog({
  workflowId,
  connections,
  onDone,
}: {
  workflowId: string
  connections: Array<NamedItem & { serviceType: string }>
  credentials?: Array<NamedItem & { serviceType: string }>
  /** Notifies embedding views (e.g. the Overview mesh) that run queries the mutation does not refetch by name. */
  onDone?: () => void
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [connectionId, setConnectionId] = useState(connections[0]?.id || '')
  const [grant, { loading }] = useMutation(GrantAgentWorkflowOp)
  useEffect(() => {
    setConnectionId((current) =>
      connections.some((connection) => connection.id === current)
        ? current
        : connections[0]?.id || ''
    )
  }, [connections])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await grant({
        variables: { workflowId, connectionId },
        refetchQueries: ['GetAgentDetail'],
        awaitRefetchQueries: true,
      })
      toast.success('Connection granted to workflow')
      onDone?.()
      dialogRef.current?.closeModal()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <GenericDialog
      ref={dialogRef}
      title="Grant connection"
      size="sm"
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaPlus /> Add connection
        </>
      }
      buttonProps={{ disabled: !connections.length }}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <div>
          <FieldLabel>Connection *</FieldLabel>
          <AgentSelect
            id="workflow-grant-connection"
            value={connectionId}
            onChange={setConnectionId}
            options={connections.map((item) => ({
              value: item.id,
              label: `${item.name} (${item.serviceType})`,
            }))}
            required
          />
        </div>
        <p className="text-xs text-neutral-500">
          This Workflow uses the third-party credentials bound to the selected Connection.
        </p>
        <div className="flex justify-end">
          <Button type="submit" isLoading={loading} disabled={!connectionId}>
            Grant access
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

export function ConfirmAgentAction({
  title,
  description,
  actionLabel,
  onConfirm,
  danger = true,
  triggerVariant,
  triggerContent,
}: {
  title: string
  description: string
  actionLabel: string
  onConfirm: () => Promise<void>
  danger?: boolean
  triggerVariant?: ButtonVariant
  triggerContent?: React.ReactNode
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [loading, setLoading] = useState(false)
  const run = async () => {
    setLoading(true)
    try {
      await onConfirm()
      dialogRef.current?.closeModal()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }
  return (
    <GenericDialog
      ref={dialogRef}
      title={title}
      size="sm"
      buttonVariant={triggerVariant || 'ghost'}
      buttonContent={
        triggerContent ??
        (danger ? (
          <>
            <FaTimes /> {actionLabel}
          </>
        ) : (
          <>
            <FaUnlink /> {actionLabel}
          </>
        ))
      }
    >
      <div className="space-y-4 pt-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
        <div className="flex justify-end">
          <Button
            type="button"
            variant={danger ? 'danger' : 'warning'}
            isLoading={loading}
            onClick={run}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
