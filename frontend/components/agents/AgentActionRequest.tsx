'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import isEqual from 'lodash/isEqual'
import { FaCheck, FaChevronDown, FaChevronRight, FaUndo } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Textarea } from '@/components/common/TextArea'
import { AgentBadge } from '@/components/agents/AgentUI'
import { isAgentRequestPending } from '@/components/agents/AgentEnums'
import { CustomConnectionSummary } from '@/components/agents/CustomConnectionDialogs'
import {
  CustomConnectionFields,
  SecretFieldInputs,
  useCustomConnectionEditor,
} from '@/components/agents/CustomConnectionForm'
import { ApproveAgentRequestActionOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
import { secretFieldNames, type HttpDefinition } from '@/utils/agents/httpDefinition'
import {
  customConnectionFormFromDefinition,
  emptyCustomConnectionForm,
  sameDefinition,
} from '@/utils/agents/customConnectionForm'
import {
  diffConnections,
  type ConnectionSnapshot,
  type DiffEntry,
} from '@/utils/agents/customConnectionDiff'
import {
  newCustomConnectionMaterial,
  sealCustomConnectionValue,
  secretRequirement,
  secretsProblem,
} from '@/utils/agents/customConnectionSealing'
import {
  REQUEST_ACTION_TYPES,
  approvalLabel,
  editedRequestAction,
  readActionReview,
  readActionSnapshot,
  requestActionType,
  type ActionReview,
} from '@/utils/agents/requestActions'

export type AgentActionRequest = {
  id: string
  status: string
  title: string
  revision: string
  action?: unknown
  appliedAction?: unknown
  approval?: unknown
  actionReview?: unknown
  connection?: { id: string; name: string; encryptionPublicKey?: string | null } | null
  workflow?: { name: string } | null
  agent: { name: string }
}

const CHANGE_STYLE: Record<DiffEntry['change'], { mark: string; text: string; word: string }> = {
  added: { mark: '+', text: 'text-emerald-700 dark:text-emerald-400', word: 'Added' },
  removed: { mark: '−', text: 'text-red-700 dark:text-red-400', word: 'Removed' },
  changed: { mark: '~', text: 'text-amber-700 dark:text-amber-400', word: 'Changed' },
  unchanged: { mark: '=', text: 'text-neutral-500', word: 'Unchanged' },
}

function DiffSection({ title, entries }: { title: string; entries: DiffEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div>
      <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">{title}</h4>
      <ul className="mt-1 space-y-1">
        {entries.map((entry, index) => {
          const style = CHANGE_STYLE[entry.change]
          return (
            <li key={`${entry.label}-${index}`} className="flex items-start gap-2 text-xs">
              <span aria-hidden="true" className={clsx('w-3 shrink-0 font-mono', style.text)}>
                {style.mark}
              </span>
              <span className="min-w-0">
                <span className="sr-only">{style.word}: </span>
                {entry.change === 'changed' ? (
                  <>
                    <span className="font-medium">{entry.label}</span>{' '}
                    <code className="break-all text-neutral-500 line-through">{entry.before}</code>{' '}
                    <span aria-hidden="true">→</span>
                    <span className="sr-only"> becomes </span>{' '}
                    <code className={clsx('break-all', style.text)}>{entry.after}</code>
                  </>
                ) : (
                  <>
                    {entry.label !== (entry.after ?? entry.before) && (
                      <span className="font-medium">{entry.label} </span>
                    )}
                    <code
                      className={clsx(
                        'break-all',
                        style.text,
                        entry.change === 'removed' && 'line-through'
                      )}
                    >
                      {entry.after ?? entry.before}
                    </code>
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** The Connection as it is set against what is requested. */
export function AgentActionDiff({
  current,
  requested,
}: {
  current: ConnectionSnapshot | null
  requested: ConnectionSnapshot | null
}) {
  const diff = useMemo(() => diffConnections(current, requested), [current, requested])
  return (
    <div className="space-y-3">
      {!diff.changed && (
        <p className="text-xs text-neutral-500">This request changes nothing on the Connection.</p>
      )}
      {diff.name && <DiffSection title="Name" entries={[diff.name]} />}
      <DiffSection title="Allowed hosts" entries={diff.hosts} />
      <DiffSection title="Where the secret goes" entries={diff.injections} />
      <DiffSection title="Fields" entries={diff.fields} />
      <DiffSection title="Settings" entries={diff.settings} />
    </div>
  )
}

const actionSentence = (review: ActionReview, workflowName?: string | null) => {
  const name = review.current?.name || 'this Connection'
  switch (review.type) {
    case REQUEST_ACTION_TYPES.secretUpdate:
      return `Asks a member to enter a new secret for ${name}. The definition does not change, and the request carries no value.`
    case REQUEST_ACTION_TYPES.remove:
      return `Removes ${workflowName ? `the ${workflowName} Workflow's` : "this Workflow's"} access to ${name}. The Connection and its other grants stay.`
    default:
      return ''
  }
}

/** What an action request asks for, or once resolved, what was applied and how. */
export function AgentActionReview({ request }: { request: AgentActionRequest }) {
  const review = readActionReview(request.actionReview)
  const pending = isAgentRequestPending(request.status)
  const applied = readActionSnapshot(request.appliedAction)
  const filed = readActionSnapshot(request.action)
  const type = requestActionType(request.action)
  const assurance = approvalLabel(request.approval)

  if (!pending) {
    const wasEdited =
      !!request.appliedAction && !!request.action && !isEqual(request.appliedAction, request.action)
    const shown = applied ?? filed
    return (
      <section className="space-y-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold">
            {request.appliedAction ? 'Applied action' : 'Requested change'}
          </h3>
          {wasEdited && <AgentBadge tone="amber">Edited by the reviewer</AgentBadge>}
        </div>
        {shown?.name && (
          <p className="text-xs">
            <span className="text-neutral-500">Name</span>{' '}
            <span className="font-medium">{shown.name}</span>
          </p>
        )}
        {shown?.definition && <CustomConnectionSummary definition={shown.definition} />}
        {type === REQUEST_ACTION_TYPES.secretUpdate && (
          <p className="text-xs text-neutral-500">
            {request.appliedAction
              ? 'A member entered a new secret. The definition did not change.'
              : 'Asked a member to enter a new secret.'}
          </p>
        )}
        {type === REQUEST_ACTION_TYPES.remove && (
          <p className="text-xs text-neutral-500">
            {request.appliedAction
              ? "The Workflow's access to the Connection was removed."
              : "Asked to remove the Workflow's access to the Connection."}
          </p>
        )}
        {assurance && <p className="text-xs text-neutral-500">Approved with {assurance}.</p>}
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3">
      <h3 className="text-xs font-semibold">Requested change</h3>
      {!review ? (
        <p className="text-xs text-neutral-500">
          This action can no longer be reviewed: its Connection may have been removed. Deny the
          request so the Agent can file a new one.
        </p>
      ) : review.type === REQUEST_ACTION_TYPES.create ||
        review.type === REQUEST_ACTION_TYPES.update ? (
        <AgentActionDiff current={review.current} requested={review.requested} />
      ) : (
        <>
          <p className="text-xs">{actionSentence(review, request.workflow?.name)}</p>
          {review.current?.definition && (
            <CustomConnectionSummary definition={review.current.definition} />
          )}
        </>
      )}
      {review?.requiresSecret && (
        <p className="text-xs text-neutral-500">
          Approving this asks you for the secret. Agents never set one.
        </p>
      )}
    </section>
  )
}

const APPROVE_LABEL: Record<string, string> = {
  [REQUEST_ACTION_TYPES.create]: 'Approve and create',
  [REQUEST_ACTION_TYPES.update]: 'Approve change',
  [REQUEST_ACTION_TYPES.secretUpdate]: 'Update secret',
  [REQUEST_ACTION_TYPES.remove]: 'Approve removal',
}

const REFETCH_AFTER_APPROVAL = [
  'GetAgentRequests',
  'GetPendingAgentRequestCount',
  'GetAgentRequestMesh',
  'GetAgentAssets',
  'GetAgentDetail',
  'GetAgentMesh',
]

/** Review, optionally edit, and approve a request that carries an action. */
export function AgentActionApproveDialog({
  request,
  autoOpen,
  onAutoOpened,
  onDone,
}: {
  request: AgentActionRequest
  autoOpen?: boolean
  /** Lets the page consume a deep link, so a remounted card does not reopen it. */
  onAutoOpened?: () => void
  onDone?: () => void
}) {
  const id = useId()
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const opened = useRef(false)
  const reviewing = useRef(false)
  const reviewedRevision = useRef(request.revision)
  const review = useMemo(() => readActionReview(request.actionReview), [request.actionReview])
  const type = review?.type
  const isCreate = type === REQUEST_ACTION_TYPES.create
  const isUpdate = type === REQUEST_ACTION_TYPES.update
  const isSecretUpdate = type === REQUEST_ACTION_TYPES.secretUpdate
  const current = review?.current?.definition ?? null
  const requested = review?.requested ?? null

  const editor = useCustomConnectionEditor(isCreate ? null : current)
  const [editable, setEditable] = useState(false)
  const [editing, setEditing] = useState(false)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [failure, setFailure] = useState('')
  const [requestChanged, setRequestChanged] = useState(false)
  const [working, setWorking] = useState(false)
  const [approve] = useMutation(ApproveAgentRequestActionOp)
  const { data: serverKeyData } = useQuery(GetServerKey, { skip: !isCreate })
  const serverPublicKey: string = serverKeyData?.serverPublicKey || ''

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

  const loadRequested = () => {
    const form =
      (isCreate || isUpdate) && requested?.definition
        ? customConnectionFormFromDefinition(requested.name, requested.definition)
        : null
    setEditable(!!form)
    editor.reset(form ?? emptyCustomConnectionForm(requested?.name || ''))
  }
  const begin = () => {
    reviewing.current = true
    reviewedRevision.current = request.revision
    setRequestChanged(false)
    setFailure('')
    setNote('')
    setSecrets({})
    setEditing(false)
    loadRequested()
  }
  const end = () => {
    reviewing.current = false
    setSecrets({})
    editor.clearSecrets()
    setFailure('')
    setRequestChanged(false)
  }

  // The definition approval will apply: the reviewer's edit, or the request as filed.
  const editedDefinition = editable ? editor.built.definition : null
  const edited =
    editable &&
    !!requested?.definition &&
    (!editedDefinition ||
      editor.form.name.trim() !== requested.name ||
      !sameDefinition(editedDefinition, requested.definition))
  const definition: HttpDefinition | null = isSecretUpdate
    ? current
    : editable
      ? editedDefinition
      : requested?.definition ?? null
  const requirement = secretRequirement(isCreate ? null : current, definition)
  const needSecrets =
    isCreate ||
    isSecretUpdate ||
    (isUpdate && (requirement.required || (!edited && review?.requiresSecret === true)))
  const secretReason = isUpdate
    ? requirement.reason ||
      'This change needs the secret entered again, sealed to the new definition.'
    : isSecretUpdate
      ? 'Enter the new value. The stored one is never shown.'
      : 'Agents never set a secret. Enter it here: it is encrypted in your browser before it is sent.'
  const fieldSecrets = useMemo(() => {
    const names = definition ? secretFieldNames(definition) : []
    return Object.fromEntries(Object.entries(secrets).filter(([name]) => names.includes(name)))
  }, [definition, secrets])

  const missingTarget = !review || ((isUpdate || isSecretUpdate) && !current)
  const problem = missingTarget
    ? 'This action can no longer be applied.'
    : (isCreate || isUpdate) && !definition
      ? editor.built.issues.find((issue) => !issue.missing)?.message || 'Fill in the form.'
      : (needSecrets && definition ? secretsProblem(definition, fieldSecrets) : '') ||
        (isCreate && !serverPublicKey ? 'The server key is not available yet.' : '')

  const finish = async () => {
    setFailure('')
    setWorking(true)
    try {
      if (requestChanged || reviewedRevision.current !== request.revision)
        throw new Error('This request changed while you were reviewing it. Close and reopen it.')
      if (problem) throw new Error(problem)
      let inputs: Record<string, string> | undefined
      if (isCreate && definition)
        inputs = await newCustomConnectionMaterial(definition, fieldSecrets, serverPublicKey)
      else if (needSecrets && definition)
        inputs = {
          sealedValue: await sealCustomConnectionValue(
            definition,
            fieldSecrets,
            request.connection?.encryptionPublicKey || ''
          ),
        }
      const action =
        edited && definition
          ? editedRequestAction(request.action, editor.form.name.trim(), definition)
          : undefined
      const result = await approve({
        variables: {
          requestId: request.id,
          expectedRevision: reviewedRevision.current,
          ...(action ? { action } : {}),
          ...(inputs ? { inputs } : {}),
          resolutionNote: note.trim() || null,
        },
        refetchQueries: REFETCH_AFTER_APPROVAL,
        awaitRefetchQueries: true,
      })
      setSecrets({})
      toast.success(
        result?.data?.approveAgentRequestAction?.runtimeAction === 'restart_required'
          ? 'Request approved. The Agent restarts its session to pick up the change.'
          : 'Request approved'
      )
      onDone?.()
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Could not approve the request'
      )
    } finally {
      setWorking(false)
    }
  }

  const label = (type && APPROVE_LABEL[type]) || 'Approve'
  const liveRequested: ConnectionSnapshot | null =
    editable && editedDefinition
      ? { name: editor.form.name.trim() || requested?.name, definition: editedDefinition }
      : requested

  return (
    <GenericDialog
      ref={dialogRef}
      title={request.title || 'Review request'}
      size="md"
      buttonVariant="success"
      buttonContent="Review and approve"
      buttonProps={{ icon: FaCheck }}
      onOpen={begin}
      onClose={end}
    >
      <div className="space-y-4 pt-4">
        <p className="text-xs text-neutral-500">
          Requested by <strong>{request.agent.name}</strong>
          {request.workflow?.name && <> for the {request.workflow.name} Workflow</>}.
        </p>

        {review && (isCreate || isUpdate) && (
          <section
            aria-label="Requested change"
            className="space-y-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold">
                {edited ? 'Your edits' : 'Requested by the Agent'}
              </h4>
              {edited && <AgentBadge tone="amber">Edited</AgentBadge>}
            </div>
            <AgentActionDiff current={review.current} requested={liveRequested} />
          </section>
        )}
        {review && !isCreate && !isUpdate && (
          <p className="text-sm">{actionSentence(review, request.workflow?.name)}</p>
        )}

        {(isCreate || isUpdate) &&
          (editable ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  icon={editing ? FaChevronDown : FaChevronRight}
                  aria-expanded={editing}
                  aria-controls={`${id}-edit`}
                  onClick={() => setEditing((open) => !open)}
                >
                  Edit request
                </Button>
                {edited && (
                  <Button type="button" variant="ghost" icon={FaUndo} onClick={loadRequested}>
                    Reset to the request
                  </Button>
                )}
              </div>
              {editing && (
                <div id={`${id}-edit`} className="rounded-lg border border-neutral-500/20 p-3">
                  <CustomConnectionFields idPrefix={id} editor={editor} askSecrets={false} />
                </div>
              )}
            </div>
          ) : (
            !missingTarget && (
              <Alert variant="info" icon size="sm">
                <span className="text-xs">
                  This request uses a shape the form cannot edit. Approve it as filed, or deny it
                  with a note saying what to change.
                </span>
              </Alert>
            )
          ))}

        {needSecrets && definition && (
          <section aria-label="Secret" className="space-y-3">
            <h4 className="text-xs font-semibold">Secret</h4>
            <p className="text-xs text-neutral-500">{secretReason}</p>
            <SecretFieldInputs
              idPrefix={id}
              definition={definition}
              secrets={fieldSecrets}
              setSecrets={setSecrets}
            />
          </section>
        )}

        <Textarea
          id={`${id}-note`}
          label="Note to the Agent (optional)"
          rows={3}
          maxLength={20000}
          value={note}
          setValue={setNote}
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
            variant="success"
            icon={FaCheck}
            onClick={finish}
            isLoading={working}
            disabled={!!problem || requestChanged || !isAgentRequestPending(request.status)}
            title={problem || undefined}
          >
            {label}
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
