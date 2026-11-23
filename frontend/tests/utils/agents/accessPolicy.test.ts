import {
  EFFECTS,
  HTTP_METHODS,
  OPERATION_CLASSES,
  describeTarget,
  draftFromPolicy,
  newAdvancedRule,
  readManagedPolicies,
  policyFromDraft,
  policyPayload,
  policyProblem,
  policyRestricts,
  COMMON_METHODS,
  methodEffects,
  pathProblem,
  rulesInForce,
  savedRuleCount,
  readPolicy,
  readTemporaryAllows,
  rowEffect,
  ruleRows,
  ruleTakesEffect,
  samePolicy,
  type AccessPolicy,
  type AdvancedRuleDraft,
  type OperationClass,
  type PolicyDraft,
  type PolicyEffect,
  type RowChoice,
} from '@/utils/agents/accessPolicy'

const everything = (draft: PolicyDraft) => JSON.stringify(policyFromDraft(draft))

const withRow = (draft: PolicyDraft, name: OperationClass, choice: RowChoice): PolicyDraft => ({
  ...draft,
  classes: { ...draft.classes, [name]: choice },
})

describe('access policy drafts', () => {
  test('four rows, no Admin', () => {
    expect(OPERATION_CLASSES).toEqual(['read', 'create', 'update', 'delete'])
  })

  test('no policy, an empty one and the default are all the plain default', () => {
    for (const stored of [null, undefined, {}, { version: 1, default: 'allow', rules: [] }]) {
      const draft = draftFromPolicy(stored)
      expect(draft.default).toBe('allow')
      expect(OPERATION_CLASSES.every((name) => draft.classes[name] === 'default')).toBe(true)
      expect(OPERATION_CLASSES.every((name) => rowEffect(draft, name) === 'allow')).toBe(true)
      expect(draft.advanced).toEqual([])
      expect(policyPayload(draft)).toBeNull()
    }
  })

  test('a class rule sets its row, and set rows are written back in a fixed order', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'delete', effect: 'block' },
        { class: 'create', effect: 'ask' },
      ],
    })
    expect(draft.classes).toEqual({
      read: 'default',
      create: 'ask',
      update: 'default',
      delete: 'block',
    })
    expect(policyPayload(draft)).toEqual({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'create', effect: 'ask' },
        { class: 'delete', effect: 'block' },
      ],
    })
  })

  test('the Default switch moves every row on Default and no row that is set', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [{ class: 'delete', effect: 'block' }],
    })
    const next = { ...draft, default: 'ask' as const }
    expect(OPERATION_CLASSES.map((name) => rowEffect(next, name))).toEqual([
      'ask',
      'ask',
      'ask',
      'block',
    ])
    // Only the row that is set needs a rule.
    expect(policyPayload(next)).toEqual({
      version: 1,
      default: 'ask',
      rules: [{ class: 'delete', effect: 'block' }],
    })
  })

  test('a row set to the effect Default has keeps it when Default moves, after a save too', () => {
    const draft = withRow(draftFromPolicy(null), 'read', 'allow')
    const saved = policyPayload(draft)
    expect(saved).toEqual({
      version: 1,
      default: 'allow',
      rules: [{ class: 'read', effect: 'allow' }],
    })
    const reopened = draftFromPolicy(saved)
    expect(reopened.classes.read).toBe('allow')
    const blocked = { ...reopened, default: 'block' as const }
    expect(rowEffect(blocked, 'read')).toBe('allow')
    expect(rowEffect(blocked, 'create')).toBe('block')
  })

  test('choosing Default for a row makes it follow again', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'ask',
      rules: [{ class: 'delete', effect: 'block' }],
    })
    const following = withRow(draft, 'delete', 'default')
    expect(rowEffect(following, 'delete')).toBe('ask')
    expect(policyPayload(following)).toEqual({ version: 1, default: 'ask', rules: [] })
    expect(rowEffect({ ...following, default: 'block' }, 'delete')).toBe('block')
  })

  test('every row back on Default with Default at Allow clears the policy', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [{ class: 'delete', effect: 'block' }],
    })
    const cleared = withRow(draft, 'delete', 'default')
    expect(policyPayload(cleared)).toBeNull()
    expect(samePolicy(cleared, draftFromPolicy(null))).toBe(true)
  })

  test('never reads or writes credential_minting, which belongs to the secret guard', () => {
    const stored = {
      version: 1,
      default: 'allow',
      rules: [
        { class: 'credential_minting', effect: 'allow' },
        { class: 'delete', effect: 'block' },
      ],
    }
    expect(readPolicy(stored).rules).toEqual([{ class: 'delete', effect: 'block' }])
    const payload = JSON.stringify(policyPayload(draftFromPolicy(stored)))
    expect(payload).not.toContain('credential_minting')
    expect(JSON.stringify(policyPayload(draftFromPolicy(null)))).toBe('null')
  })

  test('several class rules for one class mean the strictest', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'update', effect: 'ask' },
        { class: 'update', effect: 'block' },
      ],
    })
    expect(draft.classes.update).toBe('block')
  })

  test('method and path rules keep methods in their usual order and trim the path', () => {
    const draft = draftFromPolicy(null)
    const rule = {
      ...newAdvancedRule(),
      methods: ['DELETE', 'POST'],
      path: ' /v1/x/* ',
      effect: 'block' as const,
    }
    expect(policyPayload({ ...draft, advanced: [rule] })).toEqual({
      version: 1,
      default: 'allow',
      rules: [{ match: { methods: ['POST', 'DELETE'], path: '/v1/x/*' }, effect: 'block' }],
    })
    // A path alone, or methods alone, is a rule; neither is not.
    expect(policyPayload({ ...draft, advanced: [{ ...rule, methods: [] }] })?.rules[0]).toEqual({
      match: { path: '/v1/x/*' },
      effect: 'block',
    })
    expect(policyPayload({ ...draft, advanced: [{ ...rule, path: '' }] })?.rules[0]).toEqual({
      match: { methods: ['POST', 'DELETE'] },
      effect: 'block',
    })
  })

  test('reads advanced rules back into rows', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [{ match: { methods: ['POST'], path: '/v1/charges/*' }, effect: 'ask' }],
    })
    expect(draft.advanced).toHaveLength(1)
    expect(draft.advanced[0]).toMatchObject({
      methods: ['POST'],
      path: '/v1/charges/*',
      effect: 'ask',
    })
    expect(everything(draft)).toContain('/v1/charges/*')
  })

  test('says what the backend would refuse', () => {
    const draft = draftFromPolicy(null)
    const rule = newAdvancedRule()
    expect(policyProblem({ ...draft, advanced: [rule] })).toMatch(/choose a method or enter a path/)
    expect(policyProblem({ ...draft, advanced: [{ ...rule, path: 'v1' }] })).toMatch(/begins with/)
    expect(
      policyProblem({ ...draft, advanced: [{ ...rule, path: `/${'a'.repeat(1024)}` }] })
    ).toMatch(/at most 1024/)
    expect(policyProblem({ ...draft, advanced: [{ ...rule, path: '/a\nb' }] })).toMatch(
      /control character/
    )
    const many = Array.from({ length: 51 }, () => ({ ...newAdvancedRule(), path: '/x' }))
    expect(policyProblem({ ...draft, advanced: many })).toMatch(/at most 50/)
    expect(policyProblem({ ...draft, advanced: many.slice(0, 50) })).toBe('')
    expect(policyProblem(draft)).toBe('')
  })

  test('reads temporary allows, dropping expired and malformed ones', () => {
    const now = Date.parse('2026-11-14T10:00:00Z')
    const allows = readTemporaryAllows(
      [
        { id: 'late', class: 'delete', expiresAt: '2026-11-14T12:00:00Z' },
        {
          id: 'soon',
          match: { methods: ['DELETE'], path: '/repos/acme/x' },
          expiresAt: '2026-11-14T11:00:00Z',
        },
        { id: 'old', class: 'read', expiresAt: '2026-11-14T09:00:00Z' },
        { id: 'broken', expiresAt: '2026-11-14T12:00:00Z' },
        { class: 'read' },
      ],
      now
    )
    expect(allows.map((allow) => allow.id)).toEqual(['soon', 'late'])
  })

  test('rows on Default get rules of their own when an HTTP rule is weaker, and read back on Default', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'block',
      rules: [
        { class: 'delete', effect: 'block' },
        { match: { path: '/jobs/*' }, effect: 'allow' },
      ],
    })
    // A rule equal to Default beside a weaker HTTP rule is how a row on Default is saved.
    expect(draft.classes.delete).toBe('default')
    const saved = policyFromDraft(withRow(draft, 'read', 'allow'))
    // The proxy applies the strongest matching rule: without these, DELETE /jobs/* is allowed.
    expect(saved?.rules).toEqual([
      { class: 'read', effect: 'allow' },
      { class: 'create', effect: 'block' },
      { class: 'update', effect: 'block' },
      { class: 'delete', effect: 'block' },
      { match: { path: '/jobs/*' }, effect: 'allow' },
    ])
    // Those rules equal Default, which is how rows on Default were saved.
    expect(draftFromPolicy(saved).classes).toEqual({
      read: 'allow',
      create: 'default',
      update: 'default',
      delete: 'default',
    })
  })

  test('moving Default above an Allow HTTP rule writes rules for the rows on Default', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'delete', effect: 'block' },
        { match: { path: '/jobs/*' }, effect: 'allow' },
      ],
    })
    const next = { ...draft, default: 'ask' as const }
    expect(policyFromDraft(next)?.rules).toEqual([
      { class: 'read', effect: 'ask' },
      { class: 'create', effect: 'ask' },
      { class: 'update', effect: 'ask' },
      { class: 'delete', effect: 'block' },
      { match: { path: '/jobs/*' }, effect: 'allow' },
    ])
  })

  test('a stronger HTTP rule needs no class rules for rows on Default', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'ask',
      rules: [{ match: { path: '/jobs/*' }, effect: 'block' }],
    })
    expect(policyFromDraft(draft)).toEqual({
      version: 1,
      default: 'ask',
      rules: [{ match: { path: '/jobs/*' }, effect: 'block' }],
    })
  })
})

