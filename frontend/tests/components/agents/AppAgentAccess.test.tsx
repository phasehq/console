import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useQuery } from '@apollo/client'
import AppAgents from '@/app/[team]/apps/[app]/access/agents/page'
import { AgentActor } from '@/components/agents/AgentActor'
import { GetAppAgentAccess } from '@/graphql/queries/apps/getAppAgentAccess.gql'
import { AGENT_HARNESS_META } from '@/components/agents/AgentBrandIcons'
import {
  policySummary,
  describeAppAccess,
  formatAccessTime,
  readAppAccess,
} from '@/utils/agents/appAccess'

jest.mock('@/graphql/queries/getApps.gql', () => ({ GetApps: Symbol('GetApps') }))
jest.mock('@/graphql/queries/apps/getAppAgentAccess.gql', () => ({
  GetAppAgentAccess: Symbol('GetAppAgentAccess'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
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
jest.mock('@/components/agents/AgentGrantExtras', () => ({
  GrantExpiryText: ({ expiresAt }: { expiresAt: string }) => <time>Ends {expiresAt}</time>,
}))
let canRead = true
jest.mock('@/hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({ hasPermission: () => canRead }),
}))
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest
    .requireActual<typeof React>('react')
    .createContext({ activeOrganisation: { id: 'org-1', name: 'acme' } }),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const WRITE_UNTIL = '2026-12-01T14:00:00Z'

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'grant-1',
  agent: { id: 'agent-1', name: 'deploy-bot' },
  workflow: { id: 'wf-1', name: 'Default' },
  connection: { id: 'c-1', name: 'orders secrets' },
  environments: [
    { id: 'env-dev', name: 'Development', envType: 'dev' },
    { id: 'env-stg', name: 'Staging', envType: 'staging' },
  ],
  access: {
    read: { effect: 'allow' },
    create: { effect: 'allow', until: WRITE_UNTIL },
    update: { effect: 'allow', until: WRITE_UNTIL },
    delete: { effect: 'allow', until: WRITE_UNTIL },
  },
  expiresAt: null,
  ...overrides,
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  canRead = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  jest.clearAllMocks()
})

describe('the Agents tab of an app', () => {
  const render = async (rows: unknown[], sseEnabled = true) => {
    ;(useQuery as jest.Mock).mockImplementation((document) =>
      document === GetAppAgentAccess
        ? { data: { appAgentAccess: rows }, loading: false }
        : { data: { apps: [{ id: 'app-1', sseEnabled }] }, loading: false }
    )
    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <AppAgents params={Promise.resolve({ team: 'acme', app: 'app-1' })} />
        </Suspense>
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const cells = () =>
    Array.from(container.querySelectorAll('tbody tr')).map((tableRow) =>
      Array.from(tableRow.children).map((cell) => cell.textContent)
    )

  test('a failed read says so instead of showing no Agents', async () => {
    ;(useQuery as jest.Mock).mockImplementation((document) =>
      document === GetAppAgentAccess
        ? { data: undefined, loading: false, error: new Error('Network error'), refetch: jest.fn() }
        : { data: { apps: [{ id: 'app-1', sseEnabled: true }] }, loading: false }
    )
    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <AppAgents params={Promise.resolve({ team: 'acme', app: 'app-1' })} />
        </Suspense>
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(container.textContent).toContain('Network error')
    expect(container.textContent).not.toContain('No Agents')
  })

  test('lists each Workflow with access, linking the Agent', async () => {
    await render([
      row(),
      row({
        id: 'grant-2',
        expiresAt: '2026-11-20T00:00:00Z',
        access: {
          read: { effect: 'allow' },
          create: { effect: 'ask' },
          update: { effect: 'ask' },
          delete: { effect: 'block' },
        },
      }),
    ])

    expect(Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent)).toEqual([
      'Agent',
      'Workflow',
      'Connection',
      'Environments',
      'Access',
      'Ends',
    ])
    const [first, second] = cells()
    expect(first.slice(0, 4)).toEqual([
      'deploy-bot',
      'Default',
      'orders secrets',
      'Development, Staging',
    ])
    expect(first[4]).toBe(`Read, and write until ${formatAccessTime(WRITE_UNTIL)}`)
    expect(first[5]).toBe('Until revoked')
    expect(second[4]).toBe('ReadCreate and update ask, delete blocked')
    expect(second[5]).toBe('Ends 2026-11-20T00:00:00Z')
    expect(container.querySelector('a[href="/acme/agents/agent-1"]')!.textContent).toBe(
      'deploy-bot'
    )
    expect(container.querySelector('a[href="/acme/agents/agent-1?tab=workflows"]')).not.toBeNull()
    expect(container.textContent).not.toContain('read_write')
  })

  test('environments the viewer cannot access are counted, not named', async () => {
    await render([
      row({
        connection: { id: 'c-1', name: 'orders secrets' },
        environments: [{ id: 'env-dev', name: 'Development', envType: 'dev' }],
        hiddenEnvironmentCount: 2,
      }),
    ])
    expect(cells()[0][3]).toBe("Development+2 more you can't access")
  })

  test('with no access, the standard empty state', async () => {
    await render([])
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('No Agents')
    expect(container.textContent).toContain('Grant a Workflow an App secrets Connection')
  })

  test('an app without server-side encryption says Agent access needs it', async () => {
    await render([], false)
    expect(container.textContent).toContain(
      "Agent access needs server-side encryption. Enable it in the app's settings."
    )
  })

  test('without permission it says access is restricted', async () => {
    canRead = false
    await render([])
    expect(container.textContent).toContain('Access restricted')
  })
})

