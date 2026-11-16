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
  editedContextAction,
  editedRequestAction,
  readAccessRecord,
  readActionReview,
  readActionSnapshot,
  readAllowTarget,
  readBlockedCall,
  requestActionPermission,
  requestActionType,
} from '@/utils/agents/requestActions'
import type { HttpDefinition } from '@/utils/agents/httpDefinition'

const definition: HttpDefinition = {
  specVersion: 1,
  hosts: [{ match: 'exact', value: 'api.example.com' }],
  fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' } }],
  injections: [{ type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'token' }],
}

describe('request actions', () => {
  test('knows the four action types and nothing else', () => {
    expect(requestActionType({ type: 'agent_connection.create' })).toBe('agent_connection.create')
    expect(requestActionType({ type: 'agent_connection.remove' })).toBe('agent_connection.remove')
    expect(requestActionType({ type: 'something.else' })).toBeNull()
    expect(requestActionType(null)).toBeNull()
    expect(requestActionType('agent_connection.create')).toBeNull()
  })

  test('reads the server review, tolerating missing sides', () => {
    expect(
      readActionReview({
        type: 'agent_connection.update',
        title: 'Change hosts on Example',
        requiresSecret: true,
        current: { name: 'Example', definition },
        requested: { name: 'Example', definition: { not: 'a definition' } },
      })
    ).toEqual({
      type: 'agent_connection.update',
      title: 'Change hosts on Example',
      requiresSecret: true,
      current: { name: 'Example', definition },
      requested: { name: 'Example', definition: null },
    })
    expect(
      readActionReview({ type: 'agent_connection.remove', title: 'Remove', current: null })
    ).toMatchObject({ requiresSecret: false, current: null, requested: null })
    expect(readActionReview(null)).toBeNull()
    expect(readActionReview({ type: 'unknown' })).toBeNull()
  })

  test('reads what an action asks for, when it asks for anything', () => {
    expect(
      readActionSnapshot({ type: 'agent_connection.create', name: 'Example', definition })
    ).toEqual({ name: 'Example', definition })
    expect(readActionSnapshot({ type: 'agent_connection.remove', connectionId: 'c' })).toBeNull()
  })

  test('maps each action to the Connection permission it takes', () => {
    expect(requestActionPermission('agent_connection.create')).toBe('create')
    expect(requestActionPermission('agent_connection.update')).toBe('update')
    expect(requestActionPermission('agent_connection.secret_update')).toBe('update')
    expect(requestActionPermission('agent_connection.remove')).toBeNull()
  })

  test('an edited action keeps the type and target of the request', () => {
    expect(
      editedRequestAction(
        { type: 'agent_connection.create', version: 1, serviceType: 'http', name: 'Old' },
        'New',
        definition
      )
    ).toEqual({
      type: 'agent_connection.create',
      version: 1,
      serviceType: 'http',
      name: 'New',
      definition,
    })
    expect(
      editedRequestAction(
        { type: 'agent_connection.update', version: 1, connectionId: 'connection-1' },
        'New',
        definition
      )
    ).toEqual({
      type: 'agent_connection.update',
      version: 1,
      connectionId: 'connection-1',
      name: 'New',
      definition,
    })
    // Nothing to edit on these.
    expect(
      editedRequestAction({ type: 'agent_connection.secret_update' }, 'New', definition)
    ).toBeNull()
    expect(editedRequestAction({ type: 'agent_connection.remove' }, 'New', definition)).toBeNull()
  })

  test('says how a request was approved', () => {
    expect(approvalLabel({ version: 1, assurance: 'session' })).toBe('a signed-in Console session')
    expect(approvalLabel({ version: 2, assurance: 'hardware_touch' })).toBe('hardware touch')
    expect(approvalLabel(null)).toBe('')
  })
})

