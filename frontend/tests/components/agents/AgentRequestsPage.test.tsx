import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import AgentRequestsPage from '@/app/[team]/requests/page'

jest.mock('@/graphql/queries/agents/getAgentRequests.gql', () => ({
  GetAgentRequests: Symbol('GetAgentRequests'),
}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  ResolveAgentRequestOp: Symbol('ResolveAgentRequestOp'),
}))
jest.mock('@/components/agents/AgentSettingsDialog', () => ({
  AgentSettingsDialog: () => <button type="button">Settings</button>,
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('request=request-1&action=setup'),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = { id: 'org-1', memberId: 'member-1', role: { permissions: '' } }
  return {
    mockActiveOrganisation: activeOrganisation,
    organisationContext: jest
      .requireActual<typeof React>('react')
      .createContext({ activeOrganisation }),
  }
})
jest.mock('@/components/agents/AgentDialogs', () => ({
  DenyAgentRequestDialog: ({ onDeny }: any) => (
    <>
      <button type="button" onClick={() => onDeny('')}>
        Deny
      </button>
      <button type="button" onClick={() => onDeny('Use the read-only role instead.')}>
        Deny with note
      </button>
    </>
  ),
}))
jest.mock('@/components/agents/AgentSetupRequestDialog', () => ({
  AgentSetupRequestDialog: ({ request, autoOpen, onAutoOpened }: any) => (
    <>
      <button type="button" data-request={request.id} data-auto-open={String(autoOpen)}>
        {request.kind.toLowerCase() === 'credential_update'
          ? 'Update credentials'
          : 'Set up Connection'}
      </button>
      <button type="button" onClick={onAutoOpened}>
        Auto-opened
      </button>
    </>
  ),
}))
jest.mock('@/components/agents/AgentActionRequest', () => ({
  AgentAccessSummary: () => null,
  AgentActionApproveDialog: ({ request, autoOpen }: any) => (
    <button type="button" data-action-request={request.id} data-auto-open={String(autoOpen)}>
      Review and approve
    </button>
  ),
  AgentActionReview: ({ request }: any) => (
    <div data-action-review={request.id}>{request.actionReview?.type}</div>
  ),
}))
jest.mock('@/components/agents/AgentRequestStatusFilter', () => ({
  AgentRequestStatusFilter: ({ value, onChange }: any) => (
    <div data-filter={value}>
      <button type="button" onClick={() => onChange('denied')}>
        Denied
      </button>
    </div>
  ),
}))
jest.mock('@/components/agents/HardenedRequestMarkdown', () => ({
  HardenedRequestMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const buildRequest = (kind = 'setup') => ({
  id: 'request-1',
  kind,
  status: 'pending',
  progress: {},
  resolution: null,
  revision: 'request-v5',
  credentialProvider: 'aws_assume_role',
  credentialName: 'AWS EC2 full access',
  serviceType: 'aws',
  markdown: 'Use an AWS role scoped to EC2.',
  expiresAt: '2030-01-01T00:00:00Z',
  createdAt: '2026-09-07T00:00:00Z',
  agent: {
    id: 'agent-1',
    name: 'Deploy Agent',
    harnessType: 'codex',
    team: null,
  },
  workflow: { id: 'workflow-1', name: 'Default' },
  connection: kind === 'credential_update' ? { id: 'connection-1', name: 'AWS production' } : null,
  credential: null,
})

const setPermissions = (permissions: Record<string, string[]>) => {
  const { mockActiveOrganisation } = jest.requireMock('@/contexts/organisationContext')
  mockActiveOrganisation.role.permissions = JSON.stringify({
    permissions,
    app_permissions: {},
    agent_permissions: { AgentWorkflows: ['update'] },
    global_access: false,
  })
}

describe('Change request cards', () => {
  let container: HTMLDivElement
  let root: Root
  let resolveRequest: jest.Mock

  beforeEach(() => {
    setPermissions({
      AgentRequests: ['read', 'update'],
      IntegrationCredentials: ['read', 'create'],
      AgentConnections: ['create', 'update'],
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    resolveRequest = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([resolveRequest, { loading: false }])
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: true }),
    })
    window.requestAnimationFrame = (callback) => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = jest.fn()
    Element.prototype.scrollIntoView = jest.fn()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const { GetAgentRequests } = jest.requireMock('@/graphql/queries/agents/getAgentRequests.gql')
  // The list, cut to the window the page asks for as the server does, and a
  // linked-request lookup by ID.
  const answer = (list: any[], { linked = list, error }: { linked?: any[]; error?: Error } = {}) =>
    (useQuery as jest.Mock).mockImplementation((_query: unknown, options: any) => {
      const { requestId, status, limit } = options?.variables ?? {}
      const matching = status ? list.filter((item) => item.status === status) : list
      return {
        data: { agentRequests: requestId ? linked : matching.slice(0, limit) },
        loading: false,
        error,
        refetch: jest.fn().mockResolvedValue({}),
      }
    })
  const mount = async () => {
    await act(async () => {
      root.render(
        <Suspense fallback={<div>Loading</div>}>
          <AgentRequestsPage params={Promise.resolve({ team: 'phase' })} />
        </Suspense>
      )
      await Promise.resolve()
    })
  }

  const renderRequest = async (kind = 'setup') => {
    answer([buildRequest(kind)])
    await mount()
  }

  const renderWith = async (overrides: Record<string, unknown>) => {
    answer([{ ...buildRequest(), ...overrides }])
    await mount()
  }

  const timing = () => {
    const field = Array.from(container.querySelectorAll('dt')).find((term) =>
      /Expires|Expired|Resolved/.test(term.textContent || '')
    )!
    return `${field.textContent} ${field.nextElementSibling!.textContent}`
  }

  // The main list, and what a linked-request lookup (by ID) returns.
  const renderPage = async (list: any[], linked: any[] = []) => {
    answer(list, { linked })
    await mount()
  }
  const request = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    ...buildRequest(),
    id,
    status,
    markdown: `Note for ${id}`,
    resolvedAt: status === 'pending' ? null : '2026-09-08T00:00:00Z',
    ...extra,
  })
  const listCalls = () =>
    (useQuery as jest.Mock).mock.calls
      .filter(([, options]) => !options?.variables?.requestId)
      .map(([, options]) => options)
  const listLimits = () => listCalls().map((options) => options.variables.limit)
  const cardIds = () => Array.from(container.querySelectorAll('article')).map((card) => card.id)
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === label
    )

  test('loads 15 requests at a time, asking for one more to know there is more', async () => {
    await renderPage(
      Array.from({ length: 31 }, (_, index) => request(`request-${index + 10}`, 'denied'))
    )

    expect(container.querySelectorAll('article')).toHaveLength(15)
    expect(listLimits().at(-1)).toBe(16)

    await act(async () => button('Load more')!.click())
    // The window grows; the requests already loaded stay polled with it.
    expect(listLimits().at(-1)).toBe(31)
    expect(container.querySelectorAll('article')).toHaveLength(30)
    expect(container.textContent).not.toContain('No more requests to show')

    await act(async () => button('Load more')!.click())
    expect(listLimits().at(-1)).toBe(46)
    expect(container.querySelectorAll('article')).toHaveLength(31)
    expect(button('Load more')).toBeUndefined()
    expect(container.textContent).toContain('No more requests to show')
  })

  test('Load more stops spinning when the larger window fails, and says so', async () => {
    const list = Array.from({ length: 31 }, (_, index) =>
      request(`request-${index + 10}`, 'denied')
    )
    const failure = new Error('network down')
    ;(useQuery as jest.Mock).mockImplementation((_query: unknown, options: any) => {
      const { requestId, limit } = options?.variables ?? {}
      const refetch = jest.fn().mockResolvedValue({})
      if (requestId) return { data: { agentRequests: [] }, loading: false, refetch }
      if (limit > 16)
        return {
          data: undefined,
          previousData: { agentRequests: list.slice(0, 16) },
          loading: false,
          error: failure,
          refetch,
        }
      return { data: { agentRequests: list.slice(0, limit) }, loading: false, refetch }
    })
    await mount()
    expect(container.querySelectorAll('article')).toHaveLength(15)

    await act(async () => button('Load more')!.click())

    const { toast } = jest.requireMock('react-toastify')
    expect(toast.error).toHaveBeenCalledWith('Unable to load more change requests')
    expect(container.querySelectorAll('article')).toHaveLength(15)
    expect(listLimits().at(-1)).toBe(16)
    const more = button('Load more')!
    expect(more).toBeDefined()
    expect(more.disabled).toBe(false)
  })

  test('ends a list that fits on one page the way the log screens do', async () => {
    await renderPage([request('request-3', 'pending'), request('request-2', 'approved')])

    expect(button('Load more')).toBeUndefined()
    const footer = container.querySelector('article')!.parentElement!.lastElementChild!
    expect(footer.textContent).toBe('No more requests to show')
    expect(footer.className).toContain('justify-center')
  })

  test('shows pending and resolved requests in one list, as the server orders them', async () => {
    await renderPage([
      request('request-4', 'pending'),
      request('request-3', 'pending'),
      request('request-2', 'approved'),
      request('request-5', 'denied'),
    ])

    expect(cardIds()).toEqual([
      'agent-request-request-4',
      'agent-request-request-3',
      'agent-request-request-2',
      'agent-request-request-5',
    ])
    // One query for the list, with no status unless the member filters.
    expect(new Set((useQuery as jest.Mock).mock.calls.map(([query]) => query))).toEqual(
      new Set([GetAgentRequests])
    )
    expect(listCalls().at(-1).variables.status).toBeNull()
    expect(container.textContent).not.toContain('Waiting for you')
    expect(container.textContent).not.toContain('All requests')
    expect(button('View all requests')).toBeUndefined()
  })

  test('members who can only read requests see the same list', async () => {
    setPermissions({ AgentRequests: ['read'] })
    await renderPage([request('request-3', 'pending'), request('request-2', 'approved')])

    expect(cardIds()).toEqual(['agent-request-request-3', 'agent-request-request-2'])
    expect(button('Deny')).toBeUndefined()
  })

  test('has one heading, with the filter and refresh beside it and no Agent sub-heading', async () => {
    await renderPage([request('request-3', 'pending')])

    const headings = Array.from(container.querySelectorAll('h1, h2')).map((node) => node.tagName)
    expect(container.querySelector('h1')!.textContent).toBe('Change Requests')
    expect(headings.filter((tag) => tag === 'H1')).toHaveLength(1)
    expect(container.textContent).not.toContain('Agent requests')
    expect(container.textContent).not.toContain('your Agents ask for')
    const row = container.querySelector('h1')!.parentElement!.parentElement!
    expect(row.querySelector('[data-filter]')).not.toBeNull()
    expect(row.textContent).toContain('Refresh')
  })

  describe('who resolved a request', () => {
    const resolver = (extra: Record<string, unknown> = {}) => ({
      id: 'member-9',
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarUrl: null,
      ...extra,
    })
    const header = () => container.querySelector('article > div')!

    test('shows the avatar and name beside the outcome, and the email in the details', async () => {
      await renderPage([request('request-2', 'approved', { resolvedBy: resolver() })])

      expect(header().textContent).toContain('Approved')
      expect(header().textContent).toContain('Ada Lovelace')
      expect(header().textContent).not.toContain('ada@example.com')
      expect(header().querySelector('.truncate')!.textContent).toBe('Ada Lovelace')

      await act(async () => button('Details')!.click())
      const details = container.querySelector('#agent-request-request-2-details')!
      expect(details.textContent).toContain('Approved by')
      expect(details.textContent).toContain('Ada Lovelace')
      expect(details.textContent).toContain('ada@example.com')
    })

    test('names the member who denied a request, falling back to their email', async () => {
      await renderPage([request('request-2', 'denied', { resolvedBy: resolver({ fullName: '' }) })])

      expect(header().textContent).toContain('ada@example.com')
      await act(async () => button('Details')!.click())
      expect(container.textContent).toContain('Denied by')
    })

    test('keeps a long name on one line', async () => {
      const name = 'A very long member name '.repeat(8).trim()
      await renderPage([
        request('request-2', 'approved', { resolvedBy: resolver({ fullName: name }) }),
      ])

      const label = Array.from(header().querySelectorAll('.truncate')).find(
        (node) => node.textContent === name
      )!
      expect(label).toBeDefined()
      expect(label.closest('.max-w-\\[10rem\\]')).not.toBeNull()
    })

    test('shows just the time when the member is gone', async () => {
      await renderPage([request('request-2', 'approved', { resolvedBy: null })])

      expect(header().textContent).toContain('Approved')
      expect(header().querySelector('.truncate')).toBeNull()
      await act(async () => button('Details')!.click())
      expect(container.textContent).not.toContain('Approved by')
    })
  })

  test('with no requests at all shows a message and no action', async () => {
    await renderPage([])

    expect(container.textContent).toContain('No change requests')
    expect(container.querySelectorAll('article')).toHaveLength(0)
    // No filter and no refresh in the empty state; Settings is the only control, for those who may.
    expect(
      Array.from(container.querySelectorAll('button')).map((item) => item.textContent)
    ).toEqual(['Settings'])
    expect(container.querySelector('[data-filter]')).toBeNull()
  })

  test('a status filter narrows the list and starts again at 15', async () => {
    await renderPage([
      request('request-3', 'pending'),
      ...Array.from({ length: 20 }, (_, index) => request(`request-${index + 10}`, 'denied')),
    ])
    await act(async () => button('Load more')!.click())
    expect(listLimits().at(-1)).toBe(31)

    await act(async () => button('Denied')!.click())

    expect(listCalls().at(-1).variables).toMatchObject({ status: 'denied', limit: 16 })
    expect(container.querySelectorAll('article')).toHaveLength(15)
    expect(cardIds()).not.toContain('agent-request-request-3')
  })

  test('collapses resolved requests to their outcome, with Details to open them', async () => {
    await renderPage([request('request-3', 'pending'), request('request-2', 'approved')])

    const [open, resolved] = Array.from(container.querySelectorAll('article'))
    expect(open.textContent).toContain('Note for request-3')
    expect(open.textContent).not.toContain('Details')

    // A rule sets the resolved requests apart from the open ones.
    const separator = container.querySelector('[role="separator"]')!
    expect(separator.textContent).toBe('Resolved')
    expect(separator.nextElementSibling).toBe(resolved)

    expect(resolved.textContent).not.toContain('Note for request-2')
    expect(resolved.textContent).toContain('Approved')
    const details = Array.from(resolved.querySelectorAll('button')).find(
      (element) => element.textContent === 'Details'
    )!
    expect(details.getAttribute('aria-expanded')).toBe('false')

    await act(async () => details.click())
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(resolved.textContent).toContain('Note for request-2')
    expect(container.querySelector(`#${details.getAttribute('aria-controls')}`)).not.toBeNull()

    await act(async () => details.click())
    expect(resolved.textContent).not.toContain('Note for request-2')
  })

  test('loads a linked request past the first 15 on its own, open', async () => {
    await renderPage(
      Array.from({ length: 20 }, (_, index) => request(`request-${index + 10}`, 'pending')),
      [request('request-1', 'approved')]
    )

    const cards = Array.from(container.querySelectorAll('article'))
    // The linked request, then the first page.
    expect(cards).toHaveLength(16)
    expect(cards[0].id).toBe('agent-request-request-1')
    expect(cards[0].textContent).toContain('Note for request-1')
    expect(cards[1].id).toBe('agent-request-request-10')
    const lookup = (useQuery as jest.Mock).mock.calls.find(
      ([, options]) => options?.variables?.requestId
    )!
    expect(lookup[1].variables).toMatchObject({ requestId: 'request-1', limit: 1 })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  test('does not repeat a linked request that is already in the list', async () => {
    const linked = request('request-1', 'pending')
    await renderPage([request('request-3', 'pending'), linked], [linked])

    expect(cardIds()).toEqual(['agent-request-request-1', 'agent-request-request-3'])
  })

  test('shows when a pending request expires', async () => {
    await renderWith({ expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString() })

    expect(timing()).toBe('Expires in 3 days')
  })

  test('shows when a closed request was resolved, not when it would have expired', async () => {
    await renderWith({
      status: 'denied',
      resolvedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    })

    expect(timing()).toBe('Resolved 2 days ago')
  })

  test('shows when an expired request expired', async () => {
    await renderWith({
      status: 'expired',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      resolvedAt: new Date(Date.now() - 3_600_000).toISOString(),
    })

    expect(timing()).toBe('Expired yesterday')
  })

  test('keeps the last requests on screen when a poll fails', async () => {
    answer([buildRequest()], { error: new Error('Network request failed') })
    await mount()

    expect(container.textContent).toContain('AWS EC2 full access')
    expect(container.textContent).not.toContain('Network request failed')
  })

  test('offers only deny without permission to manage Agent Connections', async () => {
    setPermissions({
      AgentRequests: ['read', 'update'],
      IntegrationCredentials: ['read'],
    })
    await renderRequest()

    expect(container.textContent).toContain('Deny')
    expect(container.textContent).not.toContain('Set up Connection')
    expect(container.textContent).toContain('You can deny this request')
  })

  const click = async (label: string) =>
    act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === label)!
        .click()
    )

  test('sends the reviewer note with a denial', async () => {
    await renderRequest()
    await click('Deny with note')

    expect(resolveRequest.mock.calls[0][0].variables.resolutionNote).toBe(
      'Use the read-only role instead.'
    )
  })

  test('opens a linked setup request once and scrolls to it once', async () => {
    await renderRequest()
    const card = () => container.querySelector<HTMLElement>('[data-request="request-1"]')!
    expect(card().dataset.autoOpen).toBe('true')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)

    await click('Auto-opened')
    answer([buildRequest(), { ...buildRequest(), id: 'request-2' }])
    await mount()

    expect(card().dataset.autoOpen).toBe('false')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  test('allows setup with request, credential-read, Connection, and workflow permissions', async () => {
    await renderRequest()

    expect(container.textContent).toContain('Connection setup')
    expect(container.textContent).toContain('AWS EC2 full access')
    expect(container.textContent).toContain('Use an AWS role scoped to EC2.')
    expect(container.querySelector('[data-request="request-1"]')).toMatchObject({
      dataset: expect.objectContaining({ autoOpen: 'true' }),
    })
    expect(container.textContent).toContain('Set up Connection')
    expect(container.textContent).not.toMatch(/policy|app source|credential class/i)
  })

  test('ends the card with Deny at the far left and the resolving action at the far right', async () => {
    await renderRequest()

    const card = container.querySelector('article')!
    const buttonsIn = (element: Element) =>
      Array.from(element.querySelectorAll('button')).map((button) => button.textContent)
    // The header has no decision buttons.
    expect(buttonsIn(card.firstElementChild!)).toEqual([])
    const footer = card.lastElementChild!
    // Deny's stub buttons come first and the setup dialog's last.
    expect(buttonsIn(footer)).toEqual([
      'Deny',
      'Deny with note',
      'Set up Connection',
      'Auto-opened',
    ])
    expect(footer.className).toContain('justify-between')
  })

  test('denies with optimistic request revision and classifies credential updates', async () => {
    await renderRequest('credential_update')

    expect(container.textContent).toContain('Credential update')
    expect(container.textContent).toContain('Update credentials')
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Deny')!
        .click()
    )
    expect(resolveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          requestId: 'request-1',
          expectedRevision: 'request-v5',
          approved: false,
          resolutionNote: 'Denied in the Phase Console.',
        },
      })
    )
  })

  describe('requests that carry an action', () => {
    const actionRequest = (type: string, extra: Record<string, unknown> = {}) => ({
      ...buildRequest(type === 'agent_connection.create' ? 'setup' : 'connection_update'),
      title: 'Allow /v2 on the Example API',
      markdown: '',
      serviceType: 'http',
      credentialProvider: 'http',
      credentialName: 'Example API',
      action: { type, version: 1 },
      actionReview: { type, title: 'Allow /v2 on the Example API', requiresSecret: false },
      ...extra,
    })

    test('shows the title, the diff and an approve action in place of the setup dialog', async () => {
      await renderWith(actionRequest('agent_connection.update'))

      const card = container.querySelector('article')!
      expect(card.querySelector('h2')!.textContent).toBe('Allow /v2 on the Example API')
      expect(card.querySelector('[data-action-review="request-1"]')!.textContent).toBe(
        'agent_connection.update'
      )
      expect(container.textContent).toContain('Connection change')
      expect(container.textContent).not.toContain('Credential context')
      expect(button('Review and approve')).toBeDefined()
      expect(button('Set up Connection')).toBeUndefined()
      expect(button('Deny')).toBeDefined()
    })

    test('shows the note only when the Agent wrote one', async () => {
      await renderWith(actionRequest('agent_connection.update'))
      expect(container.textContent).not.toContain("Agent's note")
      expect(container.textContent).not.toContain('No note supplied.')

      await renderWith(actionRequest('agent_connection.update', { markdown: 'Needed for /v2.' }))
      expect(container.textContent).toContain("Agent's note")
      expect(container.textContent).toContain('Needed for /v2.')
    })

    test('opens the review from the approval link the Agent was given', async () => {
      await renderWith(actionRequest('agent_connection.create'))

      expect(
        container.querySelector<HTMLElement>('[data-action-request="request-1"]')!.dataset.autoOpen
      ).toBe('true')
    })

    test('needs no integration credentials, only permission on Agent Connections', async () => {
      setPermissions({ AgentRequests: ['read', 'update'], AgentConnections: ['update'] })
      await renderWith(actionRequest('agent_connection.update'))
      expect(button('Review and approve')).toBeDefined()

      // Creating takes its own permission.
      await renderWith(actionRequest('agent_connection.create'))
      expect(button('Review and approve')).toBeUndefined()
      expect(container.textContent).toContain(
        'approving it requires more permissions than you have'
      )
      expect(button('Deny')).toBeDefined()
    })

    test('removing a grant needs no Connection permission', async () => {
      setPermissions({ AgentRequests: ['read', 'update'] })
      await renderWith(actionRequest('agent_connection.remove'))

      expect(button('Review and approve')).toBeDefined()
    })

    test('an action of an unknown type can only be denied', async () => {
      await renderWith(actionRequest('something.new', { actionReview: null }))

      expect(button('Review and approve')).toBeUndefined()
      expect(button('Set up Connection')).toBeUndefined()
      expect(container.textContent).toContain('cannot apply')
      expect(button('Deny')).toBeDefined()
    })

    test('a resolved one keeps its review, with the applied action', async () => {
      await renderWith(
        actionRequest('agent_connection.update', {
          status: 'approved',
          resolvedAt: '2026-09-08T00:00:00Z',
          appliedAction: { type: 'agent_connection.update', version: 1 },
          approval: { version: 1, assurance: 'session' },
        })
      )

      expect(container.querySelector('[data-action-review="request-1"]')).not.toBeNull()
      expect(button('Review and approve')).toBeUndefined()
      expect(button('Deny')).toBeUndefined()
    })
  })
})
