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
// react-syntax-highlighter ships ESM that Jest does not transform.
jest.mock('@/components/common/JsonBlock', () => ({
  JsonBlock: ({ data }: { data: unknown }) => <pre>{JSON.stringify(data)}</pre>,
}))
jest.mock('@/components/agents/AgentDialogs', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return {
    ConfirmAgentAction: ({
      description,
      actionLabel,
      triggerContent,
      triggerProps,
      onConfirm,
    }: {
      description: string
      actionLabel: string
      triggerContent: React.ReactNode
      triggerProps?: Record<string, unknown>
      onConfirm: () => Promise<void>
    }) => {
      const [open, setOpen] = ReactModule.useState(false)
      const { icon, isLoading, ...buttonProps } = triggerProps ?? {}
      return (
        <div>
          <button type="button" {...buttonProps} onClick={() => setOpen(true)}>
            {triggerContent}
          </button>
          {open && (
            <div role="dialog">
              <p>{description}</p>
              <button type="button" onClick={() => void onConfirm()}>
                Confirm {actionLabel}
              </button>
            </div>
          )}
        </div>
      )
    },
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })

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

  const confirmButton = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === label
    )!

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

    await act(async () => button!.click())
    expect(allowHost).not.toHaveBeenCalled()
    expect(container.textContent).toContain(
      'ssmmessages.eu-central-1.amazonaws.com:443 will be permanently allowed on AWS production. Every Workflow granted this Connection can reach it. Active sessions using AWS production end and must be restarted.'
    )
    act(() => confirmButton('Confirm Allow host').click())
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

  test('holds another host while the Connection has hosts awaiting review', async () => {
    await render('lockdown_unbound_host', true, [
      {
        id: 'connection-1',
        name: 'AWS production',
        hostRulesVersion: 'version-2',
        requiresHostReview: true,
        hostReviewPending: true,
      },
    ])

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Permanently add ssmmessages.eu-central-1.amazonaws.com:443 to AWS production for review"]'
    )!
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Approve the hosts waiting for review on AWS production first')
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
    await act(async () => confirmButton('Confirm Add host for review').click())

    expect(toast.success).toHaveBeenCalledWith(
      'ssmmessages.eu-central-1.amazonaws.com:443 was added to AWS production. A different member must approve the host change before it can be used.'
    )
    expect(container.textContent).toContain('Host review pending')
  })

  test('expands a row from the row or its chevron, but not from the host action', async () => {
    await render()
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Show details for event event-42"]'
    )!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label^="Permanently allow"]')!.click()
    )
    act(() => container.querySelector<HTMLElement>('[role="dialog"]')!.click())
    expect(container.textContent).not.toContain('Redacted detail')

    act(() => toggle.closest('tr')!.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Redacted detail')
    expect(container.textContent).toContain('lockdown_unbound_host')

    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Redacted detail')
  })

  test('filters by proxy decision from the log filter menu', async () => {
    await render()
    const trigger = container.querySelector<HTMLButtonElement>('[title="Filter Agent events"]')!
    expect(trigger.textContent).not.toContain('(active)')
    await act(async () => trigger.click())
    const block = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')
    ).find((button) => button.textContent?.includes('Block'))!

    query.mockClear()
    await act(async () => {
      block.click()
      await Promise.resolve()
    })
    expect(query.mock.calls[0][0].variables).toMatchObject({ proxyDecision: 'block' })
    expect(block.getAttribute('aria-pressed')).toBe('true')
    expect(trigger.textContent).toContain('(active)')

    // A second click clears the decision.
    query.mockClear()
    await act(async () => {
      block.click()
      await Promise.resolve()
    })
    expect(query.mock.calls[0][0].variables).toMatchObject({ proxyDecision: null })
    expect(trigger.textContent).not.toContain('(active)')
  })

  test('renders proxy decisions without policy wording', async () => {
    await render()

    expect(container.textContent).toContain('Proxy decision')
    expect(container.textContent).toContain('Block')
    expect(container.textContent).not.toContain('Policy')
  })
})

describe('AgentEventLog paging', () => {
  let container: HTMLDivElement
  let root: Root
  let query: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    query = jest.fn()
    ;(useApolloClient as jest.Mock).mockReturnValue({ query })
    ;(useQuery as jest.Mock).mockReturnValue({ data: undefined, error: undefined, loading: false })
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const row = (ingestSeq: string) => ({
    ...event('upstream_ok'),
    ingestSeq,
    eventId: `event-${ingestSeq}`,
    proxyDecision: 'ALLOW',
  })

  test('opens at the newest events, tails forward from them and pages back on demand', async () => {
    query
      .mockResolvedValueOnce({
        data: {
          agentEvents: { events: [row('9'), row('8')], nextCursor: '8', hasMore: true },
        },
      })
      .mockResolvedValueOnce({
        data: { agentEvents: { events: [row('7')], nextCursor: '7', hasMore: false } },
      })

    await act(async () => {
      root.render(
        <AgentEventLog
          organisationId="org-1"
          agentId="agent-1"
          workflows={[]}
          sessions={[]}
          canRead
          canAllowHosts={false}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(query.mock.calls[0][0].variables).toMatchObject({ newestFirst: true })
    expect(query.mock.calls[0][0].variables.before).toBeUndefined()
    const tail = (useQuery as jest.Mock).mock.calls.at(-1)[1]
    expect(tail.skip).toBe(false)
    expect(tail.variables.cursor).toBe('9')
    expect(container.textContent).toContain('Live polling')

    const older = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Load more'
    )!
    await act(async () => {
      older.click()
      await Promise.resolve()
    })

    expect(query.mock.calls[1][0].variables).toMatchObject({ newestFirst: true, before: '8' })
    expect(container.textContent).not.toContain('Load more')
    expect(container.textContent).toContain('No more events to show')
  })
})
