import { diffConnections } from '@/utils/agents/customConnectionDiff'
import type { HttpDefinition } from '@/utils/agents/httpDefinition'

const current: HttpDefinition = {
  specVersion: 1,
  hosts: [
    { match: 'exact', value: 'api.example.com', path: '/v1/*' },
    { match: 'exact', value: 'old.example.com' },
  ],
  fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' }, env: 'EXAMPLE_KEY' }],
  injections: [{ type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'token' }],
}

describe('the diff a reviewer sees', () => {
  test('a new Connection is all additions', () => {
    const diff = diffConnections(null, { name: 'Example API', definition: current })

    expect(diff.changed).toBe(true)
    expect(diff.name).toEqual({ change: 'added', label: 'Name', after: 'Example API' })
    expect(diff.hosts.map((entry) => [entry.change, entry.after])).toEqual([
      ['added', 'api.example.com/v1/*'],
      ['added', 'old.example.com'],
    ])
    expect(diff.injections).toEqual([
      { change: 'added', label: 'Authorization header', after: 'Authorization: Bearer <token>' },
    ])
    expect(diff.fields).toEqual([
      { change: 'added', label: 'token', after: 'secret, exported as EXAMPLE_KEY' },
    ])
    expect(diff.settings).toEqual([])
  })

  test('an identical request changes nothing', () => {
    const diff = diffConnections(
      { name: 'Example API', definition: current },
      { name: 'Example API', definition: current }
    )
    expect(diff.changed).toBe(false)
    expect(diff.hosts.every((entry) => entry.change === 'unchanged')).toBe(true)
  })

  test('a missing requested name or definition means unchanged', () => {
    const renamed = diffConnections(
      { name: 'Example API', definition: current },
      { name: 'Example API v2' }
    )
    expect(renamed.name).toEqual({
      change: 'changed',
      label: 'Name',
      before: 'Example API',
      after: 'Example API v2',
    })
    expect(renamed.hosts.every((entry) => entry.change === 'unchanged')).toBe(true)
    expect(renamed.changed).toBe(true)
  })

  test('shows hosts added, removed and changed', () => {
    const requested: HttpDefinition = {
      ...current,
      hosts: [
        { match: 'exact', value: 'api.example.com', path: '/v2/*' },
        { match: 'suffix', value: '.example.net', port: 8443 },
      ],
    }
    const diff = diffConnections({ name: 'A', definition: current }, { definition: requested })

    expect(diff.hosts).toEqual([
      // The same host with another path is one change, not a removal and an addition.
      {
        change: 'changed',
        label: 'api.example.com',
        before: 'api.example.com/v1/*',
        after: 'api.example.com/v2/*',
      },
      { change: 'added', label: '*.example.net:8443', after: '*.example.net:8443' },
      { change: 'removed', label: 'old.example.com', before: 'old.example.com' },
    ])
    expect(diff.name?.change).toBe('unchanged')
  })

  test('does not pair paths when a host has several rules', () => {
    const before: HttpDefinition = {
      ...current,
      hosts: [
        { match: 'exact', value: 'api.example.com', path: '/a' },
        { match: 'exact', value: 'api.example.com', path: '/b' },
      ],
    }
    const after: HttpDefinition = {
      ...current,
      hosts: [
        { match: 'exact', value: 'api.example.com', path: '/b' },
        { match: 'exact', value: 'api.example.com', path: '/c' },
        { match: 'exact', value: 'api.example.com', path: '/d' },
      ],
    }
    expect(
      diffConnections({ definition: before }, { definition: after }).hosts.map((entry) => [
        entry.change,
        entry.label,
      ])
    ).toEqual([
      ['unchanged', 'api.example.com/b'],
      ['added', 'api.example.com/c'],
      ['added', 'api.example.com/d'],
      ['removed', 'api.example.com/a'],
    ])
  })

  test('shows injections and fields added, removed and changed', () => {
    const requested: HttpDefinition = {
      ...current,
      fields: [
        { name: 'token', kind: 'secret', source: { type: 'sealed' }, decoyPrefix: 'sk-' },
        { name: 'username', kind: 'identifier', value: 'alice' },
      ],
      injections: [
        { type: 'header', name: 'authorization', prefix: 'Token ', field: 'token' },
        { type: 'query', name: 'user', field: 'token', whenAbsent: 'block' },
      ],
    }
    const diff = diffConnections({ definition: current }, { definition: requested })

    expect(diff.injections).toEqual([
      // Header names compare without regard to case.
      {
        change: 'changed',
        label: 'authorization header',
        before: 'Authorization: Bearer <token>',
        after: 'authorization: Token <token>',
      },
      {
        change: 'added',
        label: 'user query parameter',
        after: '?user=<token> (blocks a request without it)',
      },
    ])
    expect(diff.fields).toEqual([
      {
        change: 'changed',
        label: 'token',
        before: 'secret, exported as EXAMPLE_KEY',
        after: 'secret, placeholder prefix sk-',
      },
      { change: 'added', label: 'username', after: 'identifier alice' },
    ])

    const removed = diffConnections({ definition: requested }, { definition: current })
    expect(removed.injections.at(-1)).toMatchObject({
      change: 'removed',
      label: 'user query parameter',
    })
    expect(removed.fields.at(-1)).toMatchObject({ change: 'removed', label: 'username' })
  })

  test('shows plain HTTP only when either side allows it', () => {
    expect(diffConnections({ definition: current }, { definition: current }).settings).toEqual([])
    expect(
      diffConnections({ definition: current }, { definition: { ...current, allowPlainHttp: true } })
        .settings
    ).toEqual([{ change: 'changed', label: 'Plain HTTP', before: 'not allowed', after: 'allowed' }])
    expect(
      diffConnections(null, { definition: { ...current, allowPlainHttp: true } }).settings
    ).toEqual([{ change: 'added', label: 'Plain HTTP', after: 'allowed' }])
  })
})
