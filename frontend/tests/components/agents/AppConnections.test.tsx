import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import AgentConnectionsPage from '@/app/[team]/agents/connections/page'
import {
  CreateAppConnectionForm,
  EditAppConnectionDialog,
} from '@/components/agents/AppConnectionDialogs'
import { PolicyEditor } from '@/components/agents/AgentAccessPolicy'
import { GrantTemporaryAllows } from '@/components/agents/AgentGrantExtras'
import { GetAgentAssets } from '@/graphql/queries/agents/getAgentAssets.gql'
import { draftFromPolicy } from '@/utils/agents/accessPolicy'
import { buttonNamed, click, field, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/queries/agents/getAgentAssets.gql', () => ({
  GetAgentAssets: Symbol('GetAgentAssets'),
}))
jest.mock('@/graphql/queries/getApps.gql', () => ({ GetApps: Symbol('GetApps') }))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  CreateAgentAppConnectionOp: 'create-app',
  UpdateAgentAppConnectionOp: 'update-app',
  SetAgentConnectionPolicyOp: 'set-policy',
  ApproveAgentConnectionHostRulesOp: 'approve-hosts',
  DeleteAgentConnectionOp: 'delete',
}))
jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  GrantAgentWorkflowOp: 'grant',
  RemoveAgentWorkflowGrantAllowOp: 'remove-allow',
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
jest.mock('@/components/agents/CustomConnectionDialogs', () => ({
  CustomConnectionSummary: () => null,
  EditCustomConnectionDialog: () => <button type="button">Edit</button>,
}))
jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({ actionLabel, title, triggerProps, onConfirm }: any) => (
    <button
      type="button"
      aria-label={triggerProps?.['aria-label'] ?? title}
      onClick={() => onConfirm?.()}
    >
      {actionLabel}
    </button>
  ),
  GrantWorkflowDialog: () => null,
}))
jest.mock('@/components/common/GenericDialog', () =>
  jest.requireActual('./customConnectionTestKit').dialogMock()
)
// The shared select, with the disabled flag an app without encryption carries.
jest.mock('@/components/agents/AgentSelect', () => ({
  AgentSelect: ({ id, value, onChange, options, placeholder }: any) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
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
        permissions: { AgentConnections: ['read', 'create', 'update', 'delete'] },
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

const DEFAULT_POLICY = {
  version: 1,
  default: 'allow',
  rules: ['create', 'update', 'delete'].map((name) => ({ class: name, effect: 'ask' })),
}

const fifteen = Array.from({ length: 15 }, (_, index) => ({
  id: `env-${index + 1}`,
  name: `Environment number ${index + 1}`,
  envType: 'custom',
}))

const appConnection = (overrides: Record<string, unknown> = {}) => ({
  id: 'app-connection',
  name: 'orders secrets',
  serviceType: 'phase_app',
  state: 'active',
  takesPolicy: true,
  policy: DEFAULT_POLICY,
  managedPolicies: [],
  authentication: null,
  config: null,
  definition: null,
  app: { id: 'app-1', name: 'orders', sseEnabled: true },
  environments: [
    { id: 'env-dev', name: 'Development', envType: 'dev' },
    { id: 'env-stg', name: 'Staging', envType: 'staging' },
  ],
  updatedAt: '2026-11-17T00:00:00Z',
  hostRulesAuthoredBy: null,
  hostRulesApprovedBy: null,
  hostRulesVersion: 'v1',
  hostRulesApprovedVersion: '',
  ...overrides,
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  jest.clearAllMocks()
})

describe('app Connections on the Connections page', () => {
  const render = async (connections: unknown[]) => {
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
    ;(useQuery as jest.Mock).mockImplementation((document) =>
      document === GetAgentAssets
        ? {
            data: { agentConnections: connections, agentServiceTemplates: [] },
            loading: false,
            refetch: jest.fn(),
          }
        : { data: undefined }
    )
    await act(async () => root.render(<AgentConnectionsPage />))
  }
  const row = (name: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('tbody[data-connection-row]')).find(
      (body) => body.querySelector('h3')?.textContent === name
    )!
  const expand = async (name: string) =>
    act(async () => row(name).querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())

  test('the collapsed row names the service, the app and the rules in a few words', async () => {
    await render([appConnection()])
    const cells = Array.from(row('orders secrets').querySelector('tr')!.children)

    expect(cells[1].textContent).toContain('Reads allowed, writes ask')
    expect(cells[2].textContent).toBe('App secrets')
    expect(cells[3].textContent).toBe('orders2 environments')
    expect(buttonNamed(row('orders secrets'), 'Edit')).toBeDefined()
    expect(row('orders secrets').textContent).not.toContain('phase_app')
  })

  test('one environment is named on the row', async () => {
    await render([appConnection({ environments: [{ id: 'e', name: 'Production' }] })])
    expect(row('orders secrets').querySelector('tr')!.children[3].textContent).toBe(
      'ordersProduction'
    )
  })

  test('the expanded row links the app, names the environments and shows four rules, nothing managed', async () => {
    await render([appConnection()])
    await expand('orders secrets')
    const details = row('orders secrets').querySelectorAll('tr')[1]

    const link = details.querySelector<HTMLAnchorElement>('a[href="/acme/apps/app-1"]')!
    expect(link.textContent).toBe('orders')
    expect(details.textContent).toContain('Development, Staging')
    const rules = details.querySelector('[aria-label="Access rules in force"]')!
    expect(Array.from(rules.querySelectorAll('li')).map((item) => item.textContent)).toEqual([
      'ReadAllow',
      'CreateAsk',
      'UpdateAsk',
      'DeleteAsk',
    ])
    expect(details.textContent).not.toContain('Everything else')
    expect(details.textContent).not.toContain('Managed by Phase')
    expect(details.textContent).not.toContain('Integration credentials')
  })

  test('the layout holds fifteen environments: the row counts them, the details list them', async () => {
    await render([appConnection({ environments: fifteen })])
    expect(row('orders secrets').querySelector('tr')!.children[3].textContent).toContain(
      '15 environments'
    )
    await expand('orders secrets')
    expect(row('orders secrets').textContent).toContain('Environment number 15')
  })

  test('a Connection whose app was deleted says so and offers only delete', async () => {
    await render([appConnection({ app: null })])
    const body = row('orders secrets')

    expect(body.querySelector('tr')!.children[3].textContent).toBe('App deleted')
    expect(buttonNamed(body, 'Edit')).toBeUndefined()
    expect(buttonNamed(body, 'Delete')).toBeDefined()
    expect(body.textContent).not.toContain('Reads allowed')
    await expand('orders secrets')
    expect(row('orders secrets').textContent).toContain(
      'The app this Connection covered was deleted'
    )
    expect(row('orders secrets').querySelector('[aria-label="Access rules"]')).toBeNull()
  })

  test('search finds an app Connection by its app and environment', async () => {
    await render([
      appConnection(),
      appConnection({
        id: 'other',
        name: 'billing',
        app: { id: 'a2', name: 'billing-api' },
        environments: [{ id: 'x', name: 'QA' }],
      }),
    ])
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search Connections"]'
    )!
    await type(input, 'qa')
    expect(container.querySelectorAll('tbody[data-connection-row]')).toHaveLength(1)
    expect(container.textContent).toContain('billing-api')
  })
})

describe('creating an app Connection', () => {
  let create: jest.Mock
  const apps = [
    {
      id: 'app-1',
      name: 'orders',
      sseEnabled: true,
      environments: [
        { id: 'env-dev', name: 'Development', envType: 'dev' },
        { id: 'env-stg', name: 'Staging', envType: 'staging' },
        { id: 'env-prd', name: 'Production', envType: 'prod' },
      ],
    },
    { id: 'app-2', name: 'legacy', sseEnabled: false, environments: [] },
  ]

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({})
    ;(useMutation as jest.Mock).mockReturnValue([create, { loading: false }])
    ;(useQuery as jest.Mock).mockReturnValue({ data: { apps }, loading: false })
  })

  const render = async (onCreated = jest.fn()) => {
    await act(async () =>
      root.render(
        <CreateAppConnectionForm
          organisationId="org-1"
          serviceSelect={<div>Service</div>}
          onCreated={onCreated}
        />
      )
    )
    return onCreated
  }
  const appSelect = () => container.querySelector<HTMLSelectElement>('select[id$="-app"]')!
  const chooseApp = async (value: string) =>
    act(async () => {
      appSelect().value = value
      appSelect().dispatchEvent(new Event('change', { bubbles: true }))
    })
  const checkbox = (name: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')).find(
      (box) => box.textContent === name
    )!

  test('lists apps without server-side encryption, disabled, with the reason', async () => {
    await render()
    const legacy = Array.from(appSelect().options).find((option) => option.value === 'app-2')!

    expect(legacy.disabled).toBe(true)
    expect(Array.from(appSelect().options).find((o) => o.value === 'app-1')!.disabled).toBe(false)
    expect(container.textContent).toContain(
      "Agent access needs server-side encryption. Enable it in the app's settings."
    )
  })

  test('choosing an app ticks its environments and names the Connection after it', async () => {
    await render()
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(true)
    await chooseApp('app-1')

    expect(
      ['Development', 'Staging', 'Production'].map((name) =>
        checkbox(name).getAttribute('aria-checked')
      )
    ).toEqual(['true', 'true', 'true'])
    expect(field(container, 'Connection name').value).toBe('orders secrets')
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(false)
  })

  test('needs at least one environment and a name', async () => {
    await render()
    await chooseApp('app-1')
    for (const name of ['Development', 'Staging', 'Production'])
      await act(async () => checkbox(name).click())

    expect(container.textContent).toContain('Choose at least one environment.')
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(true)

    await act(async () => checkbox('Staging').click())
    await type(field(container, 'Connection name'), '  ')
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(true)
  })

  test('creates with the chosen environments and the name as typed', async () => {
    const onCreated = await render()
    await chooseApp('app-1')
    await act(async () => checkbox('Production').click())
    await type(field(container, 'Connection name'), 'Orders, not production')
    await click(container, 'Create Connection')
    await settle(() => onCreated.mock.calls.length > 0)

    expect(create.mock.calls[0][0].variables).toEqual({
      organisationId: 'org-1',
      name: 'Orders, not production',
      appId: 'app-1',
      environmentIds: ['env-dev', 'env-stg'],
    })
  })

  test('shows a refusal from the server', async () => {
    create.mockRejectedValue(new Error('You cannot read the secrets of every chosen environment.'))
    await render()
    await chooseApp('app-1')
    await click(container, 'Create Connection')
    await settle(() => !!container.querySelector('[role="alert"]'))

    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'You cannot read the secrets of every chosen environment.'
    )
  })
})

