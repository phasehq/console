import {
  OPERATION_CLASSES,
  draftFromPolicy,
  newAdvancedRule,
  policyFromDraft,
  policyPayload,
  policyProblem,
  policySummary,
  readPolicy,
  readTemporaryAllows,
  samePolicy,
  withDefault,
  type PolicyDraft,
} from '@/utils/agents/accessPolicy'

const everything = (draft: PolicyDraft) => JSON.stringify(policyFromDraft(draft))

describe('access policy drafts', () => {
  test('no policy, an empty one and the default are all the plain default', () => {
    for (const stored of [null, undefined, {}, { version: 1, default: 'allow', rules: [] }]) {
      const draft = draftFromPolicy(stored)
      expect(draft.default).toBe('allow')
      expect(OPERATION_CLASSES.every((name) => draft.classes[name] === 'allow')).toBe(true)
      expect(draft.advanced).toEqual([])
      expect(policyPayload(draft)).toBeNull()
    }
  })

  test('class rules fill their rows and are written back in a fixed order', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'delete', effect: 'block' },
        { class: 'create', effect: 'ask' },
      ],
    })
    expect(draft.classes.delete).toBe('block')
    expect(draft.classes.create).toBe('ask')
    expect(draft.classes.read).toBe('allow')
    expect(policyPayload(draft)).toEqual({
      version: 1,
      default: 'allow',
      rules: [
        { class: 'create', effect: 'ask' },
        { class: 'delete', effect: 'block' },
      ],
    })
  })

  test('setting every row back to the default clears the policy', () => {
    const draft = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [{ class: 'delete', effect: 'block' }],
    })
    const cleared = { ...draft, classes: { ...draft.classes, delete: 'allow' as const } }
    expect(policyPayload(cleared)).toBeNull()
    expect(samePolicy(cleared, draftFromPolicy(null))).toBe(true)
  })

  test('rows that follow "Everything else" follow it when it changes', () => {
    const base = draftFromPolicy({
      version: 1,
      default: 'allow',
      rules: [{ class: 'delete', effect: 'block' }],
    })
    const next = withDefault(base, 'ask')
    expect(next.default).toBe('ask')
    expect(next.classes.read).toBe('ask')
    expect(next.classes.delete).toBe('block')
    // Only the one row that differs from the new default needs a rule.
    expect(policyPayload(next)).toEqual({
      version: 1,
      default: 'ask',
      rules: [{ class: 'delete', effect: 'block' }],
    })
  })

  test('an allow row under a restrictive default is kept as a rule', () => {
    const draft = withDefault(draftFromPolicy(null), 'block')
    const allowed = { ...draft, classes: { ...draft.classes, read: 'allow' as const } }
    expect(policyPayload(allowed)).toEqual({
      version: 1,
      default: 'block',
      rules: [{ class: 'read', effect: 'allow' }],
    })
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

  test('summarises only what restricts', () => {
    expect(policySummary(null)).toBe('')
    expect(policySummary({ version: 1, default: 'allow', rules: [] })).toBe('')
    expect(
      policySummary({
        version: 1,
        default: 'allow',
        rules: [
          { class: 'delete', effect: 'block' },
          { class: 'admin', effect: 'block' },
          { match: { path: '/x' }, effect: 'ask' },
        ],
      })
    ).toBe('2 blocked, 1 ask')
    expect(policySummary({ version: 1, default: 'block', rules: [] })).toBe('the rest blocked')
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
})