describe('an Agent as the actor of a secret event', () => {
  const agent = { id: 'agent-1', name: 'deploy-bot', harnessType: 'CLAUDE_CODE', deleted: false }

  test('shows its harness mark and name, linking to the Agent', async () => {
    await act(async () => root.render(<AgentActor agent={agent} team="acme" />))

    const link = container.querySelector<HTMLAnchorElement>('a')!
    expect(link.getAttribute('href')).toBe('/acme/agents/agent-1')
    expect(link.textContent).toBe('deploy-bot')
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('text-[#D97757]')
  })

  test('a deleted Agent keeps its name, struck through, with no link', async () => {
    await act(async () =>
      root.render(<AgentActor agent={{ ...agent, deleted: true }} team="acme" />)
    )

    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('.line-through')!.textContent).toBe('deploy-bot')
    expect(container.textContent).toContain('(Deleted)')
  })
})

describe('app access in words', () => {
  test('reads, writes and their limits', () => {
    expect(
      describeAppAccess(
        readAppAccess({
          read: { effect: 'allow' },
          create: { effect: 'allow' },
          update: { effect: 'allow' },
          delete: { effect: 'allow' },
        })
      )
    ).toEqual({ allowed: 'Read and write', restricted: '' })
    expect(
      describeAppAccess(
        readAppAccess({
          read: { effect: 'allow' },
          create: { effect: 'ask' },
          update: { effect: 'ask' },
          delete: { effect: 'ask' },
        })
      )
    ).toEqual({ allowed: 'Read', restricted: 'Writes ask' })
    // Anything unreadable is treated as blocked, never as allowed.
    expect(describeAppAccess(readAppAccess(null))).toEqual({
      allowed: 'Nothing yet',
      restricted: 'Reads and writes blocked',
    })
  })

  test('the rules of an app Connection in a few words', () => {
    expect(
      policySummary({
        version: 1,
        default: 'allow',
        rules: ['create', 'update', 'delete'].map((name) => ({ class: name, effect: 'ask' })),
      })
    ).toBe('Reads allowed, writes ask')
    expect(
      policySummary({
        version: 1,
        default: 'allow',
        rules: [{ class: 'delete', effect: 'block' }],
      })
    ).toBe('Reads, creates and updates allowed, deletes blocked')
    expect(policySummary(null)).toBe('Reads and writes allowed')
    // Rows on Default take its effect.
    expect(
      policySummary({ version: 1, default: 'ask', rules: [{ class: 'read', effect: 'allow' }] })
    ).toBe('Reads allowed, writes ask')
  })
})

describe('Devin', () => {
  test('is not a harness the Console offers', () => {
    expect(AGENT_HARNESS_META.map((meta) => meta.value)).not.toContain('devin')
    expect(AGENT_HARNESS_META.map((meta) => meta.label)).not.toContain('Devin')
  })
})
