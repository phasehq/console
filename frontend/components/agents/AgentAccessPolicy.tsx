'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import clsx from 'clsx'
import { FaCheck, FaEdit, FaLock, FaPlus, FaTrashAlt } from 'react-icons/fa'
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
  describeMatch,
  draftFromPolicy,
  newAdvancedRule,
  policyPayload,
  policyProblem,
  policyRestricts,
  readManagedPolicies,
  rowEffect,
  ruleRows,
  ruleTakesEffect,
  rulesInForce,
  rulesSaveTurnsOff,
  samePolicy,
  savedRuleCount,
  type AdvancedRuleDraft,
  type ManagedPolicy,
  type OperationClass,
  type PolicyDraft,
  type PolicyEffect,
  type RowChoice,
} from '@/utils/agents/accessPolicy'
import { APP_CLASS_HINT, isAppConnection, listWords, policySummary } from '@/utils/agents/appAccess'

/** `app`: an app Connection, whose four classes are the secrets API's and which takes no HTTP rules. */
export type PolicyVariant = 'http' | 'app'

const EFFECT_STYLE: Record<PolicyEffect, string> = {
  allow: 'bg-emerald-600 text-white dark:bg-emerald-400/20 dark:text-emerald-300',
  ask: 'bg-amber-600 text-white dark:bg-amber-400/20 dark:text-amber-300',
  block: 'bg-red-600 text-white dark:bg-red-400/20 dark:text-red-300',
}

// A row on Default shows the Default's effect in its colour, lighter than an effect of its own.
const FOLLOWING_STYLE: Record<PolicyEffect, string> = {
  allow: 'bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-400',
  ask: 'bg-amber-500/15 text-amber-800 dark:bg-amber-400/10 dark:text-amber-400',
  block: 'bg-red-500/15 text-red-800 dark:bg-red-400/10 dark:text-red-400',
}

const EFFECT_OPTIONS = EFFECTS.map((effect) => ({
  value: effect,
  label: EFFECT_LABEL[effect],
  selectedClass: EFFECT_STYLE[effect],
}))

/**
 * An HTTP rule's effects: Ask and Block, since the stricter of rule and row wins and Allow
 * would change nothing. A stored Allow rule still shows it. A rule that changes nothing
 * does not show its effect in colour.
 */
const ruleOptions = (rule: AdvancedRuleDraft, inert: boolean) =>
  EFFECT_OPTIONS.filter((option) => option.value !== 'allow' || rule.effect === 'allow').map(
    (option) =>
      inert
        ? { ...option, selectedClass: 'bg-neutral-500/20 text-neutral-700 dark:text-neutral-300' }
        : option
  )

/** A row's choices: Default, with the effect it gives the row now, then an effect of its own. */
const rowOptions = (fallback: PolicyEffect) => [
  {
    value: 'default' as RowChoice,
    label: `Default · ${EFFECT_LABEL[fallback]}`,
    selectedClass: FOLLOWING_STYLE[fallback],
  },
  ...EFFECT_OPTIONS,
]

const EFFECT_TEXT: Record<PolicyEffect, string> = {
  allow: 'text-emerald-700 dark:text-emerald-400',
  ask: 'text-amber-700 dark:text-amber-400',
  block: 'text-red-700 dark:text-red-400',
}

/** What a row covers: HTTP methods, or on an app Connection what it does with secrets. */
const rowHint = (name: OperationClass, app: boolean) =>
  app ? APP_CLASS_HINT[name] : CLASS_LABEL[name].hint

/** Why an HTTP rule changes nothing, or '' when it can change an answer. */
const noEffectLine = (draft: PolicyDraft, rule: AdvancedRuleDraft): string => {
  if (ruleTakesEffect(draft, rule)) return ''
  if (rule.effect === 'allow')
    return 'No effect: a rule can only make calls stricter. Choose Ask or Block, or remove it.'
  const rows = ruleRows(rule)
  const effects = EFFECTS.filter((effect) => rows.some((name) => rowEffect(draft, name) === effect))
  return `No effect: ${listWords(rows.map((name) => CLASS_LABEL[name].name))} ${
    rows.length === 1 ? 'is' : 'are'
  } already ${effects.map((effect) => EFFECT_LABEL[effect]).join(' or ')}.`
}

const MANAGED_NAME: Record<string, string> = { secret_guard: 'Secret guard' }

const ALWAYS_ON = 'Always on and cannot be turned off.'

// Said only when the server lists that rule for this Connection: not every provider has one.
const managedLine = (entry: ManagedPolicy) =>
  entry.rules.some((rule) => rule.class === 'credential_minting' && rule.effect === 'block')
    ? 'Blocks calls that mint new credentials or assume another identity. It is always on and cannot be turned off.'
    : ALWAYS_ON

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
          const label = {
            name:
              MANAGED_NAME[entry.id] ??
              entry.id.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()),
            line: managedLine(entry),
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
 * The rules of one Connection: a Default, a row per class of call that follows it until set,
 * and rules by method and path.
 */
