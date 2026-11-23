/**
 * Access policies on a Connection, and temporary allows on a Workflow's grant.
 * The backend validator is the authority; `credential_minting` is never edited here.
 */

export const POLICY_VERSION = 1

export const EFFECTS = ['allow', 'ask', 'block'] as const
export type PolicyEffect = (typeof EFFECTS)[number]

export const OPERATION_CLASSES = ['read', 'create', 'update', 'delete'] as const
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

/** Each class and the HTTP methods it covers. */
export const CLASS_LABEL: Record<OperationClass, { name: string; hint: string }> = {
  read: { name: 'Read', hint: 'GET, HEAD, OPTIONS' },
  create: { name: 'Create', hint: 'POST' },
  update: { name: 'Update', hint: 'PUT, PATCH and other methods' },
  delete: { name: 'Delete', hint: 'DELETE' },
}

// A call's class comes from its method alone; a method not named here is an update.
const METHOD_CLASS: Record<string, OperationClass> = {
  GET: 'read',
  HEAD: 'read',
  OPTIONS: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
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

/** A rule by method and path. */
export type AdvancedRuleDraft = {
  id: string
  methods: string[]
  path: string
  effect: PolicyEffect
}

/** A row's choice: an effect of its own, or `default` to follow the Default switch. */
export type RowChoice = PolicyEffect | 'default'

export type PolicyDraft = {
  default: PolicyEffect
  classes: Record<OperationClass, RowChoice>
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

/** The effect a row takes: its own, or the Default's. */
export const rowEffect = (draft: PolicyDraft, name: OperationClass): PolicyEffect => {
  const choice = draft.classes[name]
  return choice === 'default' ? draft.default : choice
}

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
 * Whether rows on Default need rules of their own: the proxy applies the strongest
 * matching rule, so an HTTP rule weaker than Default would otherwise decide their calls.
 */
const defaultNeedsRules = (draft: PolicyDraft): boolean =>
  draft.advanced.some(
    (rule) => advancedRule(rule) !== null && STRENGTH[rule.effect] < STRENGTH[draft.default]
  )

/** The rows that are saved as class rules: each one set, and every one when Default needs it. */
const classRuleNames = (draft: PolicyDraft): OperationClass[] => {
  const all = defaultNeedsRules(draft)
  return OPERATION_CLASSES.filter((name) => all || draft.classes[name] !== 'default')
}

/**
 * A policy as the editor shows it. A class rule sets its row; several for one class mean the
 * strongest, as the proxy reads them. Rules the editor cannot express, such as
 * `credential_minting`, are left out.
 */
export const draftFromPolicy = (value: unknown): PolicyDraft => {
  const policy = readPolicy(value)
  const classes = Object.fromEntries(OPERATION_CLASSES.map((name) => [name, 'default'])) as Record<
    OperationClass,
    RowChoice
  >
  const advanced: AdvancedRuleDraft[] = []
  for (const rule of policy.rules) {
    if ('class' in rule) {
      const choice = classes[rule.class]
      classes[rule.class] = choice === 'default' ? rule.effect : strongest(choice, rule.effect)
    } else {
      advanced.push({
        id: newAdvancedRule().id,
        methods: [...(rule.match.methods ?? [])],
        path: rule.match.path ?? '',
        effect: rule.effect,
      })
    }
  }
  const draft: PolicyDraft = { default: policy.default, classes, advanced }
  // Rows on Default were saved as rules equal to Default for a weaker HTTP rule: read them back so.
  if (defaultNeedsRules(draft))
    for (const name of OPERATION_CLASSES)
      if (classes[name] === policy.default) classes[name] = 'default'
  return draft
}

/** The policy a draft stands for, or null when it is the default: allow, no rules. */
export const policyFromDraft = (draft: PolicyDraft): AccessPolicy | null => {
  const rules: PolicyRule[] = classRuleNames(draft).map((name) => ({
    class: name,
    effect: rowEffect(draft, name),
  }))
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
  const classRules = classRuleNames(draft)
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

/** The rows an HTTP rule's methods fall under: all four when it names none. */
export const ruleRows = (rule: Pick<AdvancedRuleDraft, 'methods'>): OperationClass[] =>
  rule.methods.length === 0
    ? [...OPERATION_CLASSES]
    : OPERATION_CLASSES.filter((name) =>
        rule.methods.some((method) => (METHOD_CLASS[method] ?? 'update') === name)
      )

/**
 * Whether an HTTP rule can change any answer. A matching call gets the stricter of the
 * rule and its row, so a rule no stricter than each row it falls under changes nothing.
 */
export const ruleTakesEffect = (draft: PolicyDraft, rule: AdvancedRuleDraft): boolean =>
  ruleRows(rule).some((name) => STRENGTH[rule.effect] > STRENGTH[rowEffect(draft, name)])

/** Whether a policy stops or holds back any call: a row or an HTTP rule that is not Allow. */
export const policyRestricts = (value: unknown): boolean => {
  const draft = draftFromPolicy(value)
  return (
    OPERATION_CLASSES.some((name) => rowEffect(draft, name) !== 'allow') ||
    draft.advanced.some((rule) => rule.effect !== 'allow')
  )
}
