import {
  approvalLabel,
  editedRequestAction,
  readActionReview,
  readActionSnapshot,
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
