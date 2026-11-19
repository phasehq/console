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
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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
      triggerProps,
      onConfirm,
    }: {
      description: string
      actionLabel: string
      triggerProps?: Record<string, unknown>
      onConfirm: () => Promise<void>
    }) => {
      const [open, setOpen] = ReactModule.useState(false)
      const { icon, isLoading, ...buttonProps } = triggerProps ?? {}
      return (
        <div>
          <button type="button" {...buttonProps} onClick={() => setOpen(true)}>
            {actionLabel}
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
          team="acme"
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
    expect(container.textContent).not.toContain('Event ID')

    act(() => toggle.closest('tr')!.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Event ID')
    expect(container.textContent).toContain('lockdown_unbound_host')
    expect(container.textContent).toContain('ConnectionNone')
    // No empty JSON box when the proxy sent no detail.
    expect(container.textContent).not.toContain('Detail{')
    expect(container.querySelector('pre')).toBeNull()

    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Event ID')
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
        data: { agentEvents: { events: [row('7'), row('6')], nextCursor: '6', hasMore: false } },
      })

    await act(async () => {
      root.render(
        <AgentEventLog
          team="acme"
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

    // 25 a page, as in the secret and SCIM logs.
    expect(query.mock.calls[0][0].variables).toMatchObject({ order: 'newest', limit: 25 })
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

    expect(query.mock.calls[1][0].variables).toMatchObject({ order: 'newest', before: '8' })
    expect(container.textContent).not.toContain('Load more')
    expect(container.textContent).toContain('No more events to show')

    // A divider opens each loaded page, as in the audit and secret logs.
    const divider = () =>
      Array.from(container.querySelectorAll('tbody tr')).find((tr) => tr.textContent === 'Page 2')!
    const rowAfterDivider = () =>
      divider().nextElementSibling!.querySelector('button[aria-label^="Show details"]')!
    expect(rowAfterDivider().getAttribute('aria-label')).toBe('Show details for event event-7')

    // Live events land on top without moving the divider.
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentEvents: { events: [row('10')], nextCursor: '10', hasMore: false } },
      error: undefined,
      loading: false,
    })
    await act(async () => {
      root.render(
        <AgentEventLog
          team="acme"
          organisationId="org-1"
          agentId="agent-1"
          workflows={[]}
          sessions={[]}
          canRead
          canAllowHosts={false}
        />
      )
    })
    expect(shownEventIds()).toEqual(['event-10', 'event-9', 'event-8', 'event-7', 'event-6'])
    expect(rowAfterDivider().getAttribute('aria-label')).toBe('Show details for event event-7')
  })

  const renderLog = async () => {
    await act(async () => {
      root.render(
        <AgentEventLog
          team="acme"
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
  }

  const timed = (ingestSeq: string, proxyCreatedAt: string) => ({
    ...row(ingestSeq),
    proxyCreatedAt,
  })

  const shownEventIds = () =>
    Array.from(container.querySelectorAll('button[aria-label^="Show details for event "]')).map(
      (button) => button.getAttribute('aria-label')!.replace('Show details for event ', '')
    )

  test('shows the detail the proxy sent, and the Connection it used', async () => {
    query.mockResolvedValue({
      data: {
        agentEvents: {
          events: [
            {
              ...event(),
              connection: { id: 'aws-production', name: 'AWS production' },
              detail: { aws_sigv4_failure: 'signature_mismatch' },
            },
          ],
          nextCursor: '42',
          hasMore: false,
        },
      },
    })
    await renderLog()

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Show details for event event-42"]')!
        .click()
    )
    expect(container.textContent).toContain('ConnectionAWS production')
    expect(container.textContent).toContain('Detail')
    expect(container.textContent).toContain('signature_mismatch')
  })

  test('shows events by event time, not ingest order', async () => {
    query.mockResolvedValue({
      data: {
        agentEvents: {
          events: [
            timed('9', '2026-08-13T12:05:00Z'),
            timed('8', '2026-08-13T12:09:00Z'),
            timed('7', '2026-08-13T12:01:00Z'),
          ],
          nextCursor: 'c',
          hasMore: false,
        },
      },
    })
    await renderLog()

    expect(shownEventIds()).toEqual(['event-8', 'event-9', 'event-7'])
  })

  test('sorts oldest first from the Time header and pauses the live tail', async () => {
    query.mockResolvedValue({
      data: { agentEvents: { events: [row('9')], nextCursor: 'c', hasMore: false } },
    })
    await renderLog()
    const header = container.querySelector('th[aria-sort]')!
    expect(header.getAttribute('aria-sort')).toBe('descending')

    await act(async () => {
      header.querySelector('button')!.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(header.getAttribute('aria-sort')).toBe('ascending')
    expect(query.mock.calls.at(-1)[0].variables).toMatchObject({ order: 'oldest' })
    expect((useQuery as jest.Mock).mock.calls.at(-1)[1].skip).toBe(true)
    expect(container.textContent).toContain('Live updates paused while sorted oldest first')
  })

  test('filters by a time range from the filter menu', async () => {
    query.mockResolvedValue({
      data: { agentEvents: { events: [row('9')], nextCursor: 'c', hasMore: false } },
    })
    await renderLog()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[title="Filter Agent events"]')!.click()
    )
    const lastHour = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')
    ).find((button) => button.textContent?.includes('Last hour'))!

    const before = Date.now()
    await act(async () => {
      lastHour.click()
      await Promise.resolve()
    })

    const variables = query.mock.calls.at(-1)[0].variables
    const start = Date.parse(variables.start)
    expect(start).toBeGreaterThanOrEqual(before - 3_600_000 - 1000)
    expect(start).toBeLessThanOrEqual(Date.now() - 3_600_000 + 1000)
    expect(variables.end).toBeNull()
  })
})

