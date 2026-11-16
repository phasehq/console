import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { GrantWorkflowDialog } from '@/components/agents/AgentDialogs'
import { EditGrantExpiryDialog } from '@/components/agents/AgentGrantExtras'
import { buttonNamed, settle } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  GrantAgentWorkflowOp: 'grant',
}))
jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useApolloClient: jest.fn(),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('@/components/common/GenericDialog', () =>
  jest.requireActual('./customConnectionTestKit').dialogMock()
)
jest.mock('@/components/agents/AgentSelect', () =>
  jest.requireActual('./customConnectionTestKit').selectMock()
)
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const github = { id: 'connection-1', name: 'GitHub', serviceType: 'http' }
const postgres = { id: 'connection-2', name: 'Database', serviceType: 'postgresql' }

describe('granting a Connection to a Workflow', () => {
  let container: HTMLDivElement
  let root: Root
  let grant: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    grant = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([grant, { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const render = async (connections = [github, postgres]) => {
    await act(async () =>
      root.render(<GrantWorkflowDialog workflowId="workflow-1" connections={connections} />)
    )
    await act(async () => buttonNamed(container, 'Add Connection')!.click())
  }
  const choose = async (id: string, value: string) =>
    act(async () => {
      const element = container.querySelector<HTMLSelectElement>(`select[id="${id}"]`)!
      element.value = value
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
  const submit = async () => {
    await act(async () => buttonNamed(container, 'Grant access')!.click())
    await settle(() => grant.mock.calls.length > 0)
    return grant.mock.calls[0][0].variables
  }

  test('access lasts until revoked unless something else is picked', async () => {
    await render()
    expect(
      container.querySelector<HTMLSelectElement>('select[id="workflow-grant-ends"]')!.value
    ).toBe('forever')
    expect(container.textContent).toContain('until a member revokes it')

    // No expiry is sent, so a new grant has none.
    expect(await submit()).toEqual({ workflowId: 'workflow-1', connectionId: 'connection-1' })
  })

  test('offers 1 hour, 8 hours, 24 hours, 7 days and a custom date and time', async () => {
    await render()
    const options = Array.from(
      container.querySelector<HTMLSelectElement>('select[id="workflow-grant-ends"]')!.options
    ).map((option) => option.textContent)
    expect(options).toEqual([
      'Until revoked',
      '1 hour',
      '8 hours',
      '24 hours',
      '7 days',
      'Custom date and time',
    ])
  })

  test('sends the end as an ISO time from now', async () => {
    await render()
    await choose('workflow-grant-ends', '8h')
    const before = Date.now()
    const variables = await submit()
    const ends = Date.parse(variables.expiresAt)
    expect(Math.abs(ends - (before + 8 * 3600_000))).toBeLessThan(10_000)
    expect(variables).not.toHaveProperty('policy')
  })

  test('a custom time must be in the future', async () => {
    await render()
    await choose('workflow-grant-ends', 'custom')
    expect(buttonNamed(container, 'Grant access')!.disabled).toBe(true)
    const custom = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        custom,
        '2020-01-01T00:00'
      )
      custom.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('Choose a time in the future')
    expect(buttonNamed(container, 'Grant access')!.disabled).toBe(true)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        custom,
        '2099-01-01T00:00'
      )
      custom.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(buttonNamed(container, 'Grant access')!.disabled).toBe(false)
    expect(Date.parse((await submit()).expiresAt)).toBeGreaterThan(Date.now())
  })

  test('access rules are not part of granting: they belong to the Connection', async () => {
    await render()
    expect(buttonNamed(container, 'Access rules')).toBeUndefined()
    expect(container.querySelector('[role="radiogroup"]')).toBeNull()
    expect(container.textContent).not.toContain('Secret guard')
  })
})

describe('changing when a grant ends', () => {
  let container: HTMLDivElement
  let root: Root
  let grant: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    grant = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([grant, { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const open = async (expiresAt: string | null) => {
    await act(async () =>
      root.render(
        <EditGrantExpiryDialog
          workflowId="workflow-1"
          grant={{ connection: { id: 'connection-1', name: 'GitHub' }, expiresAt }}
        />
      )
    )
    await act(async () => buttonNamed(container, 'Expiry')!.click())
  }
  const save = async () => {
    await act(async () => buttonNamed(container, 'Save')!.click())
    await settle(() => grant.mock.calls.length > 0)
    return grant.mock.calls[0][0].variables
  }

  test('removing the expiry sends an explicit null, since leaving it out would keep it', async () => {
    await open('2099-01-01T10:00:00Z')
    expect(buttonNamed(container, 'Save')!.disabled).toBe(true)
    await act(async () => {
      const element = container.querySelector<HTMLSelectElement>('select')!
      element.value = 'forever'
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const variables = await save()
    expect(variables).toEqual({
      workflowId: 'workflow-1',
      connectionId: 'connection-1',
      expiresAt: null,
    })
    expect(Object.prototype.hasOwnProperty.call(variables, 'expiresAt')).toBe(true)
  })

  test('a grant that does not end can be given an end', async () => {
    await open(null)
    expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('forever')
    expect(buttonNamed(container, 'Save')!.disabled).toBe(true)
    await act(async () => {
      const element = container.querySelector<HTMLSelectElement>('select')!
      element.value = '24h'
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const variables = await save()
    expect(Date.parse(variables.expiresAt)).toBeGreaterThan(Date.now() + 23 * 3600_000)
  })

  test('starts on the end the grant has', async () => {
    await open('2099-01-01T10:00:00Z')
    expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('custom')
    expect(
      container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value
    ).not.toBe('')
  })
})