describe('editing an app Connection', () => {
  test('sends only what changed: the environments', async () => {
    const save = jest.fn().mockResolvedValue({})
    ;(useMutation as jest.Mock).mockReturnValue([save, { loading: false }])
    ;(useQuery as jest.Mock).mockReturnValue({
      data: {
        apps: [
          {
            id: 'app-1',
            name: 'orders',
            sseEnabled: true,
            environments: [
              { id: 'env-dev', name: 'Development' },
              { id: 'env-stg', name: 'Staging' },
              { id: 'env-prd', name: 'Production' },
            ],
          },
        ],
      },
    })
    await act(async () =>
      root.render(<EditAppConnectionDialog connection={appConnection() as any} />)
    )
    await click(container, 'Edit')
    expect(buttonNamed(container, 'Save Connection')!.disabled).toBe(true)

    const production = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')
    ).find((box) => box.textContent === 'Production')!
    expect(production.getAttribute('aria-checked')).toBe('false')
    await act(async () => production.click())
    await click(container, 'Save Connection')
    await settle(() => save.mock.calls.length > 0)

    expect(save.mock.calls[0][0].variables).toEqual({
      connectionId: 'app-connection',
      environmentIds: ['env-dev', 'env-stg', 'env-prd'],
    })
  })
})

describe('the rules editor for an app Connection', () => {
  test('offers only read, create, update and delete, with no other rules', async () => {
    const onChange = jest.fn()
    await act(async () =>
      root.render(
        <PolicyEditor draft={draftFromPolicy(DEFAULT_POLICY)} onChange={onChange} variant="app" />
      )
    )
    const groups = Array.from(container.querySelectorAll('[role="radiogroup"]')).map((group) =>
      group.getAttribute('aria-label')
    )

    expect(groups).toEqual(['Read calls', 'Create calls', 'Update calls', 'Delete calls'])
    expect(container.textContent).toContain('List secrets and read their values')
    expect(container.textContent).not.toContain('Everything else')
    expect(container.textContent).not.toContain('Advanced')
    expect(container.textContent).not.toContain('Admin')

    const allowDeletes = container.querySelector<HTMLButtonElement>(
      '[aria-label="Delete calls"] [role="radio"]'
    )!
    expect(allowDeletes.textContent).toBe('Allow')
    await act(async () => allowDeletes.click())
    expect(onChange.mock.calls[0][0].classes.delete).toBe('allow')
  })
})

