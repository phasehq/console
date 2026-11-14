import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { AgentMembers } from '@/components/agents/AgentMembers'
import { GetAgentGlobalAccessMembers } from '@/graphql/queries/agents/getAgentGlobalAccessMembers.gql'
import { GetAgentMemberships } from '@/graphql/queries/agents/getAgentMemberships.gql'
import { AssignAgentMemberOp } from '@/graphql/mutations/agents/manageAgents.gql'
import { toastUnhandledError } from '@/utils/errors'

jest.mock('@/graphql/queries/agents/getAgentMemberships.gql', () => ({
  GetAgentMemberships: Symbol('GetAgentMemberships'),
}))
jest.mock('@/graphql/queries/agents/getAgentGlobalAccessMembers.gql', () => ({
  GetAgentGlobalAccessMembers: Symbol('GetAgentGlobalAccessMembers'),
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
  // What the two lists return; a test sets these before it renders.
  let assigned: Array<Record<string, unknown>>
  let globalAccess: Array<Record<string, unknown>> | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    assigned = [
      {
        id: 'membership-1',
        member: {
          id: 'member-1',
          fullName: 'Ada Developer',
          email: 'ada@example.com',
        },
        workflows: [{ id: 'workflow-1', name: 'Default' }],
      },
    ]
    globalAccess = []
    ;(useQuery as jest.Mock).mockImplementation((document) => {
      if (document === GetAgentMemberships) {
        return { loading: false, data: { agentMemberships: assigned }, refetch: jest.fn() }
      }
      if (document === GetAgentGlobalAccessMembers) {
        return globalAccess
          ? { loading: false, data: { organisationGlobalAccessUsers: globalAccess } }
          : { loading: false, data: undefined, error: new Error('Not available') }
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

  describe('members with access through their role', () => {
    const renderTab = async (canManageMembers = true) =>
      act(async () => {
        root.render(
          <AgentMembers
            organisationId="org-1"
            agentId="agent-1"
            workflows={[{ id: 'workflow-1', name: 'Default' }]}
            canReadMembers
            canManageMembers={canManageMembers}
          />
        )
      })
    const rows = () => Array.from(container.querySelectorAll<HTMLElement>('tbody tr'))
    const owner = {
      ...orgMember('olivia', 'Olivia Owner', true),
      role: { ...role(true), id: 'role-owner', name: 'Owner' },
    }

    test('lists owners and admins first, read-only, above the assigned members', async () => {
      globalAccess = [owner, orgMember('amir', 'Amir Admin', true)]
      await renderTab()

      expect(useQuery).toHaveBeenCalledWith(
        GetAgentGlobalAccessMembers,
        expect.objectContaining({ variables: { organisationId: 'org-1' }, skip: false })
      )
      expect(rows().map((row) => row.hasAttribute('data-global-access-member'))).toEqual([
        true,
        true,
        false,
      ])
      const [first, second, explicit] = rows()
      // The same identity as an assigned member, with the role that gives the access.
      expect(first.textContent).toContain('Olivia Owner')
      expect(first.textContent).toContain('olivia@example.com')
      expect(first.textContent).toContain('Owner')
      expect(first.textContent).toContain('Organisation-wide access')
      expect(first.textContent).toContain('All Workflows')
      expect(second.textContent).toContain('Amir Admin')
      expect(second.textContent).toContain('Admin')
      // Nothing to edit, remove or pick on a row that exists through a role.
      for (const row of [first, second]) {
        expect(row.querySelectorAll('button')).toHaveLength(0)
        expect(row.querySelectorAll('input, select')).toHaveLength(0)
        expect(row.textContent).not.toContain('Default')
      }
      // Each row still has a cell under the Actions column.
      expect(first.children).toHaveLength(3)
      // The assigned member follows, as before.
      expect(explicit.textContent).toContain('Ada Developer')
      expect(explicit.textContent).toContain('Default')
      expect(
        Array.from(explicit.querySelectorAll('button')).map((button) => button.textContent)
      ).toEqual(expect.arrayContaining(['Edit', 'Remove']))
    })

    test('leaves out the caller when their own role has no organisation-wide access', async () => {
      // The query adds the caller to its answer whatever their role.
      globalAccess = [owner, orgMember('maya', 'Maya Chen')]
      await renderTab()

      expect(container.querySelectorAll('[data-global-access-member]')).toHaveLength(1)
      expect(container.textContent).not.toContain('Maya Chen')
    })

    test('shows them with no assignments at all, instead of the empty state', async () => {
      assigned = []
      globalAccess = [owner]
      await renderTab(false)

      expect(container.textContent).not.toContain('No explicit member assignments')
      expect(rows()).toHaveLength(1)
      expect(rows()[0].textContent).toContain('Olivia Owner')
      expect(rows()[0].textContent).toContain('Organisation-wide access')
      // Without the Actions column there is no cell for it either.
      expect(rows()[0].children).toHaveLength(2)
    })

    test('shows the empty state only with neither role access nor assignments', async () => {
      assigned = []
      globalAccess = []
      await renderTab()
      expect(container.textContent).toContain('No explicit member assignments')
      expect(container.querySelector('table')).toBeNull()

      // Assignments alone are enough for the table.
      assigned = [
        {
          id: 'membership-1',
          member: { id: 'member-1', fullName: 'Ada Developer', email: 'ada@example.com' },
          workflows: [{ id: 'workflow-1', name: 'Default' }],
        },
      ]
      await renderTab()
      expect(container.textContent).not.toContain('No explicit member assignments')
      expect(rows()).toHaveLength(1)
    })

    test('still lists assignments when the role members cannot be loaded', async () => {
      globalAccess = undefined
      await renderTab()

      expect(rows()).toHaveLength(1)
      expect(rows()[0].textContent).toContain('Ada Developer')
    })

    test('says who has access by role and that creating an Agent assigns no one', async () => {
      globalAccess = [owner]
      await renderTab()

      expect(container.textContent).toContain(
        'Organisation owners and admins can use every Workflow through their role.'
      )
      expect(container.textContent).toContain('Creating an Agent does not assign its creator.')
    })
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
    expect(useQuery).toHaveBeenCalledWith(
      GetAgentGlobalAccessMembers,
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
