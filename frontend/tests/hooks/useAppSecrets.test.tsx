import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import type { FetchResult } from '@apollo/client'

import { latestAnswerLink } from '@/apollo/latestAnswerLink'
import { useAppSecrets } from '@/app/[team]/apps/[app]/_hooks/useAppSecrets'

jest.mock(
  '@/graphql/queries/secrets/getAppSecrets.gql',
  () => ({
    GetAppSecrets: jest.requireActual('@apollo/client').gql`
      query GetAppSecrets($appId: ID!, $path: String) {
        appEnvironments(appId: $appId) {
          id
          name
          wrappedSeed
          wrappedSalt
          secrets(path: $path) {
            id
            key
            value
            path
            updatedAt
          }
        }
      }
    `,
  }),
  { virtual: true }
)
// A value decrypts to itself in capitals; one that says so doesn't decrypt at all
jest.mock('@/utils/crypto', () => ({
  unwrapEnvSecretsForUser: async () => ({}),
  decryptEnvSecretKVs: async (secrets: { value: string }[]) =>
    secrets.map((secret) => {
      if (secret.value === 'undecryptable') throw new Error('wrong key')
      return { ...secret, value: secret.value.toUpperCase() }
    }),
}))
jest.mock('@/ee/utils/dynamicSecrets', () => ({ decryptDynamicSecretKeyNames: async () => [] }))
jest.mock('@/contexts/keyringContext', () => ({
  KeyringContext: jest.requireActual('react').createContext({ keyring: { publicKey: 'public' } }),
}))
jest.mock('@/app/[team]/apps/[app]/_components/EnvSelectionProvider', () => ({
  filterEnvSelection: (environments: unknown[]) => environments,
}))
jest.mock('@/app/[team]/apps/[app]/_components/SecretsCacheProvider', () => {
  const cache = new Map()
  return { useSecretsCache: () => cache, __cache: cache }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const answer = (value: string, updatedAt = value): FetchResult => ({
  data: {
    appEnvironments: [
      {
        __typename: 'EnvironmentType',
        id: 'env',
        name: 'Development',
        wrappedSeed: 'seed',
        wrappedSalt: 'salt',
        secrets: [
          { __typename: 'SecretType', id: 'secret', key: 'KEY', value, path: '/', updatedAt },
        ],
      },
    ],
  },
})

describe('useAppSecrets', () => {
  let container: HTMLDivElement
  let root: Root
  let seen: ReturnType<typeof useAppSecrets>[] = []
  let requests: {
    next: (r: FetchResult) => void
    error: (e: Error) => void
    complete: () => void
  }[]
  let apps = 0
  let appId = ''

  const Probe = () => {
    seen.push(useAppSecrets(appId, true, 0))
    return null
  }
  const latest = () => seen.at(-1)!
  /** The one value on the page, or what a read resolved with */
  const shown = (rows = latest().appSecrets) => rows[0]?.envs[0].secret?.value
  const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 5))))
  const answers = async (request: number, value: string) => {
    await act(async () => {
      requests[request].next(answer(value))
      requests[request].complete()
    })
    await flush()
  }
  /** Calls readSaved, and says how it ended */
  const read = () => {
    const outcome: { rows?: ReturnType<typeof latest>['appSecrets']; failed?: boolean } = {}
    latest()
      .readSaved()
      .then(
        (rows) => (outcome.rows = rows),
        () => (outcome.failed = true)
      )
    return outcome
  }

  beforeEach(async () => {
    seen = []
    requests = []
    // An app of its own each time: the hook keeps what it decrypted per app
    appId = `app-${++apps}`
    jest.requireMock('@/app/[team]/apps/[app]/_components/SecretsCacheProvider').__cache.clear()
    const server = new ApolloLink(() => new Observable((observer) => void requests.push(observer)))
    const client = new ApolloClient({
      link: ApolloLink.from([latestAnswerLink, server]),
      cache: new InMemoryCache(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root.render(
        <ApolloProvider client={client}>
          <Probe />
        </ApolloProvider>
      )
    )
    await answers(0, 'first')
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('decrypts what it loads', () => {
    expect(shown()).toBe('FIRST')
    expect(latest().fetching).toBe(false)
    expect(latest().failed).toBe(false)
  })

  it('reads the saved secrets with a request of its own, and resolves with their rows once they are on the page', async () => {
    const saved = read()
    await flush()

    expect(requests).toHaveLength(2)
    expect(saved.rows).toBeUndefined()

    await answers(1, 'saved')

    expect(shown(saved.rows)).toBe('SAVED')
    expect(latest().appSecrets).toBe(saved.rows)
  })

  it('does not resolve when what it read can not be decrypted, and keeps the rows it had', async () => {
    const saved = read()
    await flush()
    await answers(1, 'undecryptable')

    expect(saved).toEqual({ failed: true })
    expect(shown()).toBe('FIRST')
    expect(latest().failed).toBe(true)

    // Read again, once it can be
    const again = read()
    await flush()
    await answers(2, 'saved')

    expect(shown(again.rows)).toBe('SAVED')
    expect(shown()).toBe('SAVED')
    expect(latest().failed).toBe(false)
  })

  it('does not resolve when the read fails', async () => {
    const saved = read()
    await flush()
    await act(async () => requests[1].error(new Error('offline')))
    await flush()

    expect(saved).toEqual({ failed: true })
    expect(shown()).toBe('FIRST')
  })

  it('gives a read answered after a later one the later rows, and never shows the older ones', async () => {
    const first = read()
    await flush()
    const second = read()
    await flush()
    expect(requests).toHaveLength(3)

    await answers(2, 'newer')
    expect(shown(second.rows)).toBe('NEWER')
    await answers(1, 'older')

    expect(shown(first.rows)).toBe('NEWER')
    expect(shown()).toBe('NEWER')
    expect(seen.map((result) => shown(result.appSecrets))).not.toContain('OLDER')
  })

  it('resolves with rows read after the call when the same secrets come back', async () => {
    const saved = read()
    await flush()
    await answers(1, 'first')

    expect(shown(saved.rows)).toBe('FIRST')
  })
})
