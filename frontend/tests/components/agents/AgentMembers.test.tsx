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
  ConfirmAgentAction: () => <button type="button">Remove</button>,
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

  test('shows creator, explicit members, and workflow scope to managers', async () => {
    await act(async () => {
      root.render(
        <AgentMembers
          organisationId="org-1"
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default' }]}
          createdBy={{ id: 'creator-1', fullName: 'Grace Creator' }}
          canManageMembers
        />
      )
    })

    expect(container.textContent).toContain('Grace Creator')
    expect(container.textContent).toContain('Ada Developer')
    expect(container.textContent).toContain('Default')
    expect(container.textContent).toContain('Assign member')
  })

  test('does not query or expose assignments to a non-manager', async () => {
    await act(async () => {
      root.render(
        <AgentMembers
          organisationId="org-1"
          agentId="agent-1"
          workflows={[{ id: 'workflow-1', name: 'Default' }]}
          createdBy={{ id: 'creator-1', fullName: 'Grace Creator' }}
          canManageMembers={false}
        />
      )
    })

    expect(useQuery).toHaveBeenCalledWith(
      GetAgentMemberships,
      expect.objectContaining({ skip: true })
    )
    expect(container.textContent).toContain(
      'Only organisation owners and admins can view or change Agent assignments.'
    )
    expect(container.textContent).not.toContain('Ada Developer')
  })
})
