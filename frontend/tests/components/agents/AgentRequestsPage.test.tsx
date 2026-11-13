import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import AgentRequestsPage from '@/app/[team]/requests/page'

jest.mock('@/graphql/queries/agents/getAgentRequests.gql', () => ({
  GetAgentRequests: Symbol('GetAgentRequests'),
  GetAgentRequestQueue: Symbol('GetAgentRequestQueue'),
}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  ResolveAgentRequestOp: Symbol('ResolveAgentRequestOp'),
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
  REQUEST_QUEUE_FILTER: 'queue',
  AgentRequestStatusFilter: ({ value, onChange, defaultValue, showQueue }: any) => (
    <div data-filter={value} data-default={defaultValue} data-show-queue={String(showQueue)}>
      <button type="button" onClick={() => onChange('')}>
        All requests
      </button>
      <button type="button" onClick={() => onChange('queue')}>
        Waiting for you
      </button>
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

describe('Agent request cards', () => {
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

  const { GetAgentRequests, GetAgentRequestQueue } = jest.requireMock(
    '@/graphql/queries/agents/getAgentRequests.gql'
  )
  // The list, the member's queue (its pending requests), and a linked-request lookup by ID.
  const answer = (list: any[], { linked = list, error }: { linked?: any[]; error?: Error } = {}) =>
    (useQuery as jest.Mock).mockImplementation((query: unknown, options: any) => {
      const waiting = list.filter((item) => item.status === 'pending')
      return {
        data:
          query === GetAgentRequestQueue
            ? {
                agentRequestQueue: {
                  requests: waiting.slice(0, options?.variables?.limit),
                  pendingCount: waiting.length,
                },
              }
            : { agentRequests: options?.variables?.requestId ? linked : list },
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
    markdown: `Proposal for ${id}`,
    resolvedAt: status === 'pending' ? null : '2026-09-08T00:00:00Z',
    ...extra,
  })
  const limitsOf = (document: unknown) =>
    (useQuery as jest.Mock).mock.calls
      .filter(([query, options]) => query === document && !options?.variables?.requestId)
      .map(([, options]) => options.variables.limit)
  const listLimits = () => limitsOf(GetAgentRequests)
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (element) => element.textContent === label
    )

  test('loads 25 requests at a time, asking for one more to know there is more', async () => {
    await renderPage(
      Array.from({ length: 26 }, (_, index) => request(`request-${index + 10}`, 'denied'))
    )
    // Nothing waits on the member, so the full list is one click away.
    await act(async () => button('View all requests')!.click())

    expect(container.querySelectorAll('article')).toHaveLength(25)
    expect(listLimits().at(-1)).toBe(26)

    await act(async () => button('Load more')!.click())
    // The window grows; the requests already loaded stay polled with it.
    expect(listLimits().at(-1)).toBe(51)
    expect(container.querySelectorAll('article')).toHaveLength(26)
    expect(button('Load more')).toBeUndefined()
    expect(container.textContent).toContain('No more requests to show')
  })

  test('collapses resolved requests to their outcome, with Details to open them', async () => {
    await renderPage([request('request-3', 'pending'), request('request-2', 'approved')])
    await act(async () => button('All requests')!.click())

    const [open, resolved] = Array.from(container.querySelectorAll('article'))
    expect(open.textContent).toContain('Proposal for request-3')
    expect(open.textContent).not.toContain('Details')

    // A rule sets the resolved requests apart from the open ones.
    const separator = container.querySelector('[role="separator"]')!
    expect(separator.textContent).toBe('Resolved')
    expect(separator.nextElementSibling).toBe(resolved)

    expect(resolved.textContent).not.toContain('Proposal for request-2')
    expect(resolved.textContent).toContain('Approved')
    const details = Array.from(resolved.querySelectorAll('button')).find(
      (element) => element.textContent === 'Details'
    )!
    expect(details.getAttribute('aria-expanded')).toBe('false')

    await act(async () => details.click())
    expect(details.getAttribute('aria-expanded')).toBe('true')
    expect(resolved.textContent).toContain('Proposal for request-2')
    expect(container.querySelector(`#${details.getAttribute('aria-controls')}`)).not.toBeNull()

    await act(async () => details.click())
    expect(resolved.textContent).not.toContain('Proposal for request-2')
  })

  test('loads a linked request past the window on its own, open', async () => {
    await renderPage([request('request-3', 'pending')], [request('request-1', 'approved')])

    const [linked, other] = Array.from(container.querySelectorAll('article'))
    expect(linked.id).toContain('request-1')
    expect(linked.textContent).toContain('Proposal for request-1')
    expect(other.id).toContain('request-3')
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

  describe('waiting for you', () => {
    const filter = () => container.querySelector<HTMLElement>('[data-filter]')!

    test('members who can resolve requests start on their own queue', async () => {
      await renderPage([request('request-3', 'pending'), request('request-2', 'approved')])

      expect(filter().dataset).toMatchObject({
        filter: 'queue',
        default: 'queue',
        showQueue: 'true',
      })
      // Only what waits on the member; resolved requests stay in the full list.
      expect(Array.from(container.querySelectorAll('article')).map((card) => card.id)).toEqual([
        'agent-request-request-3',
      ])
      expect(limitsOf(GetAgentRequestQueue).at(-1)).toBe(25)
    })

    test('members who can only read requests start on the full list', async () => {
      setPermissions({ AgentRequests: ['read'] })
      await renderPage([request('request-3', 'pending'), request('request-2', 'approved')])

      expect(filter().dataset).toMatchObject({ filter: '', default: '', showQueue: 'false' })
      expect(container.querySelectorAll('article')).toHaveLength(2)
    })

    test('an empty queue offers the full list, centred, with no controls above it', async () => {
      await renderPage([request('request-2', 'approved')])

      expect(container.textContent).toContain('Nothing is waiting for you')
      expect(container.querySelector('[data-filter]')).toBeNull()
      await act(async () => button('View all requests')!.click())

      expect(container.querySelectorAll('article')).toHaveLength(1)
      expect(filter().dataset.filter).toBe('')
      expect(button('View all requests')).toBeUndefined()
    })

    test('loads more of the queue while its count says there is more', async () => {
      await renderPage(
        Array.from({ length: 30 }, (_, index) => request(`request-${index + 10}`, 'pending'))
      )

      expect(container.querySelectorAll('article')).toHaveLength(25)
      await act(async () => button('Load more')!.click())
      expect(limitsOf(GetAgentRequestQueue).at(-1)).toBe(50)
      expect(container.querySelectorAll('article')).toHaveLength(30)
      expect(button('Load more')).toBeUndefined()
    })

    test('a linked request shows even when it no longer waits on anyone', async () => {
      await renderPage([request('request-3', 'pending')], [request('request-1', 'denied')])

      expect(Array.from(container.querySelectorAll('article')).map((card) => card.id)).toEqual([
        'agent-request-request-1',
        'agent-request-request-3',
      ])
    })
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
      expect(container.textContent).not.toContain("The Agent's note")
      expect(container.textContent).not.toContain('No proposal supplied.')

      await renderWith(actionRequest('agent_connection.update', { markdown: 'Needed for /v2.' }))
      expect(container.textContent).toContain("The Agent's note")
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
        'approving it requires permission to manage Agent Connections'
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
