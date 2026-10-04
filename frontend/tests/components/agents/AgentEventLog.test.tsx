import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import { AgentEventLog } from '@/components/agents/AgentEventLog'
import type { AgentEventConnectionCandidate } from '@/components/agents/AgentEventLogUtils'
import { AllowAgentConnectionHostOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'

jest.mock('@/graphql/queries/agents/getAgentEvents.gql', () => ({
  GetAgentEvents: Symbol('GetAgentEvents'),
}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  AllowAgentConnectionHostOp: Symbol('AllowAgentConnectionHostOp'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useApolloClient: jest.fn(),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const event = (reason = 'lockdown_unbound_host') => ({
  ingestSeq: '42',
  eventId: 'event-42',
  proxyCreatedAt: '2026-08-13T12:00:00Z',
  ingestedAt: '2026-08-13T12:00:01Z',
  eventType: 'request',
  protocol: 'http',
  method: 'GET',
  host: 'ssmmessages.eu-central-1.amazonaws.com',
  port: 443,
  path: '/v1/data-channel',
  provider: 'proxy',
  statusCode: 403,
  proxyDecision: 'BLOCK',
  outcome: 'denied',
  reason,
  workflow: { id: 'workflow-1', name: 'Default' },
  connection: null,
  session: { sessionUid: 'session-1' },
})

describe('AgentEventLog blocked host action', () => {
  let container: HTMLDivElement
  let root: Root
  let allowHost: jest.Mock
  let query: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    allowHost = jest.fn()
    query = jest.fn()
    ;(useApolloClient as jest.Mock).mockReturnValue({ query })
    ;(useQuery as jest.Mock).mockReturnValue({ data: undefined, error: undefined, loading: false })
    ;(useMutation as jest.Mock).mockImplementation((document) => {
      if (document === AllowAgentConnectionHostOp) return [allowHost, { loading: false }]
      throw new Error('Unexpected mutation in AgentEventLog test')
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (
    reason = 'lockdown_unbound_host',
    canAllowHosts = true,
    connections: AgentEventConnectionCandidate[] = [
      {
        id: 'connection-1',
        name: 'AWS production',
        hostRulesVersion: 'version-1',
      },
    ]
  ) => {
    query.mockResolvedValue({
      data: {
        agentEvents: {
          events: [event(reason)],
          nextCursor: '42',
          hasMore: false,
        },
      },
    })

    await act(async () => {
      root.render(
        <AgentEventLog
          organisationId="org-1"
          agentId="agent-1"
          agentName="Claude"
          workflows={[
            {
              id: 'workflow-1',
              name: 'Default',
              connections,
            },
          ]}
          sessions={[
            {
              sessionUid: 'session-1',
              workflow: { id: 'workflow-1', name: 'Default' },
            },
          ]}
          canRead
          canAllowHosts={canAllowHosts}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  test('permanently allows the exact blocked host on the only workflow connection', async () => {
    let resolveMutation: (value: unknown) => void = () => undefined
    const pendingMutation = new Promise((resolve) => {
      resolveMutation = resolve
    })
    allowHost.mockReturnValue(pendingMutation)
    await render()

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Permanently allow ssmmessages.eu-central-1.amazonaws.com:443 on AWS production"]'
    )
    expect(button).not.toBeNull()
    expect(container.textContent).toContain('Target: AWS production')

    act(() => button!.click())
    expect(button!.disabled).toBe(true)
    expect(allowHost).toHaveBeenCalledWith({
      variables: {
        eventIngestSeq: '42',
        connectionId: 'connection-1',
        expectedVersion: 'version-1',
      },
      refetchQueries: ['GetAgentDetail', 'GetAgentAssets'],
      awaitRefetchQueries: true,
    })

    await act(async () => {
      resolveMutation({
        data: { allowAgentConnectionHost: { approvalRequired: false } },
      })
      await pendingMutation
    })

    expect(toast.success).toHaveBeenCalledWith(
      'ssmmessages.eu-central-1.amazonaws.com:443 is now allowed on AWS production.'
    )
    expect(container.textContent).toContain('Host allowed')
  })

  test('does not offer the action for a credential injection failure', async () => {
    await render('credential_swap_failed')

    expect(container.textContent).not.toContain('Allow host')
  })

  test('does not offer the action without Agent Connection update permission', async () => {
    await render('lockdown_unbound_host', false)

    expect(container.textContent).not.toContain('Allow host')
  })

  test('does not guess a target when the workflow has multiple connections', async () => {
    await render('lockdown_unbound_host', true, [
      {
        id: 'connection-1',
        name: 'AWS production',
        hostRulesVersion: 'version-1',
      },
      {
        id: 'connection-2',
        name: 'AWS backup',
        hostRulesVersion: 'version-2',
      },
    ])

    expect(container.textContent).not.toContain('Allow host')
    expect(container.textContent).not.toContain('Target:')
  })

  test('reports when the permanent host change still needs independent approval', async () => {
    allowHost.mockResolvedValue({
      data: { allowAgentConnectionHost: { approvalRequired: true } },
    })
    await render('lockdown_unbound_host', true, [
      {
        id: 'connection-1',
        name: 'AWS production',
        hostRulesVersion: 'version-1',
        requiresHostReview: true,
      },
    ])

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Permanently add ssmmessages.eu-central-1.amazonaws.com:443 to AWS production for review"]'
    )
    expect(button?.textContent).toContain('Add host for review')
    await act(async () => button!.click())

    expect(toast.success).toHaveBeenCalledWith(
      'ssmmessages.eu-central-1.amazonaws.com:443 was added to AWS production. A different member must approve the host change before it can be used.'
    )
    expect(container.textContent).toContain('Host review pending')
  })

  test('renders proxy decisions without policy wording', async () => {
    await render()

    expect(container.textContent).toContain('Proxy decision')
    expect(container.textContent).toContain('Block')
    expect(container.textContent).not.toContain('Policy')
  })
})
