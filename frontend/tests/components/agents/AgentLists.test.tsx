import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useQuery } from '@apollo/client'
import AgentsPage from '@/app/[team]/agents/all/page'
import AccessAgentsPage from '@/app/[team]/access/agents/page'
import { SiClaude, SiCursor, SiDevin, SiOpenCode } from '@/components/agents/AgentBrandIcons'
import { AgentTime } from '@/components/agents/AgentUI'

jest.mock('@/graphql/queries/agents/getAgents.gql', () => ({
  GetAgents: Symbol('GetAgents'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useQuery: jest.fn(),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
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
  const activeOrganisation = {
    id: 'org-1',
    memberId: 'member-1',
    role: {
      permissions: JSON.stringify({
        permissions: { Agents: ['read'] },
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
jest.mock('@/components/agents/AgentDialogs', () => ({
  CreateAgentDialog: () => null,
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const agent = (id: string, name: string, harnessType: string, status = 'ACTIVE') => ({
  id,
  name,
  harnessType,
  status,
  lastSeenAt: null,
  tokenCount: 0,
  sessionCount: 0,
  activeSessionCount: 0,
  createdBy: { id: 'member-1', email: 'rohan@phase.dev', fullName: 'Rohan' },
  memberships: [],
  canManageMembers: true,
  viewerWorkflowIds: [],
  workflows: [{ id: `${id}-workflow` }],
})

describe('Agent lists', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useQuery as jest.Mock).mockReturnValue({
      data: {
        agents: [
          agent('agent-1', 'release-assistant', 'CLAUDE_CODE'),
          agent('agent-2', 'triage-bot', 'OPENCODE'),
          agent('agent-3', 'nightly-audit', 'DEVIN', 'DISABLED'),
        ],
      },
      loading: false,
      error: undefined,
      refetch: jest.fn(),
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (page: React.ReactNode) => {
    await act(async () => {
      root.render(<Suspense fallback={<div>Loading</div>}>{page}</Suspense>)
      await Promise.resolve()
    })
  }

  const rowFor = (name: string) =>
    Array.from(container.querySelectorAll('tbody tr')).find((row) =>
      row.textContent?.includes(name)
    )!

  test.each([
    ['the Agents tab', () => <AgentsPage params={Promise.resolve({ team: 'acme' })} />],
    ['Access > Agents', () => <AccessAgentsPage params={Promise.resolve({ team: 'acme' })} />],
  ])('shows each harness mark beside the Agent in %s', async (_, page) => {
    await render(page())

    const claude = rowFor('release-assistant')
    const mark = claude.querySelector('td:first-child svg[aria-hidden="true"]')!
    expect(mark.getAttribute('class')).toContain('size-5')
    expect(mark.getAttribute('class')).toContain('text-[#D97757]')
    // The harness name sits right under the Agent name, with its brand spelling.
    const identity = (name: string) => rowFor(name).querySelector('td:first-child')!.textContent
    expect(identity('release-assistant')).toBe('release-assistantClaude Code')
    expect(identity('triage-bot')).toBe('triage-botOpenCode')
    expect(rowFor('triage-bot').querySelector('td:first-child svg')).not.toBeNull()
    // Only an Agent that is not active gets a status badge, beside its name.
    expect(claude.textContent).not.toContain('Active')
    expect(identity('nightly-audit')).toBe('nightly-auditDisabledDevin')
  })

  test('shows times relative, with the full timestamp on hover', async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    await render(
      <>
        <AgentTime value={fiveMinutesAgo.toISOString()} />
        <AgentTime value={null} />
      </>
    )

    const time = container.querySelector('time')!
    expect(time.textContent).toBe('5 minutes ago')
    expect(time.getAttribute('title')).toBe(fiveMinutesAgo.toLocaleString())
    expect(time.getAttribute('dateTime')).toBe(fiveMinutesAgo.toISOString())
    expect(container.textContent).toContain('Never')
  })

  // Without a default size these marks stretch to fill unsized containers,
  // such as the tiles on Overview cards.
  test.each([
    ['Claude', SiClaude],
    ['Cursor', SiCursor],
    ['Devin', SiDevin],
    ['OpenCode', SiOpenCode],
  ])('sizes the %s mark at 1em like react-icons marks', async (_, Mark) => {
    await render(<Mark className="text-base" />)

    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('1em')
    expect(svg.getAttribute('height')).toBe('1em')
  })
})
