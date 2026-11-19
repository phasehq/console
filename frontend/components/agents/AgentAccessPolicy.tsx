'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import {
  FaCheck,
  FaChevronDown,
  FaChevronRight,
  FaEdit,
  FaLock,
  FaPlus,
  FaTrashAlt,
} from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { ChoiceGroup, MethodToggles } from '@/components/agents/AgentAccessControls'
import { SetAgentConnectionPolicyOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import {
  CLASS_LABEL,
  EFFECTS,
  EFFECT_LABEL,
  OPERATION_CLASSES,
  POLICY_LIMITS,
  draftFromPolicy,
  newAdvancedRule,
  newOperationRule,
  policyOverview,
  policyPayload,
  policyProblem,
  policySummary,
  readManagedPolicies,
  samePolicy,
  takesOperations,
  withDefault,
  type AdvancedRuleDraft,
  type OperationRuleDraft,
  type PolicyDraft,
  type PolicyEffect,
} from '@/utils/agents/accessPolicy'
import { APP_CLASSES, APP_CLASS_HINT, isAppConnection } from '@/utils/agents/appAccess'

/** `app`: an app Connection, which has only the four classes of the secrets API. */
export type PolicyVariant = 'http' | 'app'

const EFFECT_STYLE: Record<PolicyEffect, string> = {
  allow: 'bg-emerald-600 text-white dark:bg-emerald-400/20 dark:text-emerald-300',
  ask: 'bg-amber-600 text-white dark:bg-amber-400/20 dark:text-amber-300',
  block: 'bg-red-600 text-white dark:bg-red-400/20 dark:text-red-300',
}

const EFFECT_OPTIONS = EFFECTS.map((effect) => ({
  value: effect,
  label: EFFECT_LABEL[effect],
  selectedClass: EFFECT_STYLE[effect],
}))

const EFFECT_TEXT: Record<PolicyEffect, string> = {
  allow: 'text-emerald-700 dark:text-emerald-400',
  ask: 'text-amber-700 dark:text-amber-400',
  block: 'text-red-700 dark:text-red-400',
}

const MANAGED_LABEL: Record<string, { name: string; line: string }> = {
  secret_guard: {
    name: 'Secret guard',
    line: 'Blocks calls that mint new credentials or assume another identity. It is always on and cannot be turned off.',
  },
}

/**
 * Rules Phase applies to every Connection of a kind. They are listed, never
 * edited: the secret guard is always on.
 */
export function ManagedPolicies({ entries }: { entries: unknown }) {
  const managed = readManagedPolicies(entries)
  if (managed.length === 0) return null
  return (
    <section aria-label="Managed by Phase" className="space-y-1.5">
      <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
        Managed by Phase
      </h4>
      <ul className="space-y-1.5">
        {managed.map((entry) => {
          const label = MANAGED_LABEL[entry.id] ?? {
            name: entry.id.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()),
            line: 'Always on and cannot be turned off.',
          }
          return (
            <li
              key={entry.id}
              data-managed-policy={entry.id}
              className="flex items-start gap-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 px-3 py-2"
            >
              <FaLock aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-neutral-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{label.name}</p>
                <p className="text-xs font-normal text-neutral-500">{label.line}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * The rules of one Connection: an effect per class of call, a default for the rest, and
 * method/path rules under Advanced.
 */
export function PolicyEditor({
  draft,
  onChange,
  allowOperations = false,
  variant = 'http',
}: {
  draft: PolicyDraft
  onChange: (draft: PolicyDraft) => void
  /** Offer rules by AWS action; only an AWS Connection takes them. */
  allowOperations?: boolean
  variant?: PolicyVariant
}) {
  const app = variant === 'app'
  const id = useId()
  const [advancedOpen, setAdvancedOpen] = useState(
    draft.advanced.length > 0 || draft.operations.length > 0
  )
  const problem = policyProblem(draft)
  const advancedCount = draft.advanced.length + (allowOperations ? draft.operations.length : 0)
  const setRule = (rule: AdvancedRuleDraft, patch: Partial<AdvancedRuleDraft>) =>
    onChange({
      ...draft,
      advanced: draft.advanced.map((candidate) =>
        candidate.id === rule.id ? { ...candidate, ...patch } : candidate
      ),
    })
  const setOperation = (rule: OperationRuleDraft, patch: Partial<OperationRuleDraft>) =>
    onChange({
      ...draft,
      operations: draft.operations.map((candidate) =>
        candidate.id === rule.id ? { ...candidate, ...patch } : candidate
      ),
    })
  const ruleCount = draft.advanced.length + draft.operations.length
  return (
    <div className="space-y-4">
      <section aria-label="Access rules" className="space-y-2">
        <ul className="divide-y divide-neutral-500/10 rounded-lg border border-neutral-500/20">
          {(app ? APP_CLASSES : OPERATION_CLASSES).map((name) => (
            <li key={name} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">{CLASS_LABEL[name].name}</p>
                <p className="text-2xs text-neutral-500">
                  {app
                    ? APP_CLASS_HINT[name as keyof typeof APP_CLASS_HINT]
                    : CLASS_LABEL[name].hint}
                </p>
              </div>
              <ChoiceGroup
                label={`${CLASS_LABEL[name].name} calls`}
                value={draft.classes[name]}
                options={EFFECT_OPTIONS}
                onChange={(effect) =>
                  onChange({ ...draft, classes: { ...draft.classes, [name]: effect } })
                }
              />
            </li>
          ))}
          {/* Every secrets call is one of the four classes, so nothing else is left. */}
          {!app && (
            <li className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">Everything else</p>
                <p className="text-2xs text-neutral-500">Any call no row above covers</p>
              </div>
              <ChoiceGroup
                label="Everything else"
                value={draft.default}
                options={EFFECT_OPTIONS}
                onChange={(effect) => onChange(withDefault(draft, effect))}
              />
            </li>
          )}
        </ul>
        <p className="text-xs text-neutral-500">
          Ask refuses the call and lets the Agent file a Change Request for it. Block refuses it
          outright.{!app && ' When several rules match, the strictest wins.'}
        </p>
      </section>

      {!app && (
        <section aria-label="Advanced" className="space-y-3">
          <Button
            type="button"
            variant="ghost"
            icon={advancedOpen ? FaChevronDown : FaChevronRight}
            aria-expanded={advancedOpen}
            aria-controls={`${id}-advanced`}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {allowOperations
              ? 'Advanced: rules by method, path and AWS action'
              : 'Advanced: rules by method and path'}
            {advancedCount > 0 && ` (${advancedCount})`}
          </Button>
          {advancedOpen && (
            <div id={`${id}-advanced`} className="space-y-3">
              {allowOperations && (
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
                  Rules by method and path
                </h4>
              )}
              {draft.advanced.length === 0 && (
                <p className="text-xs text-neutral-500">
                  No rules by method and path. Add one to cover a call the classes above do not,
                  such as <code>POST /v1/charges/*</code>.
                </p>
              )}
              {draft.advanced.map((rule, index) => (
                <div
                  key={rule.id}
                  className="space-y-2 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <MethodToggles
                      label={`Methods for rule ${index + 1}`}
                      methods={rule.methods}
                      onChange={(methods) => setRule(rule, { methods })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      icon={FaTrashAlt}
                      title={`Remove rule ${index + 1}`}
                      aria-label={`Remove rule ${index + 1}`}
                      onClick={() =>
                        onChange({
                          ...draft,
                          advanced: draft.advanced.filter((candidate) => candidate.id !== rule.id),
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-48 flex-1">
                      <Input
                        id={`${id}-path-${rule.id}`}
                        aria-label={`Path for rule ${index + 1}`}
                        value={rule.path}
                        setValue={(path) => setRule(rule, { path })}
                        placeholder="/v1/charges/*"
                        maxLength={POLICY_LIMITS.path}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <ChoiceGroup
                      label={`Effect for rule ${index + 1}`}
                      value={rule.effect}
                      options={EFFECT_OPTIONS}
                      onChange={(effect) => setRule(rule, { effect })}
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                icon={FaPlus}
                disabled={ruleCount >= POLICY_LIMITS.rules}
                onClick={() =>
                  onChange({ ...draft, advanced: [...draft.advanced, newAdvancedRule()] })
                }
              >
                Add rule
              </Button>

              {allowOperations && (
                <div className="space-y-3 border-t border-neutral-500/10 pt-3">
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
                    Rules by AWS action
                  </h4>
                  {draft.operations.length === 0 && (
                    <p className="text-xs text-neutral-500">
                      No rules by AWS action. Name one exact action, such as{' '}
                      <code>ec2:TerminateInstances</code>, to set it apart from the classes above.
                    </p>
                  )}
                  {draft.operations.map((rule, index) => (
                    <div
                      key={rule.id}
                      className="space-y-2 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-48 flex-1">
                          <Input
                            id={`${id}-action-${rule.id}`}
                            aria-label={`AWS action for rule ${index + 1}`}
                            value={rule.action}
                            setValue={(action) => setOperation(rule, { action })}
                            placeholder="ec2:TerminateInstances"
                            maxLength={POLICY_LIMITS.operation}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          icon={FaTrashAlt}
                          title={`Remove AWS action rule ${index + 1}`}
                          aria-label={`Remove AWS action rule ${index + 1}`}
                          onClick={() =>
                            onChange({
                              ...draft,
                              operations: draft.operations.filter(
                                (candidate) => candidate.id !== rule.id
                              ),
                            })
                          }
                        />
                      </div>
                      <ChoiceGroup
                        label={`Effect for AWS action rule ${index + 1}`}
                        value={rule.effect}
                        options={EFFECT_OPTIONS}
                        onChange={(effect) => setOperation(rule, { effect })}
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    icon={FaPlus}
                    disabled={ruleCount >= POLICY_LIMITS.rules}
                    onClick={() =>
                      onChange({ ...draft, operations: [...draft.operations, newOperationRule()] })
                    }
                  >
                    Add AWS action rule
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {problem && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  )
}

/** A compact summary of a Connection's rules for its row; nothing when it allows everything. */
export function PolicySummary({ policy }: { policy: unknown }) {
  const summary = policySummary(policy)
  if (!summary) return null
  return (
    <span
      title="Access rules restrict what Workflows can do with this Connection"
      className="whitespace-nowrap text-2xs font-medium text-amber-700 dark:text-amber-400"
    >
      {summary}
    </span>
  )
}

/** The Connection's own rules, read-only and compact: one line for each thing that is set. */
export function PolicyReadOnly({
  policy,
  variant = 'http',
}: {
  policy: unknown
  variant?: PolicyVariant
}) {
  const overview = policyOverview(policy)
  const app = variant === 'app'
  const classes = app
    ? overview.classes.filter((item) =>
        APP_CLASSES.some((name) => CLASS_LABEL[name].name === item.name)
      )
    : overview.classes
  return (
    <ul aria-label="Access rules in force" className="space-y-1 text-xs font-medium">
      {classes.map((item) => (
        <li key={item.name} className="flex items-center justify-between gap-3">
          <span>{item.name}</span>
          <span className={EFFECT_TEXT[item.effect]}>{EFFECT_LABEL[item.effect]}</span>
        </li>
      ))}
      {!app && (
        <li className="flex items-center justify-between gap-3">
          <span>Everything else</span>
          <span className={EFFECT_TEXT[overview.default]}>{EFFECT_LABEL[overview.default]}</span>
        </li>
      )}
      {(app ? [] : overview.rules).map((rule, index) => (
        <li key={`${rule.label}-${index}`} className="flex items-center justify-between gap-3">
          <code className="min-w-0 break-all font-normal">{rule.label}</code>
          <span className={clsx('shrink-0', EFFECT_TEXT[rule.effect])}>
            {EFFECT_LABEL[rule.effect]}
          </span>
        </li>
      ))}
    </ul>
  )
}

export type PolicyConnection = {
  id: string
  name: string
  serviceType: string
  policy?: unknown
}

/** "Edit" on a Connection's access rules: opens the editor and saves it. */
export function EditConnectionPolicyDialog({ connection }: { connection: PolicyConnection }) {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const initial = useRef<PolicyDraft>(draftFromPolicy(connection.policy))
  const [draft, setDraft] = useState<PolicyDraft>(initial.current)
  const [failure, setFailure] = useState('')
  const [save, { loading }] = useMutation(SetAgentConnectionPolicyOp)
  const problem = policyProblem(draft)
  const changed = !samePolicy(draft, initial.current)
  const variant: PolicyVariant = isAppConnection(connection.serviceType) ? 'app' : 'http'

  const begin = () => {
    initial.current = draftFromPolicy(connection.policy)
    setDraft(initial.current)
    setFailure('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (problem || !changed) return
    try {
      await save({
        // Null clears the rules: a policy that allows everything is stored as none.
        variables: { connectionId: connection.id, policy: policyPayload(draft) },
        refetchQueries: ['GetAgentAssets', 'GetAgentDetail'],
        awaitRefetchQueries: true,
      })
      toast.success('Access rules saved')
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not save the access rules')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Access rules for ${connection.name}`}
      size="md"
      buttonVariant="ghost"
      buttonContent="Edit"
      buttonProps={{ icon: FaEdit, title: 'Edit access rules' }}
      onOpen={begin}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <p className="text-xs text-neutral-500">
          These rules apply to every Workflow granted <strong>{connection.name}</strong>. They can
          narrow what the Connection allows, never widen it.
        </p>
        <PolicyEditor
          draft={draft}
          onChange={setDraft}
          allowOperations={takesOperations(connection.serviceType)}
          variant={variant}
        />
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
            Save rules
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

/**
 * What a Connection's details show for access: what Phase always applies,
 * then the member's own rules. Connections that take no rules show neither.
 */
export function ConnectionPolicyBlocks({
  connection,
  canEdit,
}: {
  connection: PolicyConnection & { takesPolicy?: boolean; managedPolicies?: unknown }
  canEdit: boolean
}) {
  if (!connection.takesPolicy) return null
  // The Console enforces an app Connection's rules itself: Phase manages none there.
  const app = isAppConnection(connection.serviceType)
  return (
    <div className="space-y-4">
      {!app && <ManagedPolicies entries={connection.managedPolicies} />}
      <section aria-label="Access rules" className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
            Access rules
          </h4>
          {canEdit && <EditConnectionPolicyDialog connection={connection} />}
        </div>
        <PolicyReadOnly policy={connection.policy} variant={app ? 'app' : 'http'} />
      </section>
    </div>
  )
}
