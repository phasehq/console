/**
 * Access policies on a Connection, and temporary allows on a Workflow's grant.
 * The backend validator is the authority; `credential_minting` is never edited here.
 */

export const POLICY_VERSION = 1

export const EFFECTS = ['allow', 'ask', 'block'] as const
export type PolicyEffect = (typeof EFFECTS)[number]

export const OPERATION_CLASSES = ['read', 'create', 'update', 'delete', 'admin'] as const
export type OperationClass = (typeof OPERATION_CLASSES)[number]

export const HTTP_METHODS = [
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'CONNECT',
  'TRACE',
] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** An AWS action is `<service>:<Action>`, written out in full: no wildcards. */
export const AWS_ACTION_FORMAT = /^[a-z0-9-]{1,64}:[A-Za-z0-9]{1,128}$/

/** 64 + ":" + 128. */
export const POLICY_LIMITS = { rules: 50, path: 1024, operation: 193 } as const

/** Only AWS Connections take rules or allows by AWS action. */
export const takesOperations = (serviceType?: string | null): boolean =>
  serviceType?.toLowerCase() === 'aws'

export const EFFECT_LABEL: Record<PolicyEffect, string> = {
  allow: 'Allow',
  ask: 'Ask',
  block: 'Block',
}

export const CLASS_LABEL: Record<OperationClass, { name: string; hint: string }> = {
  read: { name: 'Read', hint: 'Fetch or list, changes nothing' },
  create: { name: 'Create', hint: 'Add something new' },
  update: { name: 'Update', hint: 'Change something that exists' },
  delete: { name: 'Delete', hint: 'Remove something' },
  admin: { name: 'Admin', hint: 'Permissions, accounts and other account-level changes' },
}

export type PolicyMatch = { methods?: string[]; path?: string }
export type PolicyRule =
  | { class: OperationClass; effect: PolicyEffect }
  | { match: PolicyMatch; effect: PolicyEffect }
  | { operation: string; effect: PolicyEffect }
export type AccessPolicy = {
  version: number
  default: PolicyEffect
  rules: PolicyRule[]
}

export type TemporaryAllow = {
  id: string
  class?: OperationClass
  match?: PolicyMatch
  /** An AWS action such as `ec2:TerminateInstances`. */
  operation?: string
  expiresAt: string
  requestId?: string | null
}

export type ManagedPolicy = {
  id: string
  locked: boolean
  rules: Array<{ class: string; effect: string }>
}

/** The always-on entries the server lists, ignoring anything not shaped like one. */
export const readManagedPolicies = (value: unknown): ManagedPolicy[] => {
  if (!Array.isArray(value)) return []
  const entries: ManagedPolicy[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== 'string') continue
    entries.push({
      id: raw.id,
      locked: raw.locked === true,
      rules: Array.isArray(raw.rules)
        ? raw.rules.flatMap((rule) =>
            isRecord(rule) && typeof rule.class === 'string' && typeof rule.effect === 'string'
              ? [{ class: rule.class, effect: rule.effect }]
              : []
          )
        : [],
    })
  }
  return entries
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isEffect = (value: unknown): value is PolicyEffect =>
  typeof value === 'string' && (EFFECTS as readonly string[]).includes(value)
const isClass = (value: unknown): value is OperationClass =>
  typeof value === 'string' && (OPERATION_CLASSES as readonly string[]).includes(value)

const readOperation = (value: unknown): string | null =>
  typeof value === 'string' && AWS_ACTION_FORMAT.test(value) ? value : null

const readMatch = (value: unknown): PolicyMatch | null => {
  if (!isRecord(value)) return null
  const match: PolicyMatch = {}
  if (Array.isArray(value.methods)) {
    const methods = value.methods.filter((method): method is string => typeof method === 'string')
    if (methods.length > 0) match.methods = methods
  }
  if (typeof value.path === 'string' && value.path) match.path = value.path
  return match.methods || match.path ? match : null
}

/** Read a policy that arrived as untyped JSON. Anything unreadable is the default policy. */
export const readPolicy = (value: unknown): AccessPolicy => {
  const policy: AccessPolicy = { version: POLICY_VERSION, default: 'allow', rules: [] }
  if (!isRecord(value)) return policy
  if (isEffect(value.default)) policy.default = value.default
  if (Array.isArray(value.rules)) {
    for (const raw of value.rules) {
      if (!isRecord(raw) || !isEffect(raw.effect)) continue
      if (isClass(raw.class)) policy.rules.push({ class: raw.class, effect: raw.effect })
      else if (raw.operation !== undefined) {
        const operation = readOperation(raw.operation)
        if (operation) policy.rules.push({ operation, effect: raw.effect })
      } else {
        const match = readMatch(raw.match)
        if (match) policy.rules.push({ match, effect: raw.effect })
      }
    }
  }
  return policy
}