describe('AgentEventLog access rules', () => {
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

  const renderEvents = async (events: Array<Record<string, unknown>>) => {
    query.mockResolvedValue({ data: { agentEvents: { events, nextCursor: '1', hasMore: false } } })
    await act(async () => {
      root.render(
        <AgentEventLog
          team="acme"
          organisationId="org-1"
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default', connections: [] }]}
          sessions={[]}
          canRead
          canAllowHosts={false}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const badge = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent === label
    )!

  test('shows a held call as Ask, in amber, with its class and rule', async () => {
    await renderEvents([
      {
        ...event('agent_access_policy_ask'),
        method: 'DELETE',
        host: 'api.github.com',
        path: '/repos/acme/x',
        proxyDecision: 'ASK',
        detail: { class: 'delete', rule: { class: 'delete', effect: 'ask' } },
      },
    ])

    expect(badge('Ask').className).toContain('amber')
    expect(container.textContent).toContain('Delete · Delete calls: Ask')
    act(() => container.querySelector<HTMLElement>('tbody tr')!.click())
    expect(container.textContent).toContain('Kind of callDelete')
    expect(container.textContent).toContain('RuleDelete calls: Ask')
  })

  test('says which rule blocked a call: the secret guard, the default or a method and path', async () => {
    await renderEvents([
      {
        ...event('agent_access_policy_blocked'),
        ingestSeq: '1',
        eventId: 'guard',
        detail: { class: 'credential_minting', rule: 'secret_guard' },
      },
      {
        ...event('agent_access_policy_blocked'),
        ingestSeq: '2',
        eventId: 'default',
        detail: { class: 'update', rule: 'default' },
      },
      {
        ...event('agent_access_policy_blocked'),
        ingestSeq: '3',
        eventId: 'match',
        detail: { rule: { match: { methods: ['POST'], path: '/v1/x/*' }, effect: 'block' } },
      },
    ])

    expect(container.textContent).toContain('Credential minting · Secret guard')
    expect(container.textContent).toContain('Update · Everything else')
    expect(container.textContent).toContain('POST /v1/x/*: Block')
  })

  test('an Ask is not a filter option, and an ordinary block shows no class or rule', async () => {
    await renderEvents([{ ...event('lockdown_unbound_host'), detail: {} }])
    expect(container.textContent).not.toContain('Delete calls')
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent === 'Ask'
      )
    ).toBe(false)
  })
})

describe('AgentEventLog leak protection', () => {
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

  const leak = (eventId: string, minute: number, changes: Record<string, unknown>) => ({
    ...event('secret_in_request'),
    ingestSeq: String(minute),
    eventId,
    proxyCreatedAt: `2026-11-19T10:${String(minute).padStart(2, '0')}:00Z`,
    eventType: 'leak_protection',
    method: 'POST',
    host: 'api.anthropic.com',
    path: '/v1/messages',
    statusCode: null,
    proxyDecision: 'ALLOW',
    session: { sessionUid: 'session-1' },
    ...changes,
  })

  // As the Console stores and returns them: snake case keys, and the secrets
  // behind the placeholders as far as this viewer may see.
  const CENSORED = leak('censored', 4, {
    outcome: 'censored',
    latencyMs: 3,
    detail: {
      mode: 'censor',
      harness: 'claude',
      capture: 'proxy',
      severity: 'high',
      where: 'body',
      inventory_hits: 4,
      rule_redactions: 1,
      placeholder_count: 5,
      labels: 'aws_access_key_id',
      placeholders:
        'ph:secret:secret-1,ph:secret:secret-2,ph:secret:secret-3,ph:aws_access_key_id:1',
      secrets: [
        {
          placeholder: 'ph:secret:secret-1',
          app_id: 'app-1',
          app_name: 'orders-service',
          environment_id: 'env-1',
          environment_name: 'Production',
          secret_id: 'secret-1',
          path: '/billing',
        },
        {
          placeholder: 'ph:secret:secret-2',
          app_id: 'app-1',
          app_name: 'orders-service',
          environment_restricted: true,
        },
        { placeholder: 'ph:secret:secret-3', app_restricted: true },
      ],
    },
  })
  const BLOCKED = leak('blocked', 3, {
    method: 'GET',
    path: '/redacted',
    statusCode: 403,
    proxyDecision: 'BLOCK',
    outcome: 'denied',
    detail: { mode: 'censor', harness: 'claude', where: 'url', inventory_hits: 1 },
  })
  const UNREAD = leak('unread', 2, {
    outcome: 'unread',
    reason: 'body_over_limit',
    detail: { mode: 'censor', harness: 'opencode', capture: 'tunnel', rule_version: 7 },
  })
  const BYPASS = leak('bypass', 1, {
    method: 'CONNECT',
    host: 'chatgpt.com',
    path: '/',
    outcome: 'bypass',
    reason: 'tls_refused',
    detail: { mode: 'censor', harness: 'codex', window_seconds: 40 },
  })
  const REQUEST = {
    ...event('upstream_ok'),
    ingestSeq: '0',
    eventId: 'request',
    proxyCreatedAt: '2026-11-19T10:00:00Z',
    proxyDecision: 'ALLOW',
    outcome: 'ok',
    statusCode: 200,
    latencyMs: 12,
    detail: { aws_sigv4_failure: 'none' },
  }

  const renderLog = async (events: Array<Record<string, unknown>>) => {
    query.mockResolvedValue({ data: { agentEvents: { events, nextCursor: '4', hasMore: false } } })
    await act(async () => {
      root.render(
        <AgentEventLog
          team="acme"
          organisationId="org-1"
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default', connections: [] }]}
          sessions={[]}
          canRead
          canAllowHosts
        />
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const row = (eventId: string) =>
    container
      .querySelector<HTMLButtonElement>(`button[aria-label="Show details for event ${eventId}"]`)!
      .closest('tr')!

  const cells = (eventId: string) =>
    Array.from(row(eventId).querySelectorAll('td')).map((cell) => cell.textContent)

  const headline = (eventId: string) => row(eventId).querySelector<HTMLElement>('td div[title]')!

  const expand = (eventId: string) => {
    const collapsed = row(eventId)
    act(() => collapsed.click())
    return collapsed.nextElementSibling as HTMLElement
  }

  const field = (panel: HTMLElement, label: string) =>
    Array.from(panel.querySelectorAll<HTMLElement>('div.space-y-0\\.5')).find(
      (candidate) => candidate.firstElementChild?.textContent === label
    )?.lastElementChild as HTMLElement | undefined

  test('says what leak protection did in each row, in place of the method and path', async () => {
    await renderLog([CENSORED, BLOCKED, UNREAD, BYPASS, REQUEST])

    expect(cells('censored').slice(3, 6)).toEqual([
      'Removed 5 secret values from a request to api.anthropic.comHigh severityClaude Code · Phase AI proxy',
      'Allow',
      'Censored3 ms',
    ])
    expect(cells('blocked').slice(3, 6)).toEqual([
      'Blocked a request to api.anthropic.com with a secret in its URLClaude Code',
      'Block',
      'BlockedHTTP 403',
    ])
    expect(cells('unread').slice(3, 6)).toEqual([
      'Did not read a request to api.anthropic.com: the body was over the size limitOpenCode · phase up',
      'Allow',
      'Not read',
    ])
    expect(cells('bypass').slice(3, 6)).toEqual([
      "Not reading chatgpt.com for 40 seconds: the tool refused Phase's certificateCodex",
      'Allow',
      'Reading paused',
    ])

    // The request itself stays one hover away.
    expect(headline('censored').title).toBe('POST api.anthropic.com:443/v1/messages')
    expect(headline('bypass').title).toBe('CONNECT chatgpt.com:443/')
    // Never offered as a host to allow.
    expect(container.textContent).not.toContain('Allow host')
  })

  test('colours a row by its tone and marks its severity', async () => {
    await renderLog([
      CENSORED,
      BLOCKED,
      UNREAD,
      BYPASS,
      { ...CENSORED, eventId: 'calm', detail: {} },
    ])

    expect(headline('censored').className).toContain('text-red-700')
    expect(headline('blocked').className).toContain('text-red-700')
    expect(headline('unread').className).toContain('text-amber-700')
    expect(headline('bypass').className).toContain('text-amber-700')
    expect(headline('calm').className).toBe('')

    const severity = Array.from(row('censored').querySelectorAll('span')).find(
      (element) => element.textContent === 'High severity'
    )!
    expect(severity.className).toContain('bg-red-500/10')
    expect(row('blocked').textContent).not.toContain('severity')
    // With nothing to say about the tool, the row says what kind of event it is.
    expect(cells('calm')[3]).toBe(
      'Removed secret values from a request to api.anthropic.comLeak protection'
    )
  })

  test('an event of another type is shown as before', async () => {
    await renderLog([CENSORED, REQUEST])

    expect(cells('request').slice(3, 6)).toEqual([
      'GET ssmmessages.eu-central-1.amazonaws.com:443/v1/data-channelNo connection',
      'Allow',
      'HTTP 20012 ms',
    ])
    const panel = expand('request')
    expect(field(panel, 'Outcome')?.textContent).toBe('ok')
    expect(field(panel, 'Reason')?.textContent).toBe('upstream_ok')
    expect(field(panel, 'Bytes in / out')?.textContent).toBe('0 / 0')
    expect(panel.querySelector('pre')?.textContent).toBe('{"aws_sigv4_failure":"none"}')
    expect(field(panel, 'Tool')).toBeUndefined()
  })

  test('expands to the words, with the placeholders as chips and no raw detail', async () => {
    await renderLog([CENSORED, BLOCKED, UNREAD, BYPASS])
    const panel = expand('censored')

    expect(field(panel, 'Request')?.textContent).toBe('POST api.anthropic.com:443/v1/messages')
    expect(field(panel, 'Tool')?.textContent).toBe('Claude Code')
    expect(field(panel, 'Captured by')?.textContent).toBe('Phase AI proxy')
    expect(field(panel, 'Mode')?.textContent).toBe('Censor')
    expect(field(panel, 'Severity')?.textContent).toBe('High')
    expect(field(panel, 'Found in')?.textContent).toBe('Body')
    expect(Array.from(field(panel, 'Found')!.children).map((line) => line.textContent)).toEqual([
      '4 known secret values',
      '1 token format replaced',
      '5 distinct secrets in the request',
    ])
    expect(field(panel, 'Token formats')?.textContent).toBe('AWS access key ID')
    // What the words replace is not repeated.
    for (const label of ['Outcome', 'Bytes in / out', 'Credential action', 'Provider', 'Reason'])
      expect(field(panel, label)).toBeUndefined()
    expect(panel.querySelector('pre')).toBeNull()
    expect(panel.textContent).not.toContain('inventory_hits')

    const chips = Array.from(field(panel, 'Placeholders')!.querySelectorAll('code'))
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'ph:secret:secret-1',
      'ph:secret:secret-2',
      'ph:secret:secret-3',
      'ph:aws_access_key_id:1',
    ])
    // The chip is the log's own badge.
    expect(chips[0].parentElement!.className).toContain('rounded-full')
    expect(field(panel, 'Placeholders')!.textContent).toContain('+1 more not named in this event')
  })

  test('names the secret behind a placeholder only as far as the viewer may see', async () => {
    await renderLog([CENSORED])
    const placeholders = field(expand('censored'), 'Placeholders')!
    const [first, second, third, fourth] = Array.from(placeholders.querySelectorAll('code')).map(
      (chip) => chip.closest('span.inline-flex')!.parentElement!
    )

    const link = first.querySelector('a')!
    expect(link.textContent).toBe('A secret in orders-service (Production)')
    expect(link.getAttribute('href')).toBe(
      '/acme/apps/app-1/environments/env-1/billing?secret=secret-1'
    )
    expect(second.textContent).toBe(
      "ph:secret:secret-2A secret in orders-service (an environment you can't access)"
    )
    expect(third.textContent).toBe("ph:secret:secret-3A secret in an app you can't access")
    for (const withheld of [second, third]) {
      expect(withheld.querySelector('a')).toBeNull()
      expect(withheld.querySelector('[data-withheld]')).not.toBeNull()
    }
    expect(fourth.textContent).toBe('ph:aws_access_key_id:1')
  })

  test('shows the rest of each kind of event, and any detail it has no words for', async () => {
    await renderLog([CENSORED, BLOCKED, UNREAD, BYPASS])

    const blocked = expand('blocked')
    expect(field(blocked, 'Request')?.textContent).toBe('GET api.anthropic.com:443/redacted')
    expect(field(blocked, 'Found in')?.textContent).toBe('URL')
    expect(field(blocked, 'Found')?.textContent).toBe('1 known secret value')
    expect(field(blocked, 'Placeholders')).toBeUndefined()

    const unread = expand('unread')
    expect(field(unread, 'Captured by')?.textContent).toBe('phase up')
    expect(field(unread, 'Found')).toBeUndefined()
    expect(unread.querySelector('pre')?.textContent).toBe('{"rule_version":7}')

    const bypass = expand('bypass')
    expect(field(bypass, 'Tool')?.textContent).toBe('Codex')
    expect(field(bypass, 'Not reading for')?.textContent).toBe('40 seconds')
    expect(bypass.querySelector('pre')).toBeNull()
  })

  test('narrows the log to leak protection from the filter menu', async () => {
    await renderLog([CENSORED, REQUEST])
    const trigger = container.querySelector<HTMLButtonElement>('[title="Filter Agent events"]')!
    await act(async () => trigger.click())
    const group = container.querySelector('[role="group"][aria-label="Event type"]')!
    const option = group.querySelector<HTMLButtonElement>('button[aria-pressed]')!
    expect(option.textContent).toContain('Leak protection')
    expect(query.mock.calls[0][0].variables).toMatchObject({ eventType: null })

    query.mockClear()
    await act(async () => {
      option.click()
      await Promise.resolve()
    })
    expect(query.mock.calls[0][0].variables).toMatchObject({ eventType: 'leak_protection' })
    expect(option.getAttribute('aria-pressed')).toBe('true')
    expect(trigger.textContent).toContain('(active)')
    // The live tail follows the same filter.
    expect((useQuery as jest.Mock).mock.calls.at(-1)[1].variables).toMatchObject({
      eventType: 'leak_protection',
    })

    // A second click clears it.
    query.mockClear()
    await act(async () => {
      option.click()
      await Promise.resolve()
    })
    expect(query.mock.calls[0][0].variables).toMatchObject({ eventType: null })
    expect(trigger.textContent).not.toContain('(active)')
  })
})