describe('reading a policy for display', () => {
  test('reads only rules by class or by method and path, and says what each covers', () => {
    const later = new Date(Date.now() + 60_000).toISOString()
    const policy = readPolicy({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'admin', effect: 'block' },
        { operation: 'ec2:TerminateInstances', effect: 'block' },
        { class: 'delete', effect: 'block' },
        { match: { methods: ['POST'], path: '/v1/x' }, effect: 'ask' },
      ],
    })
    expect(policy.rules).toEqual([
      { class: 'delete', effect: 'block' },
      { match: { methods: ['POST'], path: '/v1/x' }, effect: 'ask' },
    ])
    expect(
      readTemporaryAllows([
        { id: 'a', operation: 'ec2:TerminateInstances', expiresAt: later },
        { id: 'b', class: 'admin', expiresAt: later },
      ])
    ).toEqual([])
    expect(describeTarget({ class: 'delete' })).toBe('Delete calls')
    expect(describeTarget({ match: { methods: ['POST'], path: '/v1/x' } })).toBe('POST /v1/x')
  })

  test('the rows an HTTP rule falls under come from its methods alone', () => {
    const rows = (methods: string[]) => ruleRows({ methods })
    expect(rows(['GET', 'HEAD', 'OPTIONS'])).toEqual(['read'])
    expect(rows(['POST'])).toEqual(['create'])
    expect(rows(['PUT', 'PATCH', 'CONNECT', 'TRACE'])).toEqual(['update'])
    expect(rows(['DELETE', 'GET'])).toEqual(['read', 'delete'])
    // No method: every call on the path.
    expect(rows([])).toEqual(['read', 'create', 'update', 'delete'])
  })

  test('an HTTP rule takes effect only where it is stricter than a row it falls under', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'ask',
      rules: [{ class: 'delete', effect: 'block' }],
    })
    const rule = (methods: string[], effect: PolicyEffect): AdvancedRuleDraft => ({
      ...newAdvancedRule(),
      methods,
      path: '/repos/*',
      effect,
    })
    expect(ruleTakesEffect(draft, rule(['DELETE'], 'block'))).toBe(false)
    expect(ruleTakesEffect(draft, rule(['DELETE'], 'ask'))).toBe(false)
    expect(ruleTakesEffect(draft, rule(['GET'], 'block'))).toBe(true)
    expect(ruleTakesEffect(draft, rule(['GET'], 'ask'))).toBe(false)
    expect(ruleTakesEffect(draft, rule(['GET', 'DELETE'], 'block'))).toBe(true)
    expect(ruleTakesEffect(draft, rule([], 'block'))).toBe(true)
    // Allow never loosens a row.
    for (const methods of [[], ['GET'], ['DELETE']])
      expect(ruleTakesEffect({ ...draft, default: 'allow' }, rule(methods, 'allow'))).toBe(false)
  })

  test('a policy restricts when a row or an HTTP rule is not Allow', () => {
    expect(policyRestricts(null)).toBe(false)
    expect(
      policyRestricts({ version: 1, default: 'allow', rules: [{ class: 'read', effect: 'allow' }] })
    ).toBe(false)
    expect(policyRestricts({ version: 1, default: 'ask', rules: [] })).toBe(true)
    expect(
      policyRestricts({
        version: 1,
        default: 'allow',
        rules: [{ class: 'delete', effect: 'block' }],
      })
    ).toBe(true)
    expect(
      policyRestricts({
        version: 1,
        default: 'allow',
        rules: [{ match: { methods: ['DELETE'] }, effect: 'block' }],
      })
    ).toBe(true)
    // Every call is one of the four rows, so a Default no row follows stops nothing.
    expect(
      policyRestricts({
        version: 1,
        default: 'block',
        rules: OPERATION_CLASSES.map((name) => ({ class: name, effect: 'allow' })),
      })
    ).toBe(false)
  })

  test('managed policies are read as listed, ignoring what is not shaped like one', () => {
    expect(
      readManagedPolicies([
        {
          id: 'secret_guard',
          locked: true,
          rules: [{ class: 'credential_minting', effect: 'block' }],
        },
        { locked: true },
        null,
      ])
    ).toEqual([
      {
        id: 'secret_guard',
        locked: true,
        rules: [{ class: 'credential_minting', effect: 'block' }],
      },
    ])
    expect(readManagedPolicies([])).toEqual([])
    expect(readManagedPolicies(undefined)).toEqual([])
  })
})