/** The temporary allows a grant carries that are still in force, soonest first. */
export const readTemporaryAllows = (value: unknown, now = Date.now()): TemporaryAllow[] => {
  if (!Array.isArray(value)) return []
  const allows: TemporaryAllow[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.expiresAt !== 'string') continue
    const expires = Date.parse(raw.expiresAt)
    if (Number.isNaN(expires) || expires <= now) continue
    const allow: TemporaryAllow = {
      id: raw.id,
      expiresAt: raw.expiresAt,
      requestId: typeof raw.requestId === 'string' ? raw.requestId : null,
    }
    if (isClass(raw.class)) allow.class = raw.class
    else if (raw.operation !== undefined) {
      const operation = readOperation(raw.operation)
      if (!operation) continue
      allow.operation = operation
    } else {
      const match = readMatch(raw.match)
      if (!match) continue
      allow.match = match
    }
    allows.push(allow)
  }
  return allows.sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
}

/** `POST, PUT /v1/x/*`, the way a method-and-path match is written. */
export const describeMatch = (match: PolicyMatch): string =>
  [match.methods?.join(', '), match.path].filter(Boolean).join(' ')

/** `AWS action ec2:TerminateInstances`. */
export const describeOperation = (operation: string): string => `AWS action ${operation}`

/** What a rule or an allow covers, in words. */
export const describeTarget = (target: {
  class?: OperationClass
  match?: PolicyMatch
  operation?: string
}): string =>
  target.operation
    ? describeOperation(target.operation)
    : target.class
      ? `${CLASS_LABEL[target.class].name} calls`
      : describeMatch(target.match ?? {})

// --- The editor's draft --------------------------------------------------

export type AdvancedRuleDraft = {
  id: string
  methods: string[]
  path: string
  effect: PolicyEffect
}

export type OperationRuleDraft = {
  id: string
  action: string
  effect: PolicyEffect
}

export type PolicyDraft = {
  default: PolicyEffect
  classes: Record<OperationClass, PolicyEffect>
  advanced: AdvancedRuleDraft[]
  /** Rules by AWS action; only an AWS Connection has any. */
  operations: OperationRuleDraft[]
}

let nextRule = 0
export const newAdvancedRule = (): AdvancedRuleDraft => {
  nextRule += 1
  return { id: `rule-${nextRule}`, methods: [], path: '', effect: 'block' }
}

export const newOperationRule = (): OperationRuleDraft => {
  nextRule += 1
  return { id: `operation-${nextRule}`, action: '', effect: 'block' }
}

const STRENGTH: Record<PolicyEffect, number> = { allow: 0, ask: 1, block: 2 }
const strongest = (left: PolicyEffect, right: PolicyEffect) =>
  STRENGTH[right] > STRENGTH[left] ? right : left

/**
 * A policy as the editor shows it. Several rules for one class mean the strongest, as the proxy reads them.
 * Rules the editor cannot express, such as `credential_minting`, are left out.
 */
export const draftFromPolicy = (value: unknown): PolicyDraft => {
  const policy = readPolicy(value)
  const classes = Object.fromEntries(
    OPERATION_CLASSES.map((name) => [name, policy.default])
  ) as Record<OperationClass, PolicyEffect>
  const seen = new Set<OperationClass>()
  const advanced: AdvancedRuleDraft[] = []
  const operations: OperationRuleDraft[] = []
  for (const rule of policy.rules) {
    if ('operation' in rule) {
      operations.push({ id: newOperationRule().id, action: rule.operation, effect: rule.effect })
    } else if ('class' in rule) {
      classes[rule.class] = seen.has(rule.class)
        ? strongest(classes[rule.class], rule.effect)
        : rule.effect
      seen.add(rule.class)
    } else {
      advanced.push({
        id: newAdvancedRule().id,
        methods: [...(rule.match.methods ?? [])],
        path: rule.match.path ?? '',
        effect: rule.effect,
      })
    }
  }
  return { default: policy.default, classes, advanced, operations }
}

/**
 * "Everything else" changed: rows that were following it keep following it.
 */
export const withDefault = (draft: PolicyDraft, effect: PolicyEffect): PolicyDraft => ({
  ...draft,
  default: effect,
  classes: Object.fromEntries(
    OPERATION_CLASSES.map((name) => [
      name,
      draft.classes[name] === draft.default ? effect : draft.classes[name],
    ])
  ) as Record<OperationClass, PolicyEffect>,
})

/** The advanced rule as the backend stores it, or null while it is incomplete. */
const advancedRule = (rule: AdvancedRuleDraft): PolicyRule | null => {
  const match: PolicyMatch = {}
  const methods = HTTP_METHODS.filter((method) => rule.methods.includes(method))
  if (methods.length > 0) match.methods = methods
  const path = rule.path.trim()
  if (path) match.path = path
  return match.methods || match.path ? { match, effect: rule.effect } : null
}

