import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentMesh, type AgentMeshPermissions } from '@/components/agents/AgentMesh'
import { buildMeshModel, type MeshModel } from '@/components/agents/AgentMeshUtils'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// jsdom lacks the Web Animations API that Headless UI checks when a panel opens.
Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] })

jest.mock('@/components/agents/AgentDialogs', () => ({
  CreateAgentDialog: ({ onCreated }: { onCreated?: (agentId: string) => void }) => (
    <button type="button" onClick={() => onCreated?.('agent-9')}>
      stub-create-agent
    </button>
  ),
  MintAgentTokenDialog: ({
    workflows,
    harnessType,
  }: {
    workflows: Array<{ id: string }>
    harnessType?: string
  }) => (
    <button type="button">
      stub-mint-token:{workflows[0]?.id}:{harnessType}
    </button>
  ),
}))
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@/components/agents/AgentConnectionDialogs', () => ({
  CreateConnectionDialog: () => <button type="button">stub-create-connection</button>,
}))

const permissions: AgentMeshPermissions = {
  canCreateAgent: true,
  canReadConnections: true,
  canCreateConnection: true,
}

const model = buildMeshModel({
  agents: [
    {
      id: 'agent-1',
      name: 'Deploy bot',
      harnessType: 'CODEX',
      status: 'ACTIVE',
      lastSeenAt: null,
      activeSessionCount: 2,
      canMintToken: true,
    },
  ],
  workflows: [
    {
      id: 'workflow-1',
      name: 'Deploy',
      agentId: 'agent-1',
      grants: [
        {
          id: 'grant-1',
          connection: {
            id: 'connection-1',
            name: 'AWS production',
            serviceType: 'aws',
            state: 'active',
            authentication: {
              id: 'credential-1',
              name: 'EC2 deployer',
              provider: { id: 'aws', name: 'AWS' },
            },
          },
        },
      ],
    },
  ],
  requests: [
    {
      id: 'request-1',
      kind: 'credential_update',
      status: 'pending',
      credentialProvider: 'aws',
      credentialName: 'EC2 deployer',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (2 * 60 + 5) * 60_000).toISOString(),
      agent: { id: 'agent-1', name: 'Deploy bot' },
      workflow: { id: 'workflow-1', name: 'Deploy' },
    },
  ],
})

