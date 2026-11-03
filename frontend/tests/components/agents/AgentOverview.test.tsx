import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useQuery } from '@apollo/client'
import { AgentOverview } from '@/components/agents/AgentOverview'
import type { MeshRequestChip } from '@/components/agents/AgentMeshUtils'

jest.mock('@/graphql/queries/agents/getAgentMemberships.gql', () => ({
  GetAgentMemberships: Symbol('GetAgentMemberships'),
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
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Relative times read the real clock, so request dates are relative to it.
const NOW = Date.now()
const HOUR = 3_600_000

const request = (id: string, workflowId: string, kind = 'SETUP'): MeshRequestChip => ({
  id,
  kind,
  workflowId,
  connectionId: null,
  workflowName: workflowId,
  targetLabel: `${id} target`,
  createdAt: new Date(NOW - HOUR).toISOString(),
  expiresAt: new Date(NOW + 50 * HOUR).toISOString(),
})

const workflow = (id: string, grants = 1) => ({ id, name: id, grants: Array(grants).fill({}) })

const token = (id: string, createdAt: string, lastUsedAt: string | null = null) => ({
  id,
  name: id,
  createdAt,
  lastUsedAt,
  workflow: { name: 'Default' },
})

const membership = (id: string, fullName: string, workflows: number) => ({
  id,
  member: { id: `member-${id}`, fullName, email: `${id}@example.com` },
  workflows: Array.from({ length: workflows }, (_, index) => ({ id: `workflow-${index}` })),
})

describe('AgentOverview', () => {
  let container: HTMLDivElement
  let root: Root
  const onOpenTab = jest.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useQuery as jest.Mock).mockReturnValue({
      data: {
        agentMemberships: [membership('ada', 'Ada Developer', 2), membership('lin', 'Lin', 1)],
      },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (props: Partial<React.ComponentProps<typeof AgentOverview>> = {}) => {
    await act(async () => {
      root.render(
        <AgentOverview
          organisationId="org-1"
          agentId="agent-1"
          team="acme"
          workflows={[workflow('Default'), workflow('Deploys', 2)]}
          tokens={[
            token('older', '2026-09-01T00:00:00Z', '2026-09-09T00:00:00Z'),
            token('newer', '2026-09-05T00:00:00Z'),
          ]}
          pendingRequests={[]}
          canReadTokens
          canReadMembers
          now={NOW}
          onOpenTab={onOpenTab}
          {...props}
        />
      )
    })
  }

  const card = (title: string) =>
    container.querySelector<HTMLElement>(`section[aria-label="${title}"]`)!
  const rows = (scope: Element) =>
    Array.from(scope.querySelectorAll('li')).map((row) => row.textContent)

  test('summarises Workflows, tokens and members, newest token first', async () => {
    await render({ pendingRequests: [request('setup-1', 'Deploys')] })

    expect(card('Workflows').querySelector('h3')!.textContent).toBe('Workflows2')
    expect(rows(card('Workflows'))).toEqual(['Default1 grant', 'Deploys2 grants · 1 pending'])
    expect(rows(card('Tokens'))).toEqual([
      'newerDefaultNever used',
      expect.stringMatching(/^olderDefaultUsed /),
    ])
    expect(rows(card('Members'))).toEqual(['ADAda Developer2 Workflows', 'LLin1 Workflow'])
  })

  test('puts View all at the bottom of each card, opening its tab', async () => {
    await render()

    for (const [title, tab] of [
      ['Workflows', 'Workflows'],
      ['Tokens', 'Tokens'],
      ['Members', 'Members'],
    ]) {
      const viewAll = card(title).querySelector<HTMLButtonElement>(
        `button[aria-label="View all ${title}"]`
      )!
      expect(viewAll.textContent).toBe('View all')
      expect(card(title).lastElementChild!.contains(viewAll)).toBe(true)
      await act(async () => viewAll.click())
      expect(onOpenTab).toHaveBeenLastCalledWith(tab)
    }
  })

  test('lists five items per card, then counts the rest', async () => {
    await render({
      workflows: Array.from({ length: 7 }, (_, index) => workflow(`Workflow ${index}`)),
    })

    expect(card('Workflows').querySelectorAll('li')).toHaveLength(5)
    expect(card('Workflows').textContent).toContain('and 2 more')
  })

  test('caps pending requests at three rows, one line each', async () => {
    await render({
      pendingRequests: [
        request('update-1', 'Deploys', 'CREDENTIAL_UPDATE'),
        request('setup-1', 'Default'),
        request('setup-2', 'Default'),
        request('setup-3', 'Deploys'),
      ],
    })

    const banner = card('Pending requests')
    expect(banner.querySelector('h3')!.textContent).toBe('4 pending requests')
    const items = banner.querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toBe(
      'Deploysupdate-1 targetCredential update · Expires in 2 daysReview'
    )
    expect(items[0].querySelector('a')!.getAttribute('href')).toBe(
      '/acme/agents/requests?request=update-1'
    )

    // The rest are a click away, in their Workflows.
    const viewAll = banner.querySelector<HTMLButtonElement>(
      'button[aria-label="View all pending requests"]'
    )!
    await act(async () => viewAll.click())
    expect(onOpenTab).toHaveBeenLastCalledWith('Workflows')
  })

  test('shows every request without a View all when three or fewer wait', async () => {
    await render({ pendingRequests: [request('setup-1', 'Default')] })

    const banner = card('Pending requests')
    expect(banner.querySelector('h3')!.textContent).toBe('1 pending request')
    expect(banner.querySelectorAll('li')).toHaveLength(1)
    expect(banner.querySelector('button[aria-label="View all pending requests"]')).toBeNull()
  })

  test('hides the banner when nothing is pending', async () => {
    await render()

    expect(container.querySelector('section[aria-label="Pending requests"]')).toBeNull()
  })

  test('says when tokens and members are restricted, without querying members', async () => {
    await render({ canReadTokens: false, canReadMembers: false })

    expect(card('Tokens').textContent).toContain('Token details are restricted for your role.')
    expect(card('Tokens').querySelector('h3')!.textContent).toBe('Tokens')
    expect(card('Members').textContent).toContain('Members are restricted for your role.')
    expect((useQuery as jest.Mock).mock.calls[0][1]).toMatchObject({ skip: true })
  })
})