/**
 * The class rows that need a rule. A row equal to "Everything else" still needs one
 * when a path or action rule is weaker: the proxy applies the strongest matching
 * rule, so without it that weaker rule would decide the class's calls.
 */
const classRuleNames = (draft: PolicyDraft): OperationClass[] => {
  const weakest = [...draft.advanced, ...draft.operations].reduce<number | null>(
    (lowest, rule) =>
      lowest === null ? STRENGTH[rule.effect] : Math.min(lowest, STRENGTH[rule.effect]),
    null
  )
  return OPERATION_CLASSES.filter(
    (name) =>
      draft.classes[name] !== draft.default ||
      (weakest !== null && weakest < STRENGTH[draft.classes[name]])
  )
}

/** The policy a draft stands for, or null when it is the default: allow, no rules. */
export const policyFromDraft = (draft: PolicyDraft): AccessPolicy | null => {
  const rules: PolicyRule[] = []
  for (const name of classRuleNames(draft)) rules.push({ class: name, effect: draft.classes[name] })
  for (const rule of draft.advanced) {
    const built = advancedRule(rule)
    if (built) rules.push(built)
  }
  for (const rule of draft.operations) {
    const action = rule.action.trim()
    if (action) rules.push({ operation: action, effect: rule.effect })
  }
  if (draft.default === 'allow' && rules.length === 0) return null
  return { version: POLICY_VERSION, default: draft.default, rules }
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/

/** Why the draft cannot be saved, or ''. */
export const policyProblem = (draft: PolicyDraft): string => {
  const classRules = classRuleNames(draft)
  if (classRules.length + draft.advanced.length + draft.operations.length > POLICY_LIMITS.rules)
    return `Use at most ${POLICY_LIMITS.rules} rules.`
  for (const [index, rule] of draft.advanced.entries()) {
    const position = `Rule ${index + 1}`
    const path = rule.path.trim()
    if (rule.methods.length === 0 && !path) return `${position}: choose a method or enter a path.`
    if (path) {
      if (!path.startsWith('/')) return `${position}: a path begins with "/".`
      if (path.length > POLICY_LIMITS.path)
        return `${position}: use at most ${POLICY_LIMITS.path} characters in a path.`
      if (CONTROL_CHARACTER.test(path)) return `${position}: the path has a control character.`
    }
  }
  for (const [index, rule] of draft.operations.entries()) {
    const position = `AWS action rule ${index + 1}`
    const action = rule.action.trim()
    if (!action) return `${position}: enter an AWS action such as ec2:TerminateInstances.`
    if (!AWS_ACTION_FORMAT.test(action))
      return `${position}: write one exact action as service:Action, with no wildcards.`
  }
  return ''
}

/** Whether two drafts mean the same policy. */
export const samePolicy = (left: PolicyDraft, right: PolicyDraft): boolean =>
  JSON.stringify(policyFromDraft(left)) === JSON.stringify(policyFromDraft(right))

/** What the mutation sends: the policy, or null to clear it. */
export const policyPayload = (draft: PolicyDraft): AccessPolicy | null => policyFromDraft(draft)

/**
 * A short phrase for a Connection's row when the policy restricts anything, such as
 * "2 blocked, 1 ask"; '' for a policy that allows everything.
 */
export const policySummary = (value: unknown): string => {
  const policy = readPolicy(value)
  // A class rule equal to the default is counted by "the rest".
  const rules = policy.rules.filter((rule) => !('class' in rule) || rule.effect !== policy.default)
  const blocked = rules.filter((rule) => rule.effect === 'block').length
  const asked = rules.filter((rule) => rule.effect === 'ask').length
  const parts: string[] = []
  if (blocked > 0) parts.push(`${blocked} blocked`)
  if (asked > 0) parts.push(`${asked} ask`)
  if (policy.default === 'block') parts.push('the rest blocked')
  else if (policy.default === 'ask') parts.push('the rest ask')
  return parts.join(', ')
}

export type PolicyOverview = {
  /** What each class of call is set to, in the editor's order. */
  classes: Array<{ name: string; effect: PolicyEffect }>
  default: PolicyEffect
  /** Rules by method and path, then by AWS action. */
  rules: Array<{ label: string; effect: PolicyEffect }>
}

/** A policy laid out for reading, the way the editor shows it. */
export const policyOverview = (value: unknown): PolicyOverview => {
  const draft = draftFromPolicy(value)
  return {
    classes: OPERATION_CLASSES.map((name) => ({
      name: CLASS_LABEL[name].name,
      effect: draft.classes[name],
    })),
    default: draft.default,
    rules: [
      ...draft.advanced.map((rule) => ({
        label: describeMatch({
          methods: rule.methods.length > 0 ? rule.methods : undefined,
          path: rule.path || undefined,
        }),
        effect: rule.effect,
      })),
      ...draft.operations.map((rule) => ({
        label: describeOperation(rule.action),
        effect: rule.effect,
      })),
    ],
  }
}
