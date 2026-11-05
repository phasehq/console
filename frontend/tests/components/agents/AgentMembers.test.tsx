import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { AgentMembers } from '@/components/agents/AgentMembers'
import { GetAgentMemberships } from '@/graphql/queries/agents/getAgentMemberships.gql'
import { AssignAgentMemberOp } from '@/graphql/mutations/agents/manageAgents.gql'
import { toastUnhandledError } from '@/utils/errors'

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
  ConfirmAgentAction: ({
    triggerVariant,
    triggerProps,
  }: {
    triggerVariant?: string
    triggerProps?: { icon?: { name: string } }
  }) => (
    <button type="button" data-variant={triggerVariant} data-icon={triggerProps?.icon?.name}>
      Remove
    </button>
  ),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useApolloClient: jest.fn(),
  useMutation: jest.fn(() => [jest.fn(), { loading: false }]),
  useQuery: jest.fn(),
}))
jest.mock('@/utils/errors', () => ({ toastUnhandledError: jest.fn() }))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
// Headless UI checks for running animations, which jsdom does not implement.
Object.defineProperty(Element.prototype, 'getAnimations', {
  configurable: true,
  value: () => [],
})

const role = (globalAccess: boolean) => ({
  id: globalAccess ? 'role-admin' : 'role-developer',
  name: globalAccess ? 'Admin' : 'Developer',
  color: '',
  permissions: JSON.stringify({ permissions: {}, global_access: globalAccess }),
})
const orgMember = (id: string, fullName: string, globalAccess = false) => ({
  id,
  fullName,
  email: `${id}@example.com`,
  role: role(globalAccess),
})
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
      return {
        loading: false,
        data: {
          organisationMembers: [
            orgMember('member-1', 'Ada Developer'),
            orgMember('maya', 'Maya Chen'),
            orgMember('jordan', 'Jordan Lee'),
            orgMember('olivia', 'Olivia Admin', true),
          ],
        },
      }
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
    // Removing takes access away and deletes nothing, so it takes the X, like Revoke.
    expect(remove.dataset.icon).toBe('FaTimes')
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

  describe('assigning members', () => {
    let assignMember: jest.Mock
    let refetchQueries: jest.Mock

    beforeEach(() => {
      assignMember = jest.fn().mockResolvedValue({})
      refetchQueries = jest.fn().mockResolvedValue([])
      ;(useApolloClient as jest.Mock).mockReturnValue({ refetchQueries })
      ;(useMutation as jest.Mock).mockImplementation((document) =>
        document === AssignAgentMemberOp
          ? [assignMember, { loading: false }]
          : [jest.fn(), { loading: false }]
      )
    })

    const click = async (element: Element | null | undefined) => {
      expect(element).toBeTruthy()
      await act(async () => (element as HTMLElement).click())
    }
    const button = (text: string, scope: ParentNode = document.body) =>
      Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
        (element) => element.textContent?.trim() === text
      )
    const pickerPanel = () =>
      document.body
        .querySelector('input[aria-label="Search members"]')!
        .closest('[id^="headlessui-popover-panel"]')!
    const pick = async (name: string) => {
      const panel = pickerPanel()
      await click(
        Array.from(panel.querySelectorAll('button')).find((element) =>
          element.textContent?.includes(name)
        )
      )
    }
    // A Workflow row in the open dropdown; clicking its name toggles it.
    const option = (name: string) =>
      Array.from(document.body.querySelectorAll('label'))
        .find((element) => element.textContent?.trim() === name)
        ?.querySelector('span')
    const removeButton = (name: string) =>
      document.body.querySelector(`button[aria-label="Remove ${name}"]`)

    const openDialog = async () => {
      await act(async () => {
        root.render(
          <AgentMembers
            organisationId="org-1"
            agentId="agent-1"
            workflows={[
              { id: 'workflow-1', name: 'Default' },
              { id: 'workflow-2', name: 'Deploys' },
            ]}
            canReadMembers
            canManageMembers
          />
        )
      })
      await click(button('Assign members', container))
      // The member list opens on the next frame, after the dialog's own focus.
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
    }

    const addMayaAndJordan = async () => {
      // Already assigned members and global-access roles are not offered.
      expect(pickerPanel().textContent).not.toContain('Ada Developer')
      expect(pickerPanel().textContent).not.toContain('Olivia Admin')
      await pick('Maya Chen')
      await click(button('Add another member'))
      await pick('Jordan Lee')
    }

    test('assigns several members at once, each with their own Workflows', async () => {
      await openDialog()
      await addMayaAndJordan()

      // Jordan gets Deploys instead of the default Workflow.
      await click(document.body.querySelector('button[aria-label="Workflows for Jordan Lee"]'))
      await click(option('Deploys'))
      await click(option('Default'))
      expect(
        document.body.querySelector('button[aria-label="Workflows for Jordan Lee"]')!.textContent
      ).toBe('Deploys')

      await click(button('Assign 2 members'))

      expect(assignMember).toHaveBeenNthCalledWith(1, {
        variables: { agentId: 'agent-1', memberId: 'maya', workflowIds: ['workflow-1'] },
      })
      expect(assignMember).toHaveBeenNthCalledWith(2, {
        variables: { agentId: 'agent-1', memberId: 'jordan', workflowIds: ['workflow-2'] },
      })
      expect(refetchQueries).toHaveBeenCalledTimes(1)
    })

    test('keeps only the unassigned rows after a failure, for a retry', async () => {
      assignMember.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Not allowed'))
      await openDialog()
      await addMayaAndJordan()

      await click(button('Assign 2 members'))

      expect(toastUnhandledError).toHaveBeenCalled()
      expect(removeButton('Maya Chen')).toBeNull()
      expect(removeButton('Jordan Lee')).not.toBeNull()
      expect(button('Assign member')).toBeTruthy()
      // Maya's assignment went through, so the lists refresh.
      expect(refetchQueries).toHaveBeenCalledTimes(1)
    })

    test('opens on the member list, with the search box ready', async () => {
      await openDialog()

      expect(pickerPanel().textContent).toContain('Maya Chen')
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Search members')
    })

    test('cannot assign a member without a Workflow', async () => {
      await openDialog()
      await pick('Maya Chen')

      await click(document.body.querySelector('button[aria-label="Workflows for Maya Chen"]'))
      await click(option('Default'))

      expect(button('Assign member')!.disabled).toBe(true)
    })
  })

  test('a click anywhere on a Workflow row toggles it when editing access', async () => {
    await act(async () => {
      root.render(
        <AgentMembers
          organisationId="org-1"
          agentId="agent-1"
          workflows={[
            { id: 'workflow-1', name: 'Default' },
            { id: 'workflow-2', name: 'Deploys' },
          ]}
          canReadMembers
          canManageMembers
        />
      )
    })
    const edit = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent === 'Edit'
    )!
    await act(async () => edit.click())

    const row = Array.from(document.body.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('Deploys')
    )!
    const checkbox = row.querySelector('[role="checkbox"]')!
    expect(checkbox.getAttribute('aria-checked')).toBe('false')

    await act(async () => (row.querySelector('span') as HTMLElement).click())
    expect(checkbox.getAttribute('aria-checked')).toBe('true')

    await act(async () => (row.querySelector('span') as HTMLElement).click())
    expect(checkbox.getAttribute('aria-checked')).toBe('false')
  })
})