describe('write access on an app grant', () => {
  test('reads "Write access until" with a way to remove it', async () => {
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
    const expiresAt = new Date(Date.now() + 3600_000).toISOString()
    await act(async () =>
      root.render(
        <GrantTemporaryAllows
          canRemove
          grant={{
            id: 'grant-1',
            connection: { name: 'orders secrets', serviceType: 'phase_app' },
            temporaryAllows: ['create', 'update', 'delete'].map((name) => ({
              id: `allow-${name}`,
              class: name,
              expiresAt,
            })),
          }}
        />
      )
    )

    const trigger = container.querySelector(
      'button[aria-label="Open Temporary allows for orders secrets"]'
    )!
    expect(trigger.textContent).toMatch(/^Write access until /)
    expect(container.textContent).toContain('Delete secrets')
    expect(
      container.querySelector('button[aria-label="Remove temporary allow for Delete secrets"]')
    ).not.toBeNull()
  })

  test('another kind of Connection keeps its count of temporary allows', async () => {
    ;(useMutation as jest.Mock).mockReturnValue([jest.fn(), { loading: false }])
    await act(async () =>
      root.render(
        <GrantTemporaryAllows
          canRemove={false}
          grant={{
            id: 'grant-1',
            connection: { name: 'GitHub', serviceType: 'http' },
            temporaryAllows: [
              { id: 'a', class: 'delete', expiresAt: new Date(Date.now() + 60_000).toISOString() },
            ],
          }}
        />
      )
    )
    expect(container.textContent).toContain('Temporary allows (1)')
  })
})
