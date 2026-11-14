/**
 * Access policies on a Workflow's grant of a Connection.
 *
 * The backend validator (`api/utils/agent_config/access_policy.py`) is the
 * authority; the limits and rules here mirror it so the editor can say what
 * is wrong before a round trip. A policy only narrows what the Connection
 * allows. The secret guard is not part of any stored policy, so
 * `credential_minting` is never read into a draft and never written out.
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

export const POLICY_LIMITS = { rules: 50, path: 1024 } as const

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
export type AccessPolicy = {
  version: number
  default: PolicyEffect
  rules: PolicyRule[]
}

export type TemporaryAllow = {
  id: string
  class?: OperationClass
  match?: PolicyMatch
  expiresAt: string
  requestId?: string | null
}

export type ManagedPolicy = {
  id: string
  locked: boolean
  rules: Array<{ class: string; effect: string }>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isEffect = (value: unknown): value is PolicyEffect =>
  typeof value === 'string' && (EFFECTS as readonly string[]).includes(value)
const isClass = (value: unknown): value is OperationClass =>
  typeof value === 'string' && (OPERATION_CLASSES as readonly string[]).includes(value)

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
      else {
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
    else {
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

/** What a rule or an allow covers, in words. */
export const describeTarget = (target: { class?: OperationClass; match?: PolicyMatch }): string =>
  target.class ? `${CLASS_LABEL[target.class].name} calls` : describeMatch(target.match ?? {})

// --- The editor's draft --------------------------------------------------

export type AdvancedRuleDraft = {
  id: string
  methods: string[]
  path: string
  effect: PolicyEffect
}

export type PolicyDraft = {
  default: PolicyEffect
  classes: Record<OperationClass, PolicyEffect>
  advanced: AdvancedRuleDraft[]
}

let nextRule = 0
export const newAdvancedRule = (): AdvancedRuleDraft => {
  nextRule += 1
  return { id: `rule-${nextRule}`, methods: [], path: '', effect: 'block' }
}

const STRENGTH: Record<PolicyEffect, number> = { allow: 0, ask: 1, block: 2 }
const strongest = (left: PolicyEffect, right: PolicyEffect) =>
  STRENGTH[right] > STRENGTH[left] ? right : left

/**
 * A policy as the editor shows it. Class rules fill the class rows (several
 * for one class mean the strongest, which is how the proxy reads them); a
 * class with no rule follows "Everything else". Rules the editor cannot
 * express, such as `credential_minting`, are left out.
 */
export const draftFromPolicy = (value: unknown): PolicyDraft => {
  const policy = readPolicy(value)
  const classes = Object.fromEntries(
    OPERATION_CLASSES.map((name) => [name, policy.default])
  ) as Record<OperationClass, PolicyEffect>
  const seen = new Set<OperationClass>()
  const advanced: AdvancedRuleDraft[] = []
  for (const rule of policy.rules) {
    if ('class' in rule) {
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
  return { default: policy.default, classes, advanced }
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
 * The policy a draft stands for, or null when it is the default: allow, no
 * rules. A class row that equals "Everything else" needs no rule.
 */
export const policyFromDraft = (draft: PolicyDraft): AccessPolicy | null => {
  const rules: PolicyRule[] = []
  for (const name of OPERATION_CLASSES) {
    if (draft.classes[name] !== draft.default)
      rules.push({ class: name, effect: draft.classes[name] })
  }
  for (const rule of draft.advanced) {
    const built = advancedRule(rule)
    if (built) rules.push(built)
  }
  if (draft.default === 'allow' && rules.length === 0) return null
  return { version: POLICY_VERSION, default: draft.default, rules }
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/

/** Why the draft cannot be saved, or ''. */
export const policyProblem = (draft: PolicyDraft): string => {
  const classRules = OPERATION_CLASSES.filter((name) => draft.classes[name] !== draft.default)
  if (classRules.length + draft.advanced.length > POLICY_LIMITS.rules)
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
  return ''
}

/** Whether two drafts mean the same policy. */
export const samePolicy = (left: PolicyDraft, right: PolicyDraft): boolean =>
  JSON.stringify(policyFromDraft(left)) === JSON.stringify(policyFromDraft(right))

/** What the mutation sends: the policy, or null to clear it. */
export const policyPayload = (draft: PolicyDraft): AccessPolicy | null => policyFromDraft(draft)

/**
 * A short phrase for a grant row when the policy restricts anything, such as
 * "2 blocked, 1 ask"; '' for a policy that allows everything.
 */
export const policySummary = (value: unknown): string => {
  const policy = readPolicy(value)
  const blocked = policy.rules.filter((rule) => rule.effect === 'block').length
  const asked = policy.rules.filter((rule) => rule.effect === 'ask').length
  const parts: string[] = []
  if (blocked > 0) parts.push(`${blocked} blocked`)
  if (asked > 0) parts.push(`${asked} ask`)
  if (policy.default === 'block') parts.push('the rest blocked')
  else if (policy.default === 'ask') parts.push('the rest ask')
  return parts.join(', ')
}