export function PolicyEditor({
  draft,
  onChange,
  variant = 'http',
  stored,
}: {
  draft: PolicyDraft
  onChange: (draft: PolicyDraft) => void
  variant?: PolicyVariant
  /** The policy as saved, to tell which rules are in force now. */
  stored?: unknown
}) {
  const app = variant === 'app'
  const id = useId()
  const problem = policyProblem(draft)
  const turnedOff = stored === undefined ? new Set<string>() : rulesSaveTurnsOff(stored, draft)
  const setRule = (rule: AdvancedRuleDraft, patch: Partial<AdvancedRuleDraft>) =>
    onChange({
      ...draft,
      advanced: draft.advanced.map((candidate) =>
        candidate.id === rule.id ? { ...candidate, ...patch } : candidate
      ),
    })
  return (
    <div className="space-y-5">
      <section aria-label="Access rules" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3">
          <div className="min-w-0">
            <p className="text-xs font-medium">Default</p>
            <p className="text-2xs text-neutral-500">Rows set to Default follow this.</p>
          </div>
          <ChoiceGroup
            label="Default"
            value={draft.default}
            options={EFFECT_OPTIONS}
            onChange={(effect) => onChange({ ...draft, default: effect })}
          />
        </div>
        <ul className="divide-y divide-neutral-500/10 rounded-lg border border-neutral-500/20">
          {OPERATION_CLASSES.map((name) => (
            <li
              key={name}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium">{CLASS_LABEL[name].name}</p>
                <p className="text-2xs text-neutral-500">{rowHint(name, app)}</p>
              </div>
              <ChoiceGroup<RowChoice>
                label={`${CLASS_LABEL[name].name} calls`}
                value={draft.classes[name]}
                options={rowOptions(draft.default)}
                onChange={(choice) =>
                  onChange({ ...draft, classes: { ...draft.classes, [name]: choice } })
                }
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-500">
          Ask refuses the call and lets the Agent file a Change Request for it. Block refuses it
          outright.
        </p>
      </section>

      {!app && (
        <section aria-label="HTTP rules" className="space-y-3">
          <div className="space-y-1">
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
              HTTP rules
            </h4>
            <p className="text-xs text-neutral-500">
              A call that matches a rule gets the stricter of the rule and its row.
            </p>
          </div>
          {draft.advanced.map((rule, index) => {
            // A rule the stored policy gives effect to is shown as in force, with what saving does.
            const inForce = turnedOff.has(rule.id)
            const inert = inForce ? '' : noEffectLine(draft, rule)
            const note = inForce
              ? 'In force now, but saving the rules turns it off: a rule can only make calls stricter.'
              : inert
            return (
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
                      placeholder="/v1/items/*"
                      maxLength={POLICY_LIMITS.path}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <ChoiceGroup
                    label={`Effect for rule ${index + 1}`}
                    value={rule.effect}
                    options={ruleOptions(rule, !!inert)}
                    onChange={(effect) => setRule(rule, { effect })}
                  />
                </div>
                {note && <p className="text-2xs text-neutral-500">{note}</p>}
              </div>
            )
          })}
          <Button
            type="button"
            variant="secondary"
            icon={FaPlus}
            disabled={savedRuleCount(draft) >= POLICY_LIMITS.rules}
            onClick={() => onChange({ ...draft, advanced: [...draft.advanced, newAdvancedRule()] })}
          >
            Add HTTP rule
          </Button>
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

/** A Connection's rules in a few words for its row; nothing when they stop no call. */
export function PolicySummary({ policy }: { policy: unknown }) {
  if (!policyRestricts(policy)) return null
  return (
    <span
      title="Access rules restrict what Workflows can do with this Connection"
      className="whitespace-nowrap text-2xs font-medium text-amber-700 dark:text-amber-400"
    >
      {policySummary(policy)}
    </span>
  )
}

/** The Connection's own rules, read-only and compact: the Default, each row, then each HTTP rule. */
export function PolicyReadOnly({
  policy,
  variant = 'http',
}: {
  policy: unknown
  variant?: PolicyVariant
}) {
  const draft = draftFromPolicy(policy)
  // As the proxy reads the stored rules, which a policy written elsewhere may not match.
  const inForce = rulesInForce(policy)
  const app = variant === 'app'
  return (
    <ul aria-label="Access rules in force" className="space-y-1 text-xs font-medium">
      <li className="flex items-center justify-between gap-3">
        <span>Default</span>
        <span className={EFFECT_TEXT[draft.default]}>{EFFECT_LABEL[draft.default]}</span>
      </li>
      {OPERATION_CLASSES.map((name) => {
        const effect = rowEffect(draft, name)
        return (
          <li key={name} className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              {CLASS_LABEL[name].name}{' '}
              <span className="font-normal text-neutral-500">{rowHint(name, app)}</span>
            </span>
            <span className={clsx('shrink-0', EFFECT_TEXT[effect])}>
              {draft.classes[name] === 'default'
                ? `Default · ${EFFECT_LABEL[effect]}`
                : EFFECT_LABEL[effect]}
            </span>
          </li>
        )
      })}
      {(app ? [] : draft.advanced).map((rule, index) => {
        const inert = !inForce[index]
        return (
          <li key={rule.id} className="flex items-center justify-between gap-3">
            <code className="min-w-0 break-all font-normal">
              {describeMatch({
                methods: rule.methods.length > 0 ? rule.methods : undefined,
                path: rule.path || undefined,
              })}
            </code>
            <span
              className={clsx(
                'shrink-0',
                inert ? 'font-normal text-neutral-500' : EFFECT_TEXT[rule.effect]
              )}
            >
              {EFFECT_LABEL[rule.effect]}
              {inert && ' · No effect'}
            </span>
          </li>
        )
      })}
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
  const opened = useRef<unknown>(connection.policy)
  const [draft, setDraft] = useState<PolicyDraft>(initial.current)
  const [failure, setFailure] = useState('')
  const [save, { loading }] = useMutation(SetAgentConnectionPolicyOp)
  const problem = policyProblem(draft)
  const changed = !samePolicy(draft, initial.current)
  const variant: PolicyVariant = isAppConnection(connection.serviceType) ? 'app' : 'http'

  const begin = () => {
    opened.current = connection.policy
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
        <PolicyEditor draft={draft} onChange={setDraft} variant={variant} stored={opened.current} />
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
