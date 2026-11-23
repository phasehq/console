import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import AgentConnectionsPage from '@/app/[team]/agents/connections/page'

jest.mock('@/graphql/queries/agents/getAgentAssets.gql', () => ({
  GetAgentAssets: Symbol('GetAgentAssets'),
}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  SetAgentConnectionPolicyOp: Symbol('SetAgentConnectionPolicyOp'),
  ApproveAgentConnectionHostRulesOp: Symbol('ApproveAgentConnectionHostRulesOp'),
  DeleteAgentConnectionOp: Symbol('DeleteAgentConnectionOp'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
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
jest.mock('@/components/agents/AgentConnectionDialogs', () => ({
  CreateConnectionDialog: () => null,
  UpdateConnectionDialog: () => <button type="button">Edit</button>,
}))
jest.mock('@/components/agents/AppConnectionDialogs', () => ({
  EditAppConnectionDialog: () => <button type="button">Edit</button>,
}))
jest.mock('@/components/agents/CustomConnectionDialogs', () => ({
  CustomConnectionSummary: ({ definition }: any) => (
    <div data-summary>{definition.hosts.map((rule: any) => rule.value).join(', ')}</div>
  ),
  EditCustomConnectionDialog: () => <button type="button">Edit</button>,
}))
jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({
    actionLabel,
    triggerVariant,
    triggerProps,
  }: {
    actionLabel: string
    triggerVariant?: string
    triggerProps?: { icon?: { name: string } }
  }) => (
    <button type="button" data-variant={triggerVariant} data-icon={triggerProps?.icon?.name}>
      {actionLabel}
    </button>
  ),
}))
// A dialog is only its button here; the editor is covered in its own tests.
jest.mock('@/components/common/GenericDialog', () => ({
  __esModule: true,
  default: ({ buttonContent }: { buttonContent?: React.ReactNode }) => (
    <button type="button">{buttonContent}</button>
  ),
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/contexts/organisationContext', () => {
  const activeOrganisation = {
    id: 'org-1',
    name: 'acme',
    memberId: 'member-viewer',
    role: {
      permissions: JSON.stringify({
        permissions: {
          AgentConnections: ['read', 'update', 'delete'],
          IntegrationCredentials: ['read'],
          AgentRequests: ['read'],
        },
        app_permissions: {},
        agent_permissions: {},
        global_access: false,
      }),
    },
  }
  return {
    organisationContext: jest
      .requireActual<typeof React>('react')
      .createContext({ activeOrganisation }),
  }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const connection = (
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id,
  name: id,
  serviceType: 'aws',
  state: 'active',
  authentication: { id: `${id}-keys`, name: `${id} keys`, provider: { id: 'aws', name: 'AWS' } },
  config: {},
  updatedAt: '2026-09-07T00:00:00Z',
  hostRulesAuthoredBy: null,
  hostRulesApprovedBy: null,
  hostRulesVersion: `${id}-version-1`,
  hostRulesApprovedVersion: '',
  takesPolicy: true,
  policy: { version: 1, default: 'allow', rules: [] },
  managedPolicies: [
    { id: 'secret_guard', locked: true, rules: [{ class: 'credential_minting', effect: 'block' }] },
  ],
  ...overrides,
})

const override = (id: string, authorId: string, approved = false) =>
  connection(id, {
    config: { hosts: [{ match: 'exact', value: `${id}.storage.internal` }] },
    hostRulesAuthoredBy: { id: authorId },
    hostRulesApprovedBy: approved ? { id: 'member-approver' } : null,
    hostRulesApprovedVersion: approved ? `${id}-version-1` : '',
  })

describe('Agent Connections', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
    ;(useQuery as jest.Mock).mockReturnValue({
      data: {
        agentConnections: [
          connection('built-in'),
          connection('analytics', {
            serviceType: 'postgres',
            takesPolicy: false,
            managedPolicies: [],
            config: { hosts: [{ match: 'exact', value: 'analytics.internal', port: 5432 }] },
            authentication: {
              id: 'analytics-keys',
              name: 'analytics keys',
              provider: { id: 'postgres', name: 'PostgreSQL' },
            },
          }),
          connection('pending', { state: 'pending_credentials', authentication: null }),
          connection('paused', { state: 'disabled' }),
          override('approved', 'member-author', true),
          override('mine', 'member-viewer'),
          override('theirs', 'member-author'),
          connection('guarded', {
            policy: {
              version: 1,
              default: 'allow',
              rules: [
                { class: 'delete', effect: 'block' },
                { match: { methods: ['POST'], path: '/repos/*/*/issues' }, effect: 'ask' },
              ],
            },
          }),
          connection('repos', {
            serviceType: 'github',
            config: { hosts: [{ match: 'exact', value: 'api.github.com', port: 443 }] },
            authentication: {
              id: 'repos-keys',
              name: 'repos keys',
              provider: { id: 'github', name: 'GitHub' },
            },
          }),
        ],
        agentServiceTemplates: [
          {
            serviceType: 'aws',
            displayName: 'AWS',
            provider: 'aws',
            hostRulesMode: 'optional_override',
          },
          {
            serviceType: 'postgres',
            displayName: 'PostgreSQL',
            provider: 'postgres',
            hostRulesMode: 'required_endpoint',
          },
          {
            serviceType: 'github',
            displayName: 'GitHub',
            provider: 'github',
            hostRulesMode: 'credential_endpoint',
          },
        ],
      },
      loading: false,
      error: undefined,
      refetch: jest.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<AgentConnectionsPage />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const rows = () =>
    Array.from(container.querySelectorAll<HTMLElement>('tbody[data-connection-row]'))
  const row = (name: string) =>
    rows().find((body) => body.querySelector('h3')?.textContent === name)!
  const cells = (name: string) => Array.from(row(name).querySelector('tr')!.children)
  const button = (scope: Element, label: string) =>
    Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent === label
    )
  const toggle = (name: string) =>
    row(name).querySelector<HTMLButtonElement>('button[aria-expanded]')!
  const expand = async (name: string) => act(async () => toggle(name).click())
  const details = (name: string) => row(name).querySelectorAll('tr')[1]
  const search = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search Connections"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const names = () => rows().map((body) => body.querySelector('h3')!.textContent)

  test('lists each Connection as one compact row: name, service and a one-line summary', () => {
    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      '',
      'Connection',
      'Service',
      'Host, credential or app',
      'Actions',
    ])
    expect(rows()).toHaveLength(9)
    // Collapsed by default: one line each.
    expect(rows().every((body) => body.querySelectorAll('tr').length === 1)).toBe(true)

    const [, identity, service, summary] = cells('built-in')
    expect(identity.querySelector('[role="img"][aria-label="AWS"]')).not.toBeNull()
    expect(identity.textContent).toBe('built-in')
    expect(service.textContent).toBe('AWS')
    expect(summary.textContent).toBe('built-in keys')
    // Secondary details stay out of the row until it is opened.
    expect(row('built-in').textContent).not.toContain('Built-in hosts')
    expect(row('built-in').querySelector('a')).toBeNull()
  })

  test('a service with its own mark shows it and its name, not the generic fallback', () => {
    const [, identity, service] = cells('repos')
    expect(identity.querySelector('[role="img"][aria-label="GitHub"]')).not.toBeNull()
    expect(service.textContent).toBe('GitHub')
  })

  test('hosts taken from the credential are not offered for review', async () => {
    expect(cells('repos')[1].textContent).toBe('repos')
    await expand('repos')
    expect(details('repos').textContent).toContain('Endpointapi.github.com:443Configured endpoint')
    expect(details('repos').textContent).not.toContain('Needs independent review')
  })

  test('says once why a Connection is pending, and badges other inactive states', () => {
    const [, identity, , summary] = cells('pending')
    expect(summary.textContent).toBe('Credentials needed')
    expect(identity.textContent).toBe('pending')
    expect(cells('paused')[1].textContent).toBe('pausedDisabled')
  })

  test('a Connection waiting for its setup request links to Requests instead of offering Edit', () => {
    const actions = cells('pending')[4]
    expect(button(actions, 'Edit')).toBeUndefined()
    expect(actions.querySelector('a')?.getAttribute('href')).toBe('/acme/requests')
    expect(button(cells('built-in')[4], 'Edit')).toBeDefined()
  })

  test('opens and closes a row from its chevron, which names and controls the details', async () => {
    const chevron = toggle('built-in')
    expect(chevron.getAttribute('aria-expanded')).toBe('false')
    expect(chevron.getAttribute('aria-label')).toBe('Show details for built-in')

    await expand('built-in')
    expect(toggle('built-in').getAttribute('aria-expanded')).toBe('true')
    expect(toggle('built-in').getAttribute('aria-label')).toBe('Hide details for built-in')
    const panel = container.querySelector(
      `[id="${toggle('built-in').getAttribute('aria-controls')}"]`
    )!
    expect(details('built-in').contains(panel)).toBe(true)
    // Credential details, the endpoint and the last update live here.
    const link = panel.querySelector('a')!
    expect(link.getAttribute('href')).toBe(
      '/acme/integrations?provider=aws&credential=built-in-keys'
    )
    expect(panel.textContent).toContain('Integration credentialsbuilt-in keys · AWS')
    expect(panel.textContent).toContain('EndpointBuilt-in hosts')
    expect(panel.textContent).toMatch(/Updated.*ago/)
    // Other rows stay closed.
    expect(row('analytics').querySelectorAll('tr')).toHaveLength(1)

    await expand('built-in')
    expect(toggle('built-in').getAttribute('aria-expanded')).toBe('false')
    expect(row('built-in').querySelectorAll('tr')).toHaveLength(1)
  })

  test('opens a row from a click anywhere on it, but not from its actions', async () => {
    await act(async () =>
      cells('built-in')[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(toggle('built-in').getAttribute('aria-expanded')).toBe('true')

    await act(async () => button(row('analytics'), 'Edit')!.click())
    expect(toggle('analytics').getAttribute('aria-expanded')).toBe('false')
  })

  test('shows override hosts with their review state, and summarises Postgres endpoints', async () => {
    await expand('approved')
    await expand('theirs')
    await expand('analytics')

    expect(details('approved').textContent).toContain(
      'Endpointapproved.storage.internalApproved override'
    )
    expect(details('theirs').textContent).toContain(
      'Endpointtheirs.storage.internalCustom host override'
    )
    // Postgres hosts come from the credentials, so the list does not repeat them.
    expect(details('analytics').textContent).toContain('EndpointConfigured endpoint')
  })

  test('badges a pending override review on its row and puts the review in the details', async () => {
    expect(cells('approved')[1].textContent).toBe('approved')
    expect(cells('mine')[1].textContent).toBe('mineNeeds review')
    expect(cells('theirs')[1].textContent).toBe('theirsNeeds review')

    await expand('approved')
    await expand('mine')
    await expand('theirs')
    expect(button(row('approved'), 'Approve reviewed version')).toBeUndefined()
    expect(details('mine').textContent).toContain(
      'Waiting for another authorized member to approve'
    )
    expect(button(row('mine'), 'Approve reviewed version')).toBeUndefined()

    const approve = button(row('theirs'), 'Approve reviewed version')!
    expect(approve.parentElement!.lastElementChild).toBe(approve)
    expect(approve.parentElement!.firstElementChild!.textContent).toBe(
      'Needs independent reviewVersion theirs-v'
    )
  })

  test('shows Edit and a red Delete with the trash can on row hover, always on touch screens', () => {
    const body = row('approved')
    expect(body.classList).toContain('group')
    const remove = button(body, 'Delete')!
    expect(remove.dataset.variant).toBe('danger')
    expect(remove.dataset.icon).toBe('FaTrashAlt')
    const actions = remove.parentElement!
    expect(button(actions, 'Edit')).toBeDefined()
    expect(actions.className).toContain('[@media(hover:hover)]:group-hover:opacity-100')
    expect(actions.className).toContain('[@media(hover:hover)]:focus-within:opacity-100')
    // Hidden only where the pointer can hover; touch screens always show the buttons.
    expect(actions.className).toContain('[@media(hover:hover)]:opacity-0')
    expect(actions.classList).not.toContain('opacity-0')
  })

  describe('access rules', () => {
    const blocks = (name: string) => details(name).querySelector('[aria-label="Access rules"]')
    const managed = (name: string) => details(name).querySelector('[aria-label="Managed by Phase"]')

    test('the collapsed row says how much is restricted, and only when something is', () => {
      expect(cells('guarded')[1].textContent).toBe('guarded1 blocked, 1 ask')
      expect(cells('built-in')[1].textContent).toBe('built-in')
      // PostgreSQL takes no rules.
      expect(cells('analytics')[1].textContent).toBe('analytics')
    })

    test('the details start with Managed by Phase, then the Connection own rules with Edit', async () => {
      await expand('guarded')
      const headings = Array.from(details('guarded').querySelectorAll('h4')).map(
        (heading) => heading.textContent
      )
      expect(headings).toEqual(['Managed by Phase', 'Access rules'])
      expect(managed('guarded')!.textContent).toContain('Secret guard')
      expect(managed('guarded')!.textContent).toContain('cannot be turned off')
      const rules = details('guarded').querySelector('[aria-label="Access rules in force"]')!
      expect(rules.textContent).toContain('DeleteBlock')
      expect(rules.textContent).toContain('POST /repos/*/*/issuesAsk')
      expect(button(blocks('guarded')!, 'Edit')).toBeDefined()
    })

    test('a Connection that takes no rules shows neither block', async () => {
      await expand('analytics')
      expect(managed('analytics')).toBeNull()
      expect(blocks('analytics')).toBeNull()
    })
  })

  describe('search', () => {
    test('filters by Connection name', async () => {
      await search('ANALYT')
      expect(names()).toEqual(['analytics'])
    })

    test('filters by service', async () => {
      await search('postgres')
      expect(names()).toEqual(['analytics'])
    })

    test('filters by host', async () => {
      await search('theirs.storage')
      expect(names()).toEqual(['theirs'])
      await search('5432')
      expect(names()).toEqual(['analytics'])
    })

    test('says when nothing matches, and the clear button brings the list back', async () => {
      await search('no-such-connection')

      expect(rows()).toHaveLength(0)
      expect(container.querySelector('table')).toBeNull()
      expect(container.textContent).toContain('No matching Connections')
      expect(container.textContent).toContain('Try a different Connection, service, host or app.')

      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click()
      )
      expect(rows()).toHaveLength(9)
    })

    test('keeps an opened row open while the list is filtered', async () => {
      await expand('analytics')
      await search('analytics')
      expect(toggle('analytics').getAttribute('aria-expanded')).toBe('true')
    })
  })
})

describe('custom HTTP Connections in the list', () => {
  let container: HTMLDivElement
  let root: Root

  const custom = (id: string, overrides: Record<string, unknown> = {}) =>
    connection(id, {
      serviceType: 'http',
      authentication: null,
      definition: {
        specVersion: 1,
        hosts: [
          { match: 'exact', value: 'api.example.com', path: '/v1/*' },
          { match: 'suffix', value: '.example.net' },
        ],
        fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' } }],
        injections: [{ type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'token' }],
        preset: 'bearer',
      },
      encryptionPublicKey: 'a'.repeat(64),
      valueRevision: 3,
      valueUpdatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      valueUpdatedBy: { id: 'member-1', fullName: 'Alice Example', email: 'alice@example.com' },
      ...overrides,
    })

  const render = async (connections: Array<Record<string, unknown>>) => {
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentConnections: connections, agentServiceTemplates: [] },
      loading: false,
      error: undefined,
      refetch: jest.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<AgentConnectionsPage />))
  }

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const body = (name: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('tbody[data-connection-row]')).find(
      (candidate) => candidate.querySelector('h3')?.textContent === name
    )!
  const labels = (scope: Element) =>
    Array.from(scope.querySelectorAll('button')).map((element) => element.textContent)

  const expand = async (name: string) =>
    act(async () => body(name).querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())

  test('shows its first host on one line instead of missing credentials or a host review', async () => {
    await render([custom('example-api')])

    expect(body('example-api').querySelectorAll('tr')).toHaveLength(1)
    const [, identity, service, summary] = Array.from(
      body('example-api').querySelector('tr')!.children
    )
    expect(identity.querySelector('[role="img"][aria-label="Custom HTTP"]')).not.toBeNull()
    expect(identity.textContent).toBe('example-api')
    expect(service.textContent).toBe('Custom HTTP')
    expect(summary.textContent).toBe('api.example.com/v1/*+1 more')
    expect(container.textContent).not.toContain('Credentials needed')
    // Its hosts are part of its definition, not an override waiting on a second member.
    expect(container.textContent).not.toContain('Needs review')
    expect(container.textContent).not.toContain('Custom host override')
  })

  test('keeps every host, where the secret goes and the last value update for the details', async () => {
    await render([custom('example-api')])
    expect(container.querySelector('[data-summary]')).toBeNull()
    expect(container.textContent).not.toContain('Value updated')

    await expand('example-api')
    const detail = body('example-api').querySelectorAll('tr')[1]
    expect(detail.querySelector('[data-summary]')!.textContent).toBe(
      'api.example.com, .example.net'
    )
    expect(detail.textContent).toContain('SecretSealed secret · Bearer token')
    expect(detail.textContent).toContain('Value updated2 days ago by Alice Example')
    expect(detail.textContent).not.toContain('Server-readable')
    expect(detail.textContent).not.toContain('Phase can open this value')
    expect(detail.textContent).not.toContain('Key version')
  })

  test('is found by any of its hosts', async () => {
    await render([custom('example-api'), connection('built-in')])
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search Connections"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        'example.net'
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(
      Array.from(container.querySelectorAll('tbody[data-connection-row] h3')).map(
        (heading) => heading.textContent
      )
    ).toEqual(['example-api'])
  })

  test('offers exactly two actions: edit and delete', async () => {
    await render([custom('example-api')])

    expect(labels(body('example-api')).filter(Boolean)).toEqual(['Edit', 'Delete'])
    expect(container.textContent).not.toContain('Update secret')
    expect(container.textContent).not.toContain('Rotate key')
  })
})
