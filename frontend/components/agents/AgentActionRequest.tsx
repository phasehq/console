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
import {
  ChoiceGroup,
  GrantDurationField,
  MethodToggles,
} from '@/components/agents/AgentAccessControls'
import {
  AccessRecordLine,
  AllowDetails,
  AppAccessDetails,
  ContextDetails,
  RenewDetails,
} from '@/components/agents/AgentRequestActionDetails'
import { EnvironmentChecklist, environmentsProblem } from '@/components/agents/EnvironmentChecklist'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { Input } from '@/components/common/Input'
import { ApproveAgentRequestActionOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetAgentSettings from '@/graphql/queries/agents/getAgentSettings.gql'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
import { secretFieldNames, type HttpDefinition } from '@/utils/agents/httpDefinition'
import {
  describeDuration,
  grantDurationResult,
  initialGrantDuration,
  type GrantDuration,
} from '@/utils/agents/accessDuration'
import {
  CLASS_LABEL,
  OPERATION_CLASSES,
  POLICY_LIMITS,
  describeTarget,
} from '@/utils/agents/accessPolicy'
import {
  ACCESS_LEVEL_LABEL,
  describeClasses,
  formatAccessTime,
  readAppVisibility,
  type AppAccessLevel,
  TOKEN_HOLDERS_LINE,
  withheldReviewLine,
} from '@/utils/agents/appAccess'
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
  actionAllowsUntilRevoked,
  actionTakesDuration,
  allowDraftFromTarget,
  allowDraftProblem,
  allowEdited,
  allowFromDraft,
  approvalLabel,
  editedAllowAction,
  editedAppAccessAction,
  editedContextAction,
  editedRequestAction,
  readAccessRecord,
  readAllowTarget,
  readActionReview,
  readActionSnapshot,
  readAppClasses,
  readWriteAccess,
  requestActionType,
  type ActionReview,
  type AllowDraft,
} from '@/utils/agents/requestActions'
import { APP_SERVICE_TYPE } from '@/utils/agents/appAccess'
import { CONTEXT_MAX_LENGTH } from '@/utils/agents/workflowContext'

export type AgentActionRequest = {
  id: string
  status: string
  title: string
  revision: string
  /** How long the access the request ends in was asked to last. */
  durationSeconds?: number | null
  /** Once approved: what was asked and what was granted. */
  access?: unknown
  action?: unknown
  appliedAction?: unknown
  approval?: unknown
  actionReview?: unknown
  connection?: {
    id: string
    name: string
    serviceType?: string
    encryptionPublicKey?: string | null
  } | null
  workflow?: { name: string } | null
  agent: { name: string }
  /** A request about an app the viewer cannot fully access; its names are withheld. */
  appRestricted?: boolean | null
  hiddenEnvironmentCount?: number | null
}

const CHANGE_STYLE: Record<DiffEntry['change'], { mark: string; text: string; word: string }> = {
  added: { mark: '+', text: 'text-emerald-700 dark:text-emerald-400', word: 'Added' },
  removed: { mark: '−', text: 'text-red-700 dark:text-red-400', word: 'Removed' },
  changed: { mark: '~', text: 'text-amber-700 dark:text-amber-400', word: 'Changed' },
  unchanged: { mark: '=', text: 'text-neutral-500', word: 'Unchanged' },
}

/** What an applied allow added, from the action as stored. */
function AppliedAllow({ action, app }: { action: unknown; app: boolean }) {
  const target = (action as { allow?: unknown } | null)?.allow
  // An app Connection's allow names classes of secrets calls.
  const classes = readAppClasses(target)
  const text =
    classes.length && (app || (target as { classes?: unknown }).classes)
      ? `${describeClasses(classes).toLowerCase()} secrets`
      : target
        ? describeTarget(readAllowTarget(target))
        : ''
  return (
    <p className="text-xs text-neutral-500">
      {text ? `Allowed ${text} for a limited time.` : 'Asked to allow a call for a limited time.'}
    </p>
  )
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

const UNREADABLE_DEFINITION = 'The requested definition cannot be read.'

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
      {diff.unreadable ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {UNREADABLE_DEFINITION}
        </p>
      ) : (
        !diff.changed && (
          <p className="text-xs text-neutral-500">
            This request changes nothing on the Connection.
          </p>
        )
      )}
      {diff.name && <DiffSection title="Name" entries={[diff.name]} />}
      <DiffSection title="Allowed hosts" entries={diff.hosts} />
      <DiffSection title="Where the secret goes" entries={diff.injections} />
      <DiffSection title="Fields" entries={diff.fields} />
      <DiffSection title="Call classes" entries={diff.operationClasses} />
      <DiffSection title="Settings" entries={diff.settings} />
    </div>
  )
}

