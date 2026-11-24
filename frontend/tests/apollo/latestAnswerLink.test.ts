import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client'
import type { FetchResult } from '@apollo/client'
import { latestAnswer, latestAnswerLink } from '@/apollo/latestAnswerLink'

const QUERY = gql`
  query GetAppSecrets($appId: ID!) {
    appEnvironments(appId: $appId) {
      id
      secrets {
        id
        value
      }
    }
  }
`
const variables = { appId: 'app' }

const answer = (value: string): FetchResult => ({
  data: {
    appEnvironments: [
      {
        __typename: 'EnvironmentType',
        id: 'env',
        secrets: [{ __typename: 'SecretType', id: 'secret', value }],
      },
    ],
  },
})
const valueOf = (result: { data?: any } | null | undefined) =>
  result?.data?.appEnvironments?.[0].secrets[0].value

/** A client whose requests are answered by hand, in any order */
const setup = () => {
  const requests: {
    next: (r: FetchResult) => void
    error: (e: Error) => void
    complete: () => void
  }[] = []
  const server = new ApolloLink(() => new Observable((observer) => void requests.push(observer)))
  const client = new ApolloClient({
    link: ApolloLink.from([latestAnswerLink, server]),
    cache: new InMemoryCache(),
  })
  return {
    client,
    requests,
    answers: (request: number, value: string) => {
      requests[request].next(answer(value))
      requests[request].complete()
    },
    fails: (request: number) => requests[request].error(new Error('offline')),
    cached: () => valueOf({ data: client.readQuery({ query: QUERY, variables }) }),
  }
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 5))

// The link keeps its count per kind for as long as the page lives
let kinds = 0
const aKind = () => latestAnswer(`secrets-${++kinds}`)

const read = (client: ApolloClient<unknown>, context: object) =>
  client.query({ query: QUERY, variables, fetchPolicy: 'network-only', context })

describe('latestAnswerLink', () => {
  it('leaves a read without a kind alone: the answer that arrives last is the one kept', async () => {
    const { client, answers, cached } = setup()
    const context = { queryDeduplication: false }
    const first = read(client, context)
    const second = read(client, context)

    answers(1, 'newer')
    await second
    answers(0, 'older')
    await first

    expect(cached()).toBe('older')
  })

  it('sends each read of a kind as a request of its own', async () => {
    const { client, requests, answers } = setup()
    const context = aKind()
    const first = read(client, context)
    const second = read(client, context)

    expect(requests).toHaveLength(2)
    answers(0, 'a')
    answers(1, 'b')
    await Promise.all([first, second])
  })

  it('gives a read answered after one sent later that later answer', async () => {
    const { client, answers, cached } = setup()
    const context = aKind()
    const seen: string[] = []
    // What the page is shown: nothing while the cache is empty, then each change to it
    client.watchQuery({ query: QUERY, variables, fetchPolicy: 'cache-only' }).subscribe({
      next: (result) => valueOf(result) !== undefined && seen.push(valueOf(result)),
    })
    const first = read(client, context)
    const second = read(client, context)

    answers(1, 'newer')
    expect(valueOf(await second)).toBe('newer')
    answers(0, 'older')

    expect(valueOf(await first)).toBe('newer')
    await settled()
    expect(cached()).toBe('newer')
    expect(seen).toEqual(['newer'])
  })

  it('passes both answers on when they arrive in the order they were asked for', async () => {
    const { client, answers, cached } = setup()
    const context = aKind()
    const first = read(client, context)
    const second = read(client, context)

    answers(0, 'older')
    expect(valueOf(await first)).toBe('older')
    expect(cached()).toBe('older')
    answers(1, 'newer')

    expect(valueOf(await second)).toBe('newer')
    expect(cached()).toBe('newer')
  })

  it('counts each kind on its own', async () => {
    const { client, answers } = setup()
    const first = read(client, aKind())
    const second = read(client, aKind())

    answers(1, 'another kind')
    await second
    answers(0, 'this kind')

    expect(valueOf(await first)).toBe('this kind')
  })

  it('gives a read that fails late the newer answer instead', async () => {
    const { client, answers, fails, cached } = setup()
    const context = aKind()
    const first = read(client, context)
    const second = read(client, context)

    answers(1, 'newer')
    await second
    fails(0)

    expect(valueOf(await first)).toBe('newer')
    expect(cached()).toBe('newer')
  })

  it('passes an answer on when the read sent after it has failed', async () => {
    const { client, answers, fails, cached } = setup()
    const context = aKind()
    const first = read(client, context)
    const second = read(client, context)

    fails(1)
    await expect(second).rejects.toThrow('offline')
    answers(0, 'the only answer')

    expect(valueOf(await first)).toBe('the only answer')
    expect(cached()).toBe('the only answer')
  })

  it('does not show a watched query the answer to a poll that a refetch has overtaken', async () => {
    const { client, requests, answers, cached } = setup()
    const seen: string[] = []
    const watched = client.watchQuery({
      query: QUERY,
      variables,
      fetchPolicy: 'cache-and-network',
      pollInterval: 20,
      context: aKind(),
    })
    const subscription = watched.subscribe({ next: (result) => seen.push(valueOf(result)) })
    answers(0, 'first')
    await new Promise((resolve) => setTimeout(resolve, 40))
    // The poll is out; a refetch is sent after it and answered before it
    expect(requests).toHaveLength(2)
    const refetched = watched.refetch()
    answers(2, 'newer')
    await refetched
    answers(1, 'older')
    await settled()
    watched.stopPolling()
    subscription.unsubscribe()

    expect(cached()).toBe('newer')
    expect(seen).toEqual(['first', 'newer'])
  })

  it('forgets nothing it still needs when a read is given up', async () => {
    const { client, answers, cached } = setup()
    const context = aKind()
    const watched = client.watchQuery({
      query: QUERY,
      variables,
      fetchPolicy: 'network-only',
      context,
    })
    // Its request leaves, and the watcher goes before it is answered
    watched.subscribe({ next: () => {} }).unsubscribe()
    await settled()
    const first = read(client, context)
    const second = read(client, context)

    answers(2, 'newer')
    await second
    answers(1, 'older')

    expect(valueOf(await first)).toBe('newer')
    expect(cached()).toBe('newer')
  })
})