describe('AgentMesh', () => {
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
  })

  const renderMesh = async (
    overrides: Partial<AgentMeshPermissions> = {},
    meshModel: MeshModel = model
  ) => {
    await act(async () => {
      root.render(
        <AgentMesh
          organisationId="org-1"
          team="phase"
          model={meshModel}
          services={[{ serviceType: 'aws', displayName: 'AWS', provider: 'aws' }]}
          permissions={{ ...permissions, ...overrides }}
          onGraphChange={() => {}}
        />
      )
    })
  }

  test('renders the grant graph with integration credential context and request links', async () => {
    await renderMesh()

    expect(container.textContent).toContain('Deploy bot')
    expect(container.textContent).toContain('AWS production')
    expect(container.textContent).toContain('Integration credentials')
    expect(container.textContent).toContain('EC2 deployer')
    expect(container.textContent).toContain('1 pending request')
    expect(container.textContent).toContain('Credential update · Expires in 2 hours')
    expect(container.textContent).not.toContain('Policy')
    expect(container.textContent?.match(/stub-mint-token/g)).toHaveLength(1)
    expect(container.textContent).toContain('stub-mint-token:workflow-1:CODEX')
    expect(container.querySelector('[data-mesh-node="agent:agent-1"]')).not.toBeNull()
    expect(container.querySelector('[data-mesh-node="connection:connection-1"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-mesh-edges] > g > path')).toHaveLength(1)
    expect(
      container.querySelector('a[href="/phase/agents/requests?request=request-1"]')
    ).not.toBeNull()
  })

  test('lists Workflows one per line with a single token action per Agent', async () => {
    const connection = { id: 'connection-1', name: 'AWS production', serviceType: 'aws' }
    const agentInput = (id: string, name: string) => ({
      id,
      name,
      harnessType: 'CODEX',
      status: 'ACTIVE',
      activeSessionCount: 0,
      canMintToken: true,
    })
    await renderMesh(
      {},
      buildMeshModel({
        agents: [agentInput('agent-1', 'Deploy bot'), agentInput('agent-2', 'Audit bot')],
        workflows: [
          {
            id: 'releases',
            name: 'Releases',
            agentId: 'agent-1',
            createdAt: '2026-09-02T00:00:00Z',
            grants: [{ connection }],
          },
          {
            id: 'default',
            name: 'Default',
            agentId: 'agent-1',
            createdAt: '2026-09-01T00:00:00Z',
            grants: [],
          },
          { id: 'audit', name: 'Audit', agentId: 'agent-2', grants: [{ connection }] },
        ],
      })
    )

    const card = container.querySelector('[data-mesh-node="agent:agent-1"]')!
    const rows = Array.from(card.querySelectorAll('[data-mesh-node^="workflow:"]'))
    expect(rows.map((row) => row.textContent)).toEqual(['DefaultNo grants', 'Releases1 grant'])
    // One token dialog per card, opening on the default Workflow.
    expect(card.textContent?.match(/stub-mint-token/g)).toHaveLength(1)
    expect(card.textContent).toContain('stub-mint-token:default:CODEX')

    // Hovering a Workflow dims its siblings and the other Agent's connector.
    await act(async () => {
      rows[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(rows[0].className).toContain('opacity-30')
    expect(rows[1].className).not.toContain('opacity-30')
    const edgeOpacity = Array.from(container.querySelectorAll('[data-mesh-edges] > g')).map(
      (edge) => (edge.getAttribute('class')?.includes('opacity-80') ? 'lit' : 'dimmed')
    )
    expect(edgeOpacity.sort()).toEqual(['dimmed', 'lit'])
  })

  test('the pending alert filters the canvas to Agents with pending requests', async () => {
    const agentInput = (id: string, name: string) => ({
      id,
      name,
      harnessType: 'CODEX',
      status: 'ACTIVE',
      activeSessionCount: 0,
      canMintToken: false,
    })
    const connection = (id: string) => ({ id, name: id, serviceType: 'aws' })
    await renderMesh(
      {},
      buildMeshModel({
        agents: [agentInput('agent-1', 'Deploy bot'), agentInput('agent-2', 'Audit bot')],
        workflows: [
          {
            id: 'deploy',
            name: 'Deploy',
            agentId: 'agent-1',
            grants: [{ connection: connection('aws') }],
          },
          {
            id: 'audit',
            name: 'Audit',
            agentId: 'agent-2',
            grants: [{ connection: connection('logs') }],
          },
        ],
        requests: [
          {
            id: 'request-1',
            kind: 'setup',
            status: 'pending',
            createdAt: new Date().toISOString(),
            agent: { id: 'agent-1' },
            workflow: { id: 'deploy', name: 'Deploy' },
          },
        ],
      })
    )

    const toggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Pending requests1'
    )!
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    const cards = () =>
      Array.from(
        container.querySelectorAll('[data-mesh-node^="agent:"], [data-mesh-node^="connection:"]')
      )
        .map((card) => card.getAttribute('data-mesh-node'))
        .sort()
    const counts = () =>
      Array.from(container.querySelectorAll('[data-mesh-column] h3')).map(
        (heading) => heading.textContent
      )

    await act(async () => toggle.click())

    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    // The warning Button while on.
    expect(toggle.className).toContain('bg-amber-700')
    expect(cards()).toEqual(['agent:agent-1', 'connection:aws'])
    expect(counts()).toEqual(['Agents1/2', 'Connections1/2'])

    await act(async () => toggle.click())

    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(cards()).toEqual(['agent:agent-1', 'agent:agent-2', 'connection:aws', 'connection:logs'])
    expect(counts()).toEqual(['Agents2', 'Connections2'])
  })

  describe('filter chips', () => {
    const agentInput = (id: string, harnessType: string) => ({
      id,
      name: id,
      harnessType,
      status: 'ACTIVE',
      activeSessionCount: 0,
      canMintToken: false,
    })
    const grant = (id: string, serviceType: string) => ({
      connection: { id, name: id, serviceType },
    })
    const chipModel = () =>
      buildMeshModel({
        agents: [
          agentInput('claude', 'CLAUDE_CODE'),
          agentInput('codex', 'CODEX'),
          agentInput('second-codex', 'CODEX'),
        ],
        workflows: [
          { id: 'w-claude', name: 'Default', agentId: 'claude', grants: [grant('aws', 'aws')] },
          {
            id: 'w-codex',
            name: 'Default',
            agentId: 'codex',
            grants: [grant('orders', 'postgres')],
          },
          {
            id: 'w-second',
            name: 'Default',
            agentId: 'second-codex',
            grants: [grant('aws', 'aws')],
          },
        ],
      })
    const chips = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '[role="group"][aria-label="Filter the canvas"] button'
        )
      )
    const chip = (label: string) => chips().find((button) => button.textContent?.startsWith(label))!
    const cards = () =>
      Array.from(
        container.querySelectorAll('[data-mesh-node^="agent:"], [data-mesh-node^="connection:"]')
      )
        .map((card) => card.getAttribute('data-mesh-node'))
        .sort()

    test('a chip per harness and Connection type in use, with its count', async () => {
      await renderMesh({}, chipModel())

      expect(chips().map((button) => button.textContent)).toEqual([
        'Claude Code1',
        'Codex2',
        'AWS1',
        'PostgreSQL1',
      ])
    })

    test('no chips for a harness or Connection type every card shares', async () => {
      await renderMesh()

      // Only the pending requests chip, since one Agent and one Connection share everything.
      expect(chips().map((button) => button.textContent)).toEqual(['Pending requests1'])
    })

    test('a harness keeps its Agents and their Connections; a Connection type keeps its users', async () => {
      await renderMesh({}, chipModel())

      await act(async () => chip('Codex').click())
      expect(chip('Codex').getAttribute('aria-pressed')).toBe('true')
      // The primary Button while on, the secondary one while off.
      expect(chip('Codex').className).toContain('bg-zinc-900')
      expect(chip('Claude Code').className).toContain('bg-zinc-100')
      // The black OpenAI mark takes the chip's text colour; brand colours stay.
      const mark = (label: string) => chip(label).querySelector('svg')!.getAttribute('class')
      expect(mark('Codex')).not.toContain('text-zinc-900')
      expect(mark('Claude Code')).toContain('text-[#D97757]')
      expect(cards()).toEqual([
        'agent:codex',
        'agent:second-codex',
        'connection:aws',
        'connection:orders',
      ])

      // Chips in one group add up.
      await act(async () => chip('Claude Code').click())
      expect(cards()).toHaveLength(5)
      expect(mark('Claude Code')).toContain('text-[#D97757]')

      // Groups narrow each other.
      await act(async () => chip('PostgreSQL').click())
      expect(cards()).toEqual(['agent:codex', 'connection:orders'])

      await act(async () => chip('Codex').click())
      await act(async () => chip('Claude Code').click())
      expect(cards()).toEqual(['agent:codex', 'connection:orders'])
      expect(
        Array.from(container.querySelectorAll('[data-mesh-column] h3')).map(
          (heading) => heading.textContent
        )
      ).toEqual(['Agents1/3', 'Connections1/2'])
    })

    describe('more than three options', () => {
      const workflow = (agentId: string, connectionId: string, serviceType: string) => ({
        id: `w-${agentId}`,
        name: 'Default',
        agentId,
        grants: [grant(connectionId, serviceType)],
      })
      const dropdowns = () =>
        Array.from(
          container.querySelectorAll<HTMLButtonElement>(
            '[role="group"][aria-label="Filter the canvas"] button[aria-expanded]'
          )
        )
      const rows = (title: string) =>
        Array.from(
          container.querySelectorAll<HTMLLabelElement>(
            `[role="group"][aria-label="${title}"] label`
          )
        )
      const checked = (row: HTMLLabelElement) =>
        row.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')
      const reset = () =>
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Reset filter'
        )

      test('fold into one dropdown, which filters like the chips', async () => {
        await renderMesh(
          {},
          buildMeshModel({
            agents: [
              agentInput('claude', 'CLAUDE_CODE'),
              agentInput('codex', 'CODEX'),
              agentInput('second-codex', 'CODEX'),
              agentInput('cursor', 'CURSOR'),
              agentInput('devin', 'DEVIN'),
            ],
            workflows: [
              workflow('claude', 'aws', 'aws'),
              workflow('codex', 'orders', 'postgres'),
              workflow('second-codex', 'aws', 'aws'),
              workflow('cursor', 'aws', 'aws'),
              workflow('devin', 'aws', 'aws'),
            ],
          })
        )

        // Four harnesses take one trigger; the two Connection types stay chips.
        const trigger = dropdowns()[0]
        expect(dropdowns()).toHaveLength(1)
        expect(chips().map((button) => button.textContent)).toEqual([
          'Harness',
          'AWS1',
          'PostgreSQL1',
        ])
        expect(rows('Harness')).toHaveLength(0)

        await act(async () => trigger.click())
        expect(trigger.getAttribute('aria-expanded')).toBe('true')
        expect(rows('Harness').map((row) => row.textContent)).toEqual([
          'Claude Code1',
          'Codex2',
          'Cursor1',
          'Devin1',
        ])
        expect(reset()!.disabled).toBe(true)

        // A click anywhere on a row toggles it.
        await act(async () => rows('Harness')[1].click())
        expect(checked(rows('Harness')[1])).toBe('true')
        expect(cards()).toEqual([
          'agent:codex',
          'agent:second-codex',
          'connection:aws',
          'connection:orders',
        ])
        // The trigger takes the primary Button and names the choice.
        expect(trigger.textContent).toBe('Codex')
        expect(trigger.className).toContain('bg-zinc-900')

        // Its checkbox toggles too, and the trigger counts the other choices.
        await act(async () =>
          rows('Harness')[2].querySelector<HTMLButtonElement>('[role="checkbox"]')!.click()
        )
        expect(trigger.textContent).toBe('Codex+1')
        expect(cards()).toHaveLength(5)

        await act(async () => reset()!.click())
        expect(trigger.textContent).toBe('Harness')
        expect(trigger.className).not.toContain('bg-zinc-900')
        expect(rows('Harness').map(checked)).toEqual(['false', 'false', 'false', 'false'])
        expect(cards()).toHaveLength(7)
      })

      test('applies to Connection types too', async () => {
        await renderMesh(
          {},
          buildMeshModel({
            agents: [
              agentInput('claude', 'CLAUDE_CODE'),
              agentInput('codex', 'CODEX'),
              agentInput('second-codex', 'CODEX'),
            ],
            workflows: [
              workflow('claude', 'aws', 'aws'),
              workflow('codex', 'orders', 'postgres'),
              {
                ...workflow('second-codex', 'builds', 'gcp'),
                grants: [grant('builds', 'gcp'), grant('repos', 'github')],
              },
            ],
          })
        )

        expect(chips().map((button) => button.textContent)).toEqual([
          'Claude Code1',
          'Codex2',
          'Connection type',
        ])
        await act(async () => dropdowns()[0].click())
        expect(rows('Connection type').map((row) => row.textContent)).toEqual([
          'AWS1',
          'GCP1',
          'GitHub1',
          'PostgreSQL1',
        ])

        await act(async () => rows('Connection type')[3].click())
        expect(dropdowns()[0].textContent).toBe('PostgreSQL')
        expect(cards()).toEqual(['agent:codex', 'connection:orders'])
      })
    })
  })

  describe('request lines', () => {
    // Deploy updates aws credentials; Reports asks for a new billing Connection.
    const requestModel = () =>
      buildMeshModel({
        agents: [
          {
            id: 'agent-1',
            name: 'Deploy bot',
            harnessType: 'CODEX',
            status: 'ACTIVE',
            activeSessionCount: 0,
            canMintToken: false,
          },
        ],
        workflows: [
          {
            id: 'deploy',
            name: 'Deploy',
            agentId: 'agent-1',
            grants: [{ connection: { id: 'aws', name: 'aws', serviceType: 'aws' } }],
          },
          { id: 'reports', name: 'Reports', agentId: 'agent-1', grants: [] },
        ],
        connections: [{ id: 'billing', name: 'billing', serviceType: 'aws' }],
        requests: [
          {
            id: 'update',
            kind: 'credential_update',
            status: 'pending',
            createdAt: new Date().toISOString(),
            agent: { id: 'agent-1' },
            workflow: { id: 'deploy', name: 'Deploy' },
            connection: { id: 'aws', name: 'aws' },
          },
          {
            id: 'setup',
            kind: 'setup',
            status: 'pending',
            createdAt: new Date().toISOString(),
            agent: { id: 'agent-1' },
            workflow: { id: 'reports', name: 'Reports' },
            connection: { id: 'billing', name: 'billing' },
          },
        ],
      })
    const hover = async (element: Element) => {
      await act(async () => {
        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
    }
    const amberLines = () =>
      Array.from(container.querySelectorAll('[data-mesh-edges] path.stroke-amber-500')).map(
        (path) => (path.getAttribute('stroke-dasharray') ? 'dotted' : 'solid')
      )
    const greenLines = () =>
      container.querySelectorAll('[data-mesh-edges] path.stroke-emerald-500').length

    test('show only for the hovered scope', async () => {
      await renderMesh({}, requestModel())
      expect(amberLines()).toEqual([])

      // A request on an existing grant turns its green line amber.
      await hover(container.querySelector('[data-mesh-request="update"]')!)
      expect(amberLines()).toEqual(['solid'])
      expect(greenLines()).toBe(0)

      await hover(container.querySelector('[data-mesh-request="setup"]')!)
      expect(amberLines()).toEqual(['dotted'])

      await hover(container.querySelector('[data-mesh-node="workflow:reports"]')!)
      expect(amberLines()).toEqual(['dotted'])

      await hover(container.querySelector('[data-mesh-node="connection:billing"]')!)
      expect(amberLines()).toEqual(['dotted'])

      await hover(container.querySelector('[data-mesh-node="agent:agent-1"] a')!)
      expect(amberLines().sort()).toEqual(['dotted', 'solid'])
    })

    test('a Connection card links the requests asking for it, and its rows light their lines', async () => {
      await renderMesh({}, requestModel())

      const billing = container.querySelector('[data-mesh-node="connection:billing"]')!
      const section = billing.querySelector('section[aria-label="Pending requests for billing"]')!
      expect(section.textContent).toContain('1 pending request')
      // The target is this card, so rows name the Agent and Workflow that asked.
      const row = section.querySelector('li')!
      expect(row.textContent).toContain('Deploy botReports')
      expect(row.querySelector('a')!.getAttribute('href')).toBe(
        '/phase/agents/requests?request=setup'
      )
      // Outlined, like an Agent card with pending requests.
      expect(billing.className).toContain('border-amber-500/60')

      await hover(row)
      expect(amberLines()).toEqual(['dotted'])
    })

    test('all show while the pending filter is on', async () => {
      await renderMesh({}, requestModel())

      await act(async () =>
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === 'Pending requests2')!
          .click()
      )

      expect(amberLines().sort()).toEqual(['dotted', 'solid'])
      // The Connection only a request names stays on the filtered canvas.
      expect(container.querySelector('[data-mesh-node="connection:billing"]')).not.toBeNull()
    })
  })

  test('a Connection card lists requests from every Agent, soonest deadline first', async () => {
    const agent = (id: string, name: string) => ({
      id,
      name,
      harnessType: 'CODEX',
      status: 'ACTIVE',
      activeSessionCount: 0,
      canMintToken: false,
    })
    const setup = (id: string, agentId: string, workflowId: string, hours: number) => ({
      id,
      kind: 'setup',
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
      agent: { id: agentId },
      workflow: { id: workflowId, name: workflowId },
      connection: { id: 'orders', name: 'Orders database' },
    })
    await renderMesh(
      {},
      buildMeshModel({
        agents: [agent('agent-1', 'Deploy bot'), agent('agent-2', 'Triage bot')],
        workflows: [
          { id: 'Deploy', name: 'Deploy', agentId: 'agent-1', grants: [] },
          { id: 'Default', name: 'Default', agentId: 'agent-2', grants: [] },
        ],
        connections: [{ id: 'orders', name: 'Orders database', serviceType: 'postgres' }],
        requests: [
          setup('later', 'agent-1', 'Deploy', 48),
          setup('sooner', 'agent-2', 'Default', 5),
        ],
      })
    )

    const rows = container.querySelectorAll(
      '[data-mesh-node="connection:orders"] section[aria-label="Pending requests for Orders database"] li'
    )
    expect(Array.from(rows).map((row) => row.querySelector('a')!.getAttribute('href'))).toEqual([
      '/phase/agents/requests?request=sooner',
      '/phase/agents/requests?request=later',
    ])
    expect(rows[0].textContent).toContain('Triage botDefault')
  })

  test('opens the new Agent after creation', async () => {
    await renderMesh()

    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'stub-create-agent')!
        .click()
    )

    expect(mockPush).toHaveBeenCalledWith('/phase/agents/agent-9')
  })

  test('permission-gates additive Agent and Connection actions', async () => {
    await renderMesh({ canCreateAgent: false, canCreateConnection: false })

    expect(container.textContent).not.toContain('stub-create-agent')
    expect(container.textContent).not.toContain('stub-create-connection')
    expect(container.textContent).toContain('stub-mint-token:workflow-1:CODEX')
  })
})