/** One line on what a request asked for and, once approved, what it was granted. */
export function AgentAccessSummary({ request }: { request: AgentActionRequest }) {
  const record = readAccessRecord(request.access)
  if (record) return <AccessRecordLine record={record} />
  if (isAgentRequestPending(request.status) && typeof request.durationSeconds === 'number')
    return (
      <p className="text-xs text-neutral-500">
        Asks for access for {describeDuration(request.durationSeconds)}.
      </p>
    )
  return null
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

/** What a resolved app access request gave: the level, and until when it may write. */
function AppliedAppAccess({ request }: { request: AgentActionRequest }) {
  const action = (request.appliedAction ?? request.action) as { access?: unknown } | null
  const level: AppAccessLevel = action?.access === 'read_write' ? 'read_write' : 'read'
  const write = readWriteAccess(request.appliedAction)
  return (
    <p className="text-xs text-neutral-500">
      {request.appliedAction
        ? `${ACCESS_LEVEL_LABEL[level]} access to the app's secrets was granted${
            write?.expiresAt ? `, with write access until ${formatAccessTime(write.expiresAt)}` : ''
          }.`
        : `Asked for ${ACCESS_LEVEL_LABEL[level].toLowerCase()} access to the app's secrets.`}
    </p>
  )
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
        {type === REQUEST_ACTION_TYPES.allow && (
          <AppliedAllow
            action={request.appliedAction ?? request.action}
            app={request.connection?.serviceType === APP_SERVICE_TYPE}
          />
        )}
        {type === REQUEST_ACTION_TYPES.renew && (
          <p className="text-xs text-neutral-500">
            {request.appliedAction
              ? "The Workflow's access to the Connection was renewed."
              : "Asked to renew the Workflow's access to the Connection."}
          </p>
        )}
        {type === REQUEST_ACTION_TYPES.contextUpdate && (
          <p className="text-xs text-neutral-500">
            {request.appliedAction
              ? "The Workflow's context was replaced with the approved text."
              : "Asked to replace the Workflow's context."}
          </p>
        )}
        {type === REQUEST_ACTION_TYPES.appAccess && <AppliedAppAccess request={request} />}
        <AgentAccessSummary request={request} />
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
        <>
          <AgentActionDiff current={review.current} requested={review.requested} />
          <AgentAccessSummary request={request} />
        </>
      ) : review.allow ? (
        <AllowDetails review={review.allow} />
      ) : review.renew ? (
        <RenewDetails review={review.renew} />
      ) : review.context ? (
        <ContextDetails review={review.context} />
      ) : review.appAccess ? (
        <AppAccessDetails review={review.appAccess} />
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
  [REQUEST_ACTION_TYPES.allow]: 'Approve and allow',
  [REQUEST_ACTION_TYPES.renew]: 'Approve renewal',
  [REQUEST_ACTION_TYPES.contextUpdate]: 'Approve context change',
  [REQUEST_ACTION_TYPES.appAccess]: 'Approve access',
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
  organisationId,
  autoOpen,
  onAutoOpened,
  onDone,
}: {
  request: AgentActionRequest
  /** Needed to read the organisation maximum an allow is held to. */
  organisationId?: string
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
  const isAllow = type === REQUEST_ACTION_TYPES.allow
  const isRenew = type === REQUEST_ACTION_TYPES.renew
  const isContext = type === REQUEST_ACTION_TYPES.contextUpdate
  const isAppAccess = type === REQUEST_ACTION_TYPES.appAccess
  // An allow on an app Connection names classes of secrets calls; it is approved as asked.
  const isAppAllow = isAllow && !!(review?.allow?.app || review?.allow?.visibility.appRestricted)
  // A member who cannot see all the request is about cannot approve it.
  const withheldLine = withheldReviewLine(readAppVisibility(request))
  const takesDuration = actionTakesDuration(type)
  const allowUntilRevoked = actionAllowsUntilRevoked(type)
  const requestedSeconds =
    request.durationSeconds ??
    review?.requested?.durationSeconds ??
    review?.allow?.durationSeconds ??
    review?.renew?.durationSeconds ??
    null
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
  // A temporary allow is held to the organisation maximum; a request that names no duration
  // starts at the organisation default.
  const namedDuration = typeof requestedSeconds === 'number' && requestedSeconds > 0
  const { data: settingsData, loading: settingsLoading } = useQuery(GetAgentSettings, {
    variables: { organisationId },
    skip: !takesDuration || !organisationId,
  })
  const organisationMaximum: number | null =
    settingsData?.agentSettings?.maxRequestDurationSeconds ?? null
  const maximumSeconds: number | null = isAllow ? organisationMaximum : null
  const defaultSeconds: number | null =
    settingsData?.agentSettings?.defaultRequestDurationSeconds ?? null
  const [duration, setDuration] = useState<GrantDuration>(() =>
    initialGrantDuration(requestedSeconds, allowUntilRevoked, defaultSeconds)
  )
  const [durationTouched, setDurationTouched] = useState(false)
  const [allowDraft, setAllowDraft] = useState<AllowDraft>(() =>
    allowDraftFromTarget(review?.allow?.allow ?? {}, review?.allow?.blockedCall ?? null)
  )
  const [contextText, setContextText] = useState(review?.context?.requested ?? '')
  // App access: the reviewer may untick environments and change the level.
  const requestedEnvironmentIds = useMemo(
    () => (review?.appAccess?.environments ?? []).map((environment) => environment.id),
    [review?.appAccess?.environments]
  )
  const [environmentIds, setEnvironmentIds] = useState<string[]>(requestedEnvironmentIds)
  const [accessLevel, setAccessLevel] = useState<AppAccessLevel>(
    review?.appAccess?.access ?? 'read'
  )
  // Write access always ends; it starts at what was asked for, within the organisation maximum.
  const writeStart = (maximum: number | null): GrantDuration => {
    const clamped =
      typeof requestedSeconds === 'number' && maximum
        ? Math.min(requestedSeconds, maximum)
        : requestedSeconds
    const start = initialGrantDuration(
      clamped,
      false,
      maximum && defaultSeconds ? Math.min(defaultSeconds, maximum) : defaultSeconds
    )
    // "As requested" would resolve to the unclamped request, so a clamped value is a custom amount.
    return start.choice === 'requested' && clamped !== requestedSeconds
      ? { ...start, choice: 'custom' }
      : start
  }
  const [writeDuration, setWriteDuration] = useState<GrantDuration>(() =>
    writeStart(organisationMaximum)
  )
  const [writeTouched, setWriteTouched] = useState(false)

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
      setDuration(initialGrantDuration(requestedSeconds, allowUntilRevoked, defaultSeconds))
    if (!writeTouched) setWriteDuration(writeStart(organisationMaximum))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSeconds, organisationMaximum])

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
    setDuration(initialGrantDuration(requestedSeconds, allowUntilRevoked, defaultSeconds))
    setDurationTouched(false)
    setAllowDraft(
      allowDraftFromTarget(review?.allow?.allow ?? {}, review?.allow?.blockedCall ?? null)
    )
    setContextText(review?.context?.requested ?? '')
    setEnvironmentIds(requestedEnvironmentIds)
    setAccessLevel(review?.appAccess?.access ?? 'read')
    setWriteDuration(writeStart(organisationMaximum))
    setWriteTouched(false)
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

  const durationResult = grantDurationResult(duration, requestedSeconds, {
    allowUntilRevoked,
    maximumSeconds,
  })
  // What is shown is what is applied, so the default the control starts at must be known first.
  const waitingForDefault = takesDuration && !namedDuration && !!organisationId && settingsLoading
  const durationProblem = waitingForDefault
    ? 'Reading the organisation default duration.'
    : durationResult.problem
  const editedAllow = isAllow ? allowFromDraft(allowDraft) : null
  const allowChanged =
    isAllow && !isAppAllow && !!review?.allow && allowEdited(review.allow.allow, editedAllow)
  const contextChanged = isContext && !!review?.context && contextText !== review.context.requested
  const writes = isAppAccess && accessLevel === 'read_write'
  const writeResult = grantDurationResult(writeDuration, requestedSeconds, {
    allowUntilRevoked: false,
    maximumSeconds: organisationMaximum,
  })
  const appAccessChanged =
    isAppAccess &&
    !!review?.appAccess &&
    (accessLevel !== review.appAccess.access ||
      environmentIds.length !== requestedEnvironmentIds.length)
  const missingTarget =
    !review ||
    ((isUpdate || isSecretUpdate) && !current) ||
    (isAllow && !review.allow?.policy) ||
    (isRenew && !review.renew) ||
    (isAppAccess && (!review.appAccess?.app || review.appAccess.environments.length === 0))
  const formProblem =
    (isCreate || isUpdate) && !definition
      ? editor.built.issues.find((issue) => !issue.missing)?.message || 'Fill in the form.'
      : (needSecrets && definition ? secretsProblem(definition, fieldSecrets) : '') ||
        (isCreate && !serverPublicKey ? 'The server key is not available yet.' : '')
  const unreadable = (isCreate || isUpdate) && requested?.definitionUnreadable === true
  // Nothing to edit or set while the request cannot be approved here.
  const inert = missingTarget || !!withheldLine
  const problem = withheldLine
    ? withheldLine
    : missingTarget
      ? 'This action can no longer be applied.'
      : (unreadable ? UNREADABLE_DEFINITION : '') ||
        (takesDuration ? durationProblem : '') ||
        (isAllow && !isAppAllow ? allowDraftProblem(allowDraft) : '') ||
        (isAppAccess ? environmentsProblem(environmentIds) : '') ||
        (writes ? (waitingForDefault ? durationProblem : writeResult.problem) : '') ||
        (isContext && contextText.length > CONTEXT_MAX_LENGTH
          ? `Use at most ${CONTEXT_MAX_LENGTH.toLocaleString()} characters.`
          : '') ||
        formProblem

  const finish = async () => {
    setFailure('')
    setWorking(true)
    try {
      if (requestChanged || reviewedRevision.current !== request.revision)
        throw new Error('This request changed while you were reviewing it. Close and reopen it.')
      if (problem) throw new Error(problem)
      let inputs: Record<string, unknown> | undefined
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
          : allowChanged && editedAllow
            ? editedAllowAction(request.action, editedAllow)
            : contextChanged
              ? editedContextAction(request.action, contextText)
              : appAccessChanged
                ? editedAppAccessAction(request.action, environmentIds, accessLevel)
                : undefined
      // Write access ends on its own clock, which the reviewer set.
      if (writes && writeResult.seconds)
        inputs = { ...inputs, writeDurationSeconds: writeResult.seconds }
      const result = await approve({
        variables: {
          requestId: request.id,
          expectedRevision: reviewedRevision.current,
          ...(action ? { action } : {}),
          ...(inputs ? { inputs } : {}),
          // The visible choice is sent as it stands, so what is granted is what was shown.
          ...(takesDuration && durationResult.args ? durationResult.args : {}),
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
        {review && !isCreate && !isUpdate && !isAllow && !isRenew && !isContext && !isAppAccess && (
          <p className="text-sm">{actionSentence(review, request.workflow?.name)}</p>
        )}
        {withheldLine && (
          <Alert variant="info" icon size="sm">
            <span className="text-xs">{withheldLine}</span>
          </Alert>
        )}
        {review?.appAccess && withheldLine && (
          <section
            aria-label="Requested change"
            className="space-y-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
          >
            <AppAccessDetails review={review.appAccess} />
          </section>
        )}
        {review?.allow && (
          <section
            aria-label="Requested change"
            className="space-y-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
          >
            <AllowDetails
              review={review.allow}
              target={allowChanged && editedAllow ? editedAllow : undefined}
            />
          </section>
        )}
        {review?.renew && (
          <section
            aria-label="Requested change"
            className="space-y-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
          >
            <RenewDetails review={review.renew} />
          </section>
        )}
        {review?.context && (
          <section
            aria-label="Requested change"
            className="space-y-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold">
                {contextChanged ? 'Your edits' : 'Requested by the Agent'}
              </h4>
              {contextChanged && <AgentBadge tone="amber">Edited</AgentBadge>}
            </div>
            <ContextDetails review={review.context} requested={contextText} />
          </section>
        )}

        {review?.appAccess && !inert && (
          <section
            aria-label="Requested change"
            className="space-y-4 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold">
                {appAccessChanged ? 'Your edits' : 'Requested by the Agent'}
              </h4>
              {appAccessChanged && <AgentBadge tone="amber">Edited</AgentBadge>}
            </div>
            <p className="min-w-0 truncate text-xs">
              <span className="text-neutral-500">App</span>{' '}
              <span className="font-medium">{review.appAccess.app?.name}</span>
            </p>
            <EnvironmentChecklist
              id={`${id}-environments`}
              label="Environments"
              environments={review.appAccess.environments}
              selected={environmentIds}
              onChange={setEnvironmentIds}
              keepOne
            />
            <div className="space-y-2">
              <span className="block text-xs text-neutral-500">Access</span>
              <ChoiceGroup<AppAccessLevel>
                label="Access"
                value={accessLevel}
                options={[
                  { value: 'read', label: ACCESS_LEVEL_LABEL.read },
                  { value: 'read_write', label: ACCESS_LEVEL_LABEL.read_write },
                ]}
                onChange={setAccessLevel}
              />
            </div>
            <p className="text-xs text-neutral-500">
              {review.appAccess.reuses && !appAccessChanged
                ? `Approving reuses the Connection ${review.appAccess.reuses.name}, whose access rules apply.`
                : review.appAccess.reuses
                  ? 'Approving reuses a Connection that covers exactly these environments, or creates one.'
                  : 'Approving creates a Connection for these environments: reads allowed, writes ask.'}
            </p>
          </section>
        )}

        {(isAllow || isContext) && !isAppAllow && !inert && (
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
                {isAllow
                  ? allowDraft.scope === 'operation'
                    ? 'Change the action'
                    : 'Narrow the rule'
                  : 'Edit request'}
              </Button>
              {(allowChanged || contextChanged) && (
                <Button
                  type="button"
                  variant="ghost"
                  icon={FaUndo}
                  onClick={() => {
                    setAllowDraft(
                      allowDraftFromTarget(
                        review?.allow?.allow ?? {},
                        review?.allow?.blockedCall ?? null
                      )
                    )
                    setContextText(review?.context?.requested ?? '')
                  }}
                >
                  Reset to the request
                </Button>
              )}
            </div>
            {editing && isAllow && (
              <div
                id={`${id}-edit`}
                className="space-y-3 rounded-lg border border-neutral-500/20 p-3"
              >
                <p className="text-xs text-neutral-500">
                  {allowDraft.scope === 'operation'
                    ? 'This allows one AWS action. You can swap it for another exact action; it cannot be widened to a kind of call or a path.'
                    : 'A narrower rule lets fewer calls through: fewer methods, or a longer path.'}
                </p>
                {allowDraft.scope === 'operation' && (
                  <Input
                    id={`${id}-allow-operation`}
                    label="AWS action"
                    value={allowDraft.operation}
                    setValue={(operation) => setAllowDraft({ ...allowDraft, operation })}
                    placeholder="ec2:TerminateInstances"
                    maxLength={POLICY_LIMITS.operation}
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
                {allowDraft.scope === 'operation' && allowDraftProblem(allowDraft) && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                    {allowDraftProblem(allowDraft)}
                  </p>
                )}
                {allowDraft.scope !== 'operation' && (
                  <div className="space-y-2">
                    <label htmlFor={`${id}-allow-scope`} className="block text-xs text-neutral-500">
                      Allow
                    </label>
                    <AgentSelect
                      id={`${id}-allow-scope`}
                      value={allowDraft.scope}
                      onChange={(scope) =>
                        setAllowDraft({ ...allowDraft, scope: scope as AllowDraft['scope'] })
                      }
                      options={[
                        { value: 'match', label: 'Calls matching a method and path' },
                        { value: 'class', label: 'Every call of one kind' },
                      ]}
                    />
                  </div>
                )}
                {allowDraft.scope === 'operation' ? null : allowDraft.scope === 'class' ? (
                  <div className="space-y-2">
                    <label htmlFor={`${id}-allow-class`} className="block text-xs text-neutral-500">
                      Kind of call
                    </label>
                    <AgentSelect
                      id={`${id}-allow-class`}
                      value={allowDraft.class}
                      onChange={(value) =>
                        setAllowDraft({ ...allowDraft, class: value as AllowDraft['class'] })
                      }
                      placeholder="Choose a kind of call"
                      options={OPERATION_CLASSES.map((name) => ({
                        value: name,
                        label: CLASS_LABEL[name].name,
                      }))}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <MethodToggles
                      label="Methods"
                      methods={allowDraft.methods}
                      onChange={(methods) => setAllowDraft({ ...allowDraft, methods })}
                    />
                    <Input
                      id={`${id}-allow-path`}
                      label="Path"
                      value={allowDraft.path}
                      setValue={(path) => setAllowDraft({ ...allowDraft, path })}
                      placeholder="/v1/charges/*"
                      maxLength={POLICY_LIMITS.path}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            )}
            {editing && isContext && (
              <div
                id={`${id}-edit`}
                className="space-y-2 rounded-lg border border-neutral-500/20 p-3"
              >
                <Textarea
                  id={`${id}-context`}
                  aria-label="Requested context"
                  rows={12}
                  maxLength={CONTEXT_MAX_LENGTH}
                  value={contextText}
                  setValue={setContextText}
                />
                <p
                  className={clsx(
                    'text-right text-2xs',
                    contextText.length > CONTEXT_MAX_LENGTH
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-neutral-500'
                  )}
                  aria-live="polite"
                >
                  {contextText.length.toLocaleString()} / {CONTEXT_MAX_LENGTH.toLocaleString()}
                  {contextText.length > CONTEXT_MAX_LENGTH && ': too long to save'}
                </p>
              </div>
            )}
          </div>
        )}

        {takesDuration && !inert && (
          <GrantDurationField
            id={`${id}-duration`}
            value={duration}
            onChange={(next) => {
              setDuration(next)
              setDurationTouched(true)
            }}
            requestedSeconds={requestedSeconds}
            allowUntilRevoked={allowUntilRevoked}
            problem={durationProblem}
          />
        )}
        {isAppAccess && !inert && <p className="text-xs text-neutral-500">{TOKEN_HOLDERS_LINE}</p>}
        {writes && !inert && (
          <GrantDurationField
            id={`${id}-write-duration`}
            label="Write access ends after"
            value={writeDuration}
            onChange={(next) => {
              setWriteDuration(next)
              setWriteTouched(true)
            }}
            requestedSeconds={requestedSeconds}
            allowUntilRevoked={false}
            problem={writeResult.problem}
          />
        )}
        {writes && organisationMaximum && (
          <p className="-mt-2 text-xs text-neutral-500">
            Your organisation allows at most {describeDuration(organisationMaximum)} for write
            access. It never outlasts the access above.
          </p>
        )}
        {isAllow && maximumSeconds && (
          <p className="-mt-2 text-xs text-neutral-500">
            Your organisation allows at most {describeDuration(maximumSeconds)} for an allow.
          </p>
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
            !inert && (
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
