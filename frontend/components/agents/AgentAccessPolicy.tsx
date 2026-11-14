'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { FaCheck, FaChevronDown, FaChevronRight, FaLock, FaPlus, FaTrashAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { ChoiceGroup, MethodToggles } from '@/components/agents/AgentAccessControls'
import { SetAgentWorkflowGrantPolicyOp } from '@/graphql/mutations/agents/manageAgents.gql'
import { describeExpiry } from '@/utils/agents/accessDuration'
import {
  CLASS_LABEL,
  EFFECTS,
  EFFECT_LABEL,
  HTTP_METHODS,
  OPERATION_CLASSES,
  POLICY_LIMITS,
  draftFromPolicy,
  newAdvancedRule,
  policyPayload,
  policyProblem,
  policySummary,
  readTemporaryAllows,
  samePolicy,
  withDefault,
  describeTarget,
  type AdvancedRuleDraft,
  type PolicyDraft,
  type PolicyEffect,
  type TemporaryAllow,
} from '@/utils/agents/accessPolicy'

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

/** The always-on row: the secret guard cannot be turned off, so it is shown and nothing more. */
export function SecretGuardRow() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 px-3 py-2">
      <FaLock aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-neutral-500" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">Secret guard</p>
        <p className="text-xs text-neutral-500">
          Calls that mint new credentials or assume another role are always blocked. This cannot be
          turned off.
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-400">
        Block
      </span>
    </div>
  )
}

/** Temporary allows in force on a grant, read-only: they come from approved requests. */
export function TemporaryAllowList({ allows }: { allows: TemporaryAllow[] }) {
  if (allows.length === 0) return null
  return (
    <section aria-label="Temporary allows" className="space-y-1.5">
      <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
        Temporary allows
      </h4>
      <p className="text-xs text-neutral-500">
        Approved from Change Requests. They let a call through that an Ask rule would refuse, until
        they end. They never override a Block.
      </p>
      <ul className="divide-y divide-neutral-500/10 rounded-lg border border-neutral-500/20">
        {allows.map((allow) => (
          <li
            key={allow.id}
            className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
          >
            <code className="min-w-0 break-all">{describeTarget(allow)}</code>
            <time
              dateTime={allow.expiresAt}
              title={new Date(allow.expiresAt).toLocaleString()}
              className="shrink-0 text-neutral-500"
            >
              {describeExpiry(allow.expiresAt).replace('Ends', 'ends')}
            </time>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The rules of one grant: an effect for each class of call, one for
 * everything else, and rules by method and path under Advanced.
 */
export function PolicyEditor({
  draft,
  onChange,
  temporaryAllows = [],
}: {
  draft: PolicyDraft
  onChange: (draft: PolicyDraft) => void
  temporaryAllows?: TemporaryAllow[]
}) {
  const id = useId()
  const [advancedOpen, setAdvancedOpen] = useState(draft.advanced.length > 0)
  const problem = policyProblem(draft)
  const setRule = (rule: AdvancedRuleDraft, patch: Partial<AdvancedRuleDraft>) =>
    onChange({
      ...draft,
      advanced: draft.advanced.map((candidate) =>
        candidate.id === rule.id ? { ...candidate, ...patch } : candidate
      ),
    })
  return (
    <div className="space-y-4">
      <SecretGuardRow />

      <section aria-label="Access rules" className="space-y-2">
        <ul className="divide-y divide-neutral-500/10 rounded-lg border border-neutral-500/20">
          {OPERATION_CLASSES.map((name) => (
            <li key={name} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">{CLASS_LABEL[name].name}</p>
                <p className="text-2xs text-neutral-500">{CLASS_LABEL[name].hint}</p>
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
        </ul>
        <p className="text-xs text-neutral-500">
          Ask refuses the call and lets the Agent file a Change Request for it. Block refuses it
          outright. When several rules match, the strictest wins.
        </p>
      </section>

      <section aria-label="Advanced" className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          icon={advancedOpen ? FaChevronDown : FaChevronRight}
          aria-expanded={advancedOpen}
          aria-controls={`${id}-advanced`}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Advanced: rules by method and path
          {draft.advanced.length > 0 && ` (${draft.advanced.length})`}
        </Button>
        {advancedOpen && (
          <div id={`${id}-advanced`} className="space-y-3">
            {draft.advanced.length === 0 && (
              <p className="text-xs text-neutral-500">
                No rules by method and path. Add one to cover a call the classes above do not, such
                as <code>POST /v1/charges/*</code>.
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
              disabled={draft.advanced.length >= POLICY_LIMITS.rules}
              onClick={() =>
                onChange({ ...draft, advanced: [...draft.advanced, newAdvancedRule()] })
              }
            >
              Add rule
            </Button>
          </div>
        )}
      </section>

      <TemporaryAllowList allows={temporaryAllows} />

      {problem && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  )
}

/** A compact summary of a grant's rules for its row; nothing when it allows everything. */
export function PolicySummary({ policy }: { policy: unknown }) {
  const summary = policySummary(policy)
  if (!summary) return null
  return (
    <span
      title="Access rules restrict what this grant allows"
      className="text-2xs font-medium text-amber-700 dark:text-amber-400"
    >
      {summary}
    </span>
  )
}

export type PolicyGrant = {
  id: string
  policy?: unknown
  temporaryAllows?: unknown
  connection: { name: string }
}

/** "Access rules" on a grant row: opens the editor and saves it. */
export function GrantPolicyDialog({ grant }: { grant: PolicyGrant }) {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const initial = useRef<PolicyDraft>(draftFromPolicy(grant.policy))
  const [draft, setDraft] = useState<PolicyDraft>(initial.current)
  const [failure, setFailure] = useState('')
  const [save, { loading }] = useMutation(SetAgentWorkflowGrantPolicyOp)
  const problem = policyProblem(draft)
  const changed = !samePolicy(draft, initial.current)

  const begin = () => {
    initial.current = draftFromPolicy(grant.policy)
    setDraft(initial.current)
    setFailure('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (problem || !changed) return
    try {
      await save({
        variables: { grantId: grant.id, policy: policyPayload(draft) },
        refetchQueries: ['GetAgentDetail'],
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
      title={`Access rules for ${grant.connection.name}`}
      size="md"
      buttonVariant="ghost"
      buttonContent="Access rules"
      onOpen={begin}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <p className="text-xs text-neutral-500">
          Rules narrow what this Workflow may do with <strong>{grant.connection.name}</strong>. They
          can never allow more than the Connection itself does.
        </p>
        <PolicyEditor
          draft={draft}
          onChange={setDraft}
          temporaryAllows={readTemporaryAllows(grant.temporaryAllows)}
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