describe('requests for access, renewals and context', () => {
  const blockedCall = {
    method: 'DELETE',
    host: 'api.github.com',
    path: '/repos/acme/x',
    class: 'delete',
  }

  test('knows the three new action types', () => {
    expect(requestActionType({ type: 'agent_grant.allow' })).toBe('agent_grant.allow')
    expect(requestActionType({ type: 'agent_grant.renew' })).toBe('agent_grant.renew')
    expect(requestActionType({ type: 'agent_workflow.context_update' })).toBe(
      'agent_workflow.context_update'
    )
  })

  test('reads an allow review: the blocked call, the rule, the duration and the grant as it is', () => {
    const review = readActionReview({
      type: 'agent_grant.allow',
      title: 'Allow DELETE /repos/acme/x on GitHub',
      requiresSecret: false,
      current: {
        name: 'GitHub',
        policy: { version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'ask' }] },
        temporaryAllows: [{ id: 'a', class: 'read', expiresAt: '2999-01-01T00:00:00Z' }],
      },
      requested: {
        allow: { match: { methods: ['DELETE'], path: '/repos/acme/x' } },
        blockedCall,
        durationSeconds: 3600,
      },
    })
    expect(review?.allow).toMatchObject({
      connectionName: 'GitHub',
      allow: { match: { methods: ['DELETE'], path: '/repos/acme/x' } },
      blockedCall,
      durationSeconds: 3600,
    })
    expect(review?.allow?.policy?.rules).toEqual([{ class: 'delete', effect: 'ask' }])
    expect(review?.allow?.temporaryAllows).toHaveLength(1)
  })

  test('reads a renew review, and a state it does not know as no grant', () => {
    expect(
      readActionReview({
        type: 'agent_grant.renew',
        title: 'Renew access to GitHub',
        current: { name: 'GitHub', state: 'expired', expiresAt: '2026-11-13T00:00:00Z' },
        requested: { durationSeconds: 86400 },
      })?.renew
    ).toEqual({
      connectionName: 'GitHub',
      state: 'expired',
      expiresAt: '2026-11-13T00:00:00Z',
      durationSeconds: 86400,
    })
    expect(
      readActionReview({ type: 'agent_grant.renew', current: { state: 'weird' }, requested: {} })
        ?.renew?.state
    ).toBe('none')
  })

  test('reads a context review as plain text on both sides', () => {
    expect(
      readActionReview({
        type: 'agent_workflow.context_update',
        title: 'Update the context of Default',
        current: { markdown: 'old' },
        requested: { markdown: '<script>x</script>' },
      })?.context
    ).toEqual({ current: 'old', requested: '<script>x</script>' })
  })

  test('a new Connection carries the duration it asks for', () => {
    expect(
      readActionReview({
        type: 'agent_connection.create',
        current: null,
        requested: { name: 'Example', definition, durationSeconds: 7200 },
      })?.requested?.durationSeconds
    ).toBe(7200)
  })

  test('says which approvals need which permission and which may last until revoked', () => {
    expect(requestActionPermission(REQUEST_ACTION_TYPES.allow)).toBe('read')
    expect(requestActionPermission(REQUEST_ACTION_TYPES.renew)).toBe('read')
    expect(requestActionPermission(REQUEST_ACTION_TYPES.contextUpdate)).toBeNull()
    expect(actionAllowsUntilRevoked(REQUEST_ACTION_TYPES.allow)).toBe(false)
    expect(actionAllowsUntilRevoked(REQUEST_ACTION_TYPES.renew)).toBe(true)
    expect(actionAllowsUntilRevoked(REQUEST_ACTION_TYPES.create)).toBe(true)
    expect(actionTakesDuration(REQUEST_ACTION_TYPES.create)).toBe(true)
    expect(actionTakesDuration(REQUEST_ACTION_TYPES.remove)).toBe(false)
    expect(actionTakesDuration(REQUEST_ACTION_TYPES.contextUpdate)).toBe(false)
  })

  test('narrows an allow to a class or to a method and path, and refuses an empty rule', () => {
    const asked = { match: { methods: ['DELETE'], path: '/repos/acme/x' } }
    const draft = allowDraftFromTarget(asked, readBlockedCall(blockedCall))
    expect(allowFromDraft(draft)).toEqual(asked)
    expect(allowEdited(asked, allowFromDraft(draft))).toBe(false)
    expect(allowEdited(asked, allowFromDraft({ ...draft, path: '/repos/acme/x/*' }))).toBe(true)
    // A class request can be narrowed to the one call that was refused.
    const classDraft = allowDraftFromTarget({ class: 'delete' }, readBlockedCall(blockedCall))
    expect(allowFromDraft(classDraft)).toEqual({ class: 'delete' })
    expect(allowFromDraft({ ...classDraft, scope: 'match' })).toEqual({
      match: { methods: ['DELETE'], path: '/repos/acme/x' },
    })
    expect(allowDraftProblem({ ...draft, methods: [], path: '' })).toMatch(/Choose a method/)
    expect(allowDraftProblem({ ...draft, path: 'x' })).toMatch(/begins with/)
    expect(allowDraftProblem({ ...classDraft, class: '' })).toMatch(/Choose a class/)
  })

  test('an allow by AWS action is read, edited only to another exact action, and never widened', () => {
    expect(readAllowTarget({ operation: 'ec2:TerminateInstances' })).toEqual({
      operation: 'ec2:TerminateInstances',
    })
    // Not written out in full: nothing is read, so nothing is shown as allowed.
    expect(readAllowTarget({ operation: 'ec2:*' })).toEqual({})
    expect(
      readBlockedCall({ ...blockedCall, operation: 'ec2:TerminateInstances' })?.operation
    ).toBe('ec2:TerminateInstances')
    expect(readBlockedCall(blockedCall)?.operation).toBe('')

    const asked = { operation: 'ec2:TerminateInstances' }
    const draft = allowDraftFromTarget(asked, readBlockedCall(blockedCall))
    expect(draft).toMatchObject({ scope: 'operation', operation: 'ec2:TerminateInstances' })
    expect(allowFromDraft(draft)).toEqual(asked)
    expect(allowEdited(asked, allowFromDraft(draft))).toBe(false)
    expect(allowEdited(asked, allowFromDraft({ ...draft, operation: ' ec2:StopInstances ' }))).toBe(
      true
    )
    expect(allowFromDraft({ ...draft, operation: ' ec2:StopInstances ' })).toEqual({
      operation: 'ec2:StopInstances',
    })
    expect(allowFromDraft({ ...draft, operation: '' })).toBeNull()
    expect(allowDraftProblem({ ...draft, operation: '' })).toMatch(/Enter an AWS action/)
    expect(allowDraftProblem({ ...draft, operation: 'ec2:*' })).toMatch(/service:Action/)
    expect(allowDraftProblem(draft)).toBe('')

    const original = {
      type: 'agent_grant.allow',
      version: 1,
      connectionId: 'c1',
      allow: asked,
      blockedCall: { ...blockedCall, operation: 'ec2:TerminateInstances' },
    }
    expect(editedAllowAction(original, { operation: 'ec2:StopInstances' })).toMatchObject({
      allow: { operation: 'ec2:StopInstances' },
      connectionId: 'c1',
    })
  })

  test('reads an allow review that names an AWS action', () => {
    const review = readActionReview({
      type: 'agent_grant.allow',
      title: 't',
      current: {
        name: 'AWS production',
        policy: { version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'ask' }] },
        temporaryAllows: [
          {
            id: 'a',
            operation: 'ec2:StopInstances',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      },
      requested: {
        allow: { operation: 'ec2:TerminateInstances' },
        blockedCall: {
          method: 'POST',
          host: 'ec2.amazonaws.com',
          path: '/',
          operation: 'ec2:TerminateInstances',
        },
        durationSeconds: 3600,
      },
    })
    expect(review?.allow?.allow).toEqual({ operation: 'ec2:TerminateInstances' })
    expect(review?.allow?.blockedCall?.operation).toBe('ec2:TerminateInstances')
    expect(review?.allow?.temporaryAllows[0].operation).toBe('ec2:StopInstances')
    expect(review?.allow?.policy?.rules).toEqual([{ class: 'delete', effect: 'ask' }])
  })

  test('the edited allow keeps the Connection and the refused call and never a credential-minting class', () => {
    const original = {
      type: 'agent_grant.allow',
      version: 1,
      connectionId: 'c1',
      allow: { class: 'delete' },
      blockedCall,
    }
    const edited = editedAllowAction(original, {
      match: { methods: ['DELETE'], path: '/repos/acme/x' },
    })
    expect(edited).toEqual({
      type: 'agent_grant.allow',
      version: 1,
      connectionId: 'c1',
      allow: { match: { methods: ['DELETE'], path: '/repos/acme/x' } },
      blockedCall,
    })
    expect(JSON.stringify(edited)).not.toContain('credential_minting')
    expect(editedAllowAction({ type: 'agent_connection.create' }, { class: 'read' })).toBeNull()
  })

  test('the edited context is only the new text', () => {
    expect(
      editedContextAction({ type: 'agent_workflow.context_update', version: 1, markdown: 'a' }, 'b')
    ).toEqual({ type: 'agent_workflow.context_update', version: 1, markdown: 'b' })
    expect(editedContextAction({ type: 'agent_grant.allow' }, 'b')).toBeNull()
  })

  test('reads what was asked and what was granted', () => {
    expect(
      readAccessRecord({
        requestedDurationSeconds: 3600,
        grantedDurationSeconds: 86400,
        expiresAt: '2026-11-15T10:00:00Z',
      })
    ).toEqual({ requestedSeconds: 3600, grantedSeconds: 86400, expiresAt: '2026-11-15T10:00:00Z' })
    expect(
      readAccessRecord({
        requestedDurationSeconds: 3600,
        grantedDurationSeconds: null,
        expiresAt: null,
      })
    ).toEqual({ requestedSeconds: 3600, grantedSeconds: null, expiresAt: null })
    expect(readAccessRecord(null)).toBeNull()
  })
})
