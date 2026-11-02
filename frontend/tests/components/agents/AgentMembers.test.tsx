import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useQuery } from '@apollo/client'
import { AgentMembers } from '@/components/agents/AgentMembers'
import { GetAgentMemberships } from '@/graphql/queries/agents/getAgentMemberships.gql'

jest.mock('@/graphql/queries/agents/getAgentMemberships.gql', () => ({
  GetAgentMemberships: Symbol('GetAgentMemberships'),
}))
jest.mock('@/graphql/queries/organisation/getOrganisationMembers.gql', () => ({
  __esModule: true,
  default: Symbol('GetOrganisationMembers'),
}))
jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  AssignAgentMemberOp: Symbol('AssignAgentMemberOp'),
  RemoveAgentMemberOp: Symbol('RemoveAgentMemberOp'),
  UpdateAgentMemberWorkflowsOp: Symbol('UpdateAgentMemberWorkflowsOp'),
}))
jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({ triggerVariant }: { triggerVariant?: string }) => (
    <button type="button" data-variant={triggerVariant}>
      Remove
    </button>
  ),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(() => [jest.fn(), { loading: false }]),
  useQuery: jest.fn(),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('AgentMembers', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useQuery as jest.Mock).mockImplementation((document) => {
      if (document === GetAgentMemberships) {
        return {
          loading: false,
          data: {
            agentMemberships: [
              {
                id: 'membership-1',
                member: {
                  id: 'member-1',
                  fullName: 'Ada Developer',
                  email: 'ada@example.com',
                },
                workflows: [{ id: 'workflow-1', name: 'Default' }],
              },
            ],
          },
          refetch: jest.fn(),
        }
      }
      return { loading: false, data: { organisationMembers: [] } }
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  test('lists members and their Workflows in a compact table for managers', async () => {
    await act(async () => {
      root.render(
        <AgentMembers
          organisationId="org-1"
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default' }]}
          canReadMembers
          canManageMembers
        />
      )
    })

    const row = container.querySelector('tbody tr')!
    expect(row.textContent).toContain('Ada Developer')
    expect(row.textContent).toContain('ada@example.com')
    expect(row.textContent).toContain('Default')
    expect(container.textContent).toContain('Assign member')
    // Actions show on row hover, and removing is a danger action, as on other member lists.
    const remove = Array.from(row.querySelectorAll('button')).find(
      (button) => button.textContent === 'Remove'
    )!
    expect(remove.dataset.variant).toBe('danger')
    expect(row.classList).toContain('group')
    expect(remove.parentElement!.className).toContain('group-hover:opacity-100')
  })

  test('shows assignments read-only to a member who can read but not manage them', async () => {
    await act(async () => {
      root.render(
        <AgentMembers
          organisationId="org-1"
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default' }]}
          canReadMembers
          canManageMembers={false}
        />
      )
    })

    expect(useQuery).toHaveBeenCalledWith(
      GetAgentMemberships,
      expect.objectContaining({ skip: false })
    )
    expect(container.textContent).toContain('Ada Developer')
    expect(container.textContent).not.toContain('Assign member')
    expect(container.textContent).not.toContain('Remove')
  })

  test('does not query or expose assignments without read permission', async () => {
    await act(async () => {
      root.render(
        <AgentMembers
          organisationId="org-1"
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default' }]}
          canReadMembers={false}
          canManageMembers={false}
        />
      )
    })

    expect(useQuery).toHaveBeenCalledWith(
      GetAgentMemberships,
      expect.objectContaining({ skip: true })
    )
    expect(container.textContent).toContain(
      "You do not have permission to view this Agent's members."
    )
    expect(container.textContent).not.toContain('Ada Developer')
  })
})