describe('what is saved is what the editor shows', () => {
  const STRICTNESS: Record<PolicyEffect, number> = { allow: 0, ask: 1, block: 2 }
  const stricter = (left: PolicyEffect, right: PolicyEffect) =>
    STRICTNESS[right] > STRICTNESS[left] ? right : left
  const ROW: Record<string, OperationClass> = {
    GET: 'read',
    HEAD: 'read',
    OPTIONS: 'read',
    POST: 'create',
    PUT: 'update',
    PATCH: 'update',
    DELETE: 'delete',
    CONNECT: 'update',
    TRACE: 'update',
  }
  const matches = (rule: { methods?: string[]; path?: string }, method: string, path: string) =>
    (!rule.methods || rule.methods.includes(method)) &&
    (!rule.path || new RegExp(`^${rule.path.split('*').join('.*')}$`).test(path))

  // As the proxy answers a call: the strictest rule that matches, else the policy's default.
  const answer = (policy: AccessPolicy | null, method: string, path: string): PolicyEffect => {
    if (!policy) return 'allow'
    const effects = policy.rules
      .filter((rule) =>
        'class' in rule ? rule.class === ROW[method] : matches(rule.match, method, path)
      )
      .map((rule) => rule.effect)
    return effects.length ? effects.reduce(stricter) : policy.default
  }

  // As the editor shows it: the call's row, made stricter by any HTTP rule that matches.
  const shown = (draft: PolicyDraft, method: string, path: string): PolicyEffect =>
    draft.advanced
      .filter((rule) =>
        matches(
          { methods: rule.methods.length ? rule.methods : undefined, path: rule.path },
          method,
          path
        )
      )
      .map((rule) => rule.effect)
      .reduce(stricter, rowEffect(draft, ROW[method]))

  const http = (methods: string[], path: string, effect: PolicyEffect): AdvancedRuleDraft => ({
    ...newAdvancedRule(),
    methods,
    path,
    effect,
  })
  const RULE_SETS: AdvancedRuleDraft[][] = [
    [],
    [http(['GET'], '/jobs/*', 'allow')],
    [http(['DELETE'], '/jobs/*', 'ask')],
    [http([], '/jobs/*', 'block')],
    [http([], '/jobs/*', 'allow'), http(['POST', 'DELETE'], '/jobs/x', 'block')],
    [http(['PATCH'], '/jobs/*', 'ask'), http(['GET', 'HEAD'], '/jobs/x', 'allow')],
  ]
  const CHOICES: RowChoice[] = ['default', ...EFFECTS]
  const drafts = function* (): Generator<PolicyDraft> {
    for (const fallback of EFFECTS)
      for (const advanced of RULE_SETS)
        for (let index = 0; index < CHOICES.length ** OPERATION_CLASSES.length; index += 1) {
          const classes = Object.fromEntries(
            OPERATION_CLASSES.map((name, position) => [
              name,
              CHOICES[Math.floor(index / CHOICES.length ** position) % CHOICES.length],
            ])
          ) as Record<OperationClass, RowChoice>
          yield { default: fallback, classes, advanced }
        }
  }

  const label = (draft: PolicyDraft) =>
    JSON.stringify(draft, [
      'default',
      'classes',
      ...OPERATION_CLASSES,
      'advanced',
      'methods',
      'path',
      'effect',
    ])

  test('every call gets the answer the editor shows, for every Default, row and HTTP rule', () => {
    const wrong: string[] = []
    let checked = 0
    for (const draft of drafts()) {
      const saved = policyFromDraft(draft)
      for (const method of HTTP_METHODS)
        for (const path of ['/jobs/x', '/jobs/y', '/other']) {
          checked += 1
          if (answer(saved, method, path) !== shown(draft, method, path))
            wrong.push(`${method} ${path} on ${label(draft)}`)
        }
    }
    expect(wrong).toEqual([])
    expect(checked).toBe(3 * RULE_SETS.length * 256 * HTTP_METHODS.length * 3)
  })

  test('reopening a saved policy shows the same rows and saves the same policy', () => {
    const wrong: string[] = []
    for (const draft of drafts()) {
      const reopened = draftFromPolicy(policyFromDraft(draft))
      // Rows on Default are saved as rules equal to Default when an HTTP rule is weaker,
      // so then a row set to that same effect reads back on Default.
      const weaker = draft.advanced.some(
        (rule) => STRICTNESS[rule.effect] < STRICTNESS[draft.default]
      )
      const rows = OPERATION_CLASSES.every(
        (name) =>
          rowEffect(reopened, name) === rowEffect(draft, name) &&
          (reopened.classes[name] === draft.classes[name] ||
            (weaker &&
              draft.classes[name] === draft.default &&
              reopened.classes[name] === 'default'))
      )
      if (reopened.default !== draft.default || !rows || !samePolicy(reopened, draft))
        wrong.push(label(draft))
    }
    expect(wrong).toEqual([])
  })

  test('a rule said to have no effect changes no answer, and with one rule the reverse holds', () => {
    const wrong: string[] = []
    for (const draft of drafts()) {
      const saved = policyFromDraft(draft)
      // For a policy the editor saved, the stored rules say the same.
      const stored = rulesInForce(saved)
      if (draft.advanced.some((rule, index) => stored[index] !== ruleTakesEffect(draft, rule)))
        wrong.push(`stored judgement differs on ${label(draft)}`)
      for (const rule of draft.advanced) {
        const without = policyFromDraft({
          ...draft,
          advanced: draft.advanced.filter((other) => other !== rule),
        })
        const changes = HTTP_METHODS.some((method) =>
          ['/jobs/x', '/jobs/y'].some(
            (path) => answer(saved, method, path) !== answer(without, method, path)
          )
        )
        const takesEffect = ruleTakesEffect(draft, rule)
        if ((!takesEffect && changes) || (draft.advanced.length === 1 && takesEffect !== changes))
          wrong.push(`${rule.methods.join(',')} ${rule.path} ${rule.effect} on ${label(draft)}`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('a stored rule judged to have no effect changes no answer, whoever wrote the policy', () => {
    // Policies the editor would not write: any class rules, or none, beside any HTTP rules.
    const OWN: Array<PolicyEffect | null> = [null, ...EFFECTS]
    const wrong: string[] = []
    for (const fallback of EFFECTS)
      for (const advanced of RULE_SETS)
        for (let index = 0; index < OWN.length ** OPERATION_CLASSES.length; index += 1) {
          const rules: AccessPolicy['rules'] = OPERATION_CLASSES.flatMap((name, position) => {
            const effect = OWN[Math.floor(index / OWN.length ** position) % OWN.length]
            return effect ? [{ class: name, effect }] : []
          })
          const matches = advanced.map((rule) => ({
            match: { ...(rule.methods.length ? { methods: rule.methods } : {}), path: rule.path },
            effect: rule.effect,
          }))
          const policy: AccessPolicy = {
            version: 1,
            default: fallback,
            rules: [...rules, ...matches],
          }
          const inForce = rulesInForce(policy)
          matches.forEach((rule, position) => {
            const without = { ...policy, rules: policy.rules.filter((other) => other !== rule) }
            const changes = HTTP_METHODS.some((method) =>
              ['/jobs/x', '/jobs/y'].some(
                (path) => answer(policy, method, path) !== answer(without, method, path)
              )
            )
            if (
              (!inForce[position] && changes) ||
              (matches.length === 1 && inForce[position] !== changes)
            )
              wrong.push(`${JSON.stringify(rule)} in ${JSON.stringify(policy)}`)
          })
        }
    expect(wrong).toEqual([])
  })
})

describe('the stored rules, as the proxy and the backend read them', () => {
  test('an Allow rule with no class rule for its row lets its calls through', () => {
    const policy = {
      version: 1,
      default: 'ask',
      rules: [
        { class: 'read', effect: 'allow' },
        { match: { methods: ['POST'], path: '/jobs/*' }, effect: 'allow' },
      ],
    }
    expect(rulesInForce(policy)).toEqual([true])
    // The editor shows Create on Default and saves a rule for it, which turns the Allow off.
    const draft = draftFromPolicy(policy)
    expect(ruleTakesEffect(draft, draft.advanced[0])).toBe(false)
    expect(policyFromDraft(draft)?.rules).toContainEqual({ class: 'create', effect: 'ask' })
  })

  test('each common method takes its class rule and its path-less rules, else Default', () => {
    expect(COMMON_METHODS).toEqual(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])
    expect(
      methodEffects({
        version: 1,
        default: 'allow',
        rules: [
          { match: { methods: ['DELETE'] }, effect: 'block' },
          { class: 'update', effect: 'ask' },
          { match: { methods: ['PATCH'] }, effect: 'block' },
          // A rule with a path decides only its own paths.
          { match: { methods: ['GET'], path: '/x' }, effect: 'block' },
        ],
      })
    ).toEqual({
      GET: 'allow',
      HEAD: 'allow',
      OPTIONS: 'allow',
      POST: 'allow',
      PUT: 'ask',
      PATCH: 'block',
      DELETE: 'block',
    })
    expect(methodEffects(null).POST).toBe('allow')
    // A rule for every path answers by its methods, or every method when it names none.
    expect(
      Object.values(
        methodEffects({
          version: 1,
          default: 'allow',
          rules: [{ match: { path: '/*' }, effect: 'block' }],
        })
      )
    ).toEqual(Array(7).fill('block'))
    expect(
      methodEffects({
        version: 1,
        default: 'allow',
        rules: [{ match: { methods: ['POST'], path: '*' }, effect: 'ask' }],
      }).POST
    ).toBe('ask')
  })

  test('a path is refused as the backend refuses it', () => {
    expect(pathProblem('/a/*')).toBe('')
    expect(pathProblem('a')).toMatch(/begins with/)
    expect(pathProblem('/a\u0007')).toMatch(/control character/)
    expect(pathProblem('/a%20b')).toBe(
      'write the path decoded, for example a space instead of %20; paths are compared after decoding.'
    )
    // A percent sign that is not an escape is a character like any other.
    expect(pathProblem('/a%zz')).toBe('')
  })

  test('the rule count includes the rows saved as rules', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'ask',
      rules: [{ match: { methods: ['GET'], path: '/x' }, effect: 'allow' }],
    })
    // The Allow rule is weaker than Default: all four rows are saved as rules.
    expect(savedRuleCount(draft)).toBe(5)
    expect(savedRuleCount(draftFromPolicy(null))).toBe(0)
  })
})
