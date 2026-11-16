import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import {
  ExpiredConnections,
  GrantExpiryText,
  GrantTemporaryAllows,
  readExpiredConnections,
} from '@/components/agents/AgentGrantExtras'
import { buttonNamed } from './customConnectionTestKit'

jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({ title, description, triggerProps, onConfirm }: any) => (
    <div data-confirm={title}>
      <button type="button" aria-label={triggerProps['aria-label']} data-variant="trigger" />
      <p>{description}</p>
      <button type="button" aria-label={`Confirm ${title}`} onClick={() => onConfirm()} />
    </div>
  ),
  GrantWorkflowDialog: ({ connections, initialConnectionId, triggerLabel }: any) => (
    <button type="button" data-connection={initialConnectionId} data-count={connections.length}>
      {triggerLabel}
    </button>
  ),
}))
jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({
  GrantAgentWorkflowOp: 'grant',
  RemoveAgentWorkflowGrantAllowOp: 'remove-allow',
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(() => [jest.fn(), { loading: false }]),
}))
jest.mock('@/components/common/GenericDialog', () =>
  jest.requireActual('./customConnectionTestKit').dialogMock()
)
jest.mock('@/components/agents/AgentSelect', () =>
  jest.requireActual('./customConnectionTestKit').selectMock()
)
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const expired = [
  {
    connectionId: 'c1',
    connectionName: 'GitHub',
    serviceType: 'http',
    expiredAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
  },
  {
    connectionId: 'c2',
    connectionName: 'Datadog',
    serviceType: 'http',
    expiredAt: new Date(Date.now() - 3600_000).toISOString(),
  },
]

describe('grant expiry on the Agent page', () => {
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

  test('a grant that ends says when, with the exact time on hover', async () => {
    const at = new Date(Date.now() + 3 * 3600_000 + 60_000).toISOString()
    await act(async () => root.render(<GrantExpiryText expiresAt={at} />))
    const time = container.querySelector('time')!
    expect(time.textContent).toBe('Ends in 3 hours')
    expect(time.title).toBe(new Date(at).toLocaleString())
  })

  test('a grant that does not end says nothing', async () => {
    await act(async () => root.render(<GrantExpiryText expiresAt={null} />))
    expect(container.textContent).toBe('')
  })

  test('reads expired Connections and ignores what is not one', () => {
    expect(readExpiredConnections([...expired, { connectionId: 1 }, null, 'x'])).toHaveLength(2)
    expect(readExpiredConnections(undefined)).toEqual([])
  })

  test('ended access is a quiet collapsed line, with a way to grant again when it can be', async () => {
    await act(async () =>
      root.render(
        <ExpiredConnections
          workflowId="workflow-1"
          expired={readExpiredConnections(expired)}
          grantable={[{ id: 'c1', name: 'GitHub', serviceType: 'http' }]}
          canGrant
        />
      )
    )
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    expect(toggle.textContent).toBe('Access ended: GitHub, Datadog')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('li')).toBeNull()

    await act(async () => toggle.click())
    const rows = container.querySelectorAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Ended 2 days ago')
    expect(rows[0].querySelector('button')!.textContent).toBe('Grant again')
    expect(rows[0].querySelector('button')!.dataset.connection).toBe('c1')
    // Datadog is no longer active, so there is nothing to grant.
    expect(rows[1].querySelector('button')).toBeNull()
  })

  test('without permission there is nothing to grant again', async () => {
    await act(async () =>
      root.render(
        <ExpiredConnections
          workflowId="workflow-1"
          expired={readExpiredConnections(expired)}
          grantable={[{ id: 'c1', name: 'GitHub', serviceType: 'http' }]}
          canGrant={false}
        />
      )
    )
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()
    )
    expect(container.querySelector('li button')).toBeNull()
  })

  test('nothing ended, nothing shown', async () => {
    await act(async () =>
      root.render(<ExpiredConnections workflowId="w" expired={[]} grantable={[]} canGrant />)
    )
    expect(container.textContent).toBe('')
  })
})

describe('temporary allows on a grant', () => {
  let container: HTMLDivElement
  let root: Root
  let remove: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    remove = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([remove, { loading: false }])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const soon = () => new Date(Date.now() + 3 * 3600_000 + 60_000).toISOString()
  const grant = (temporaryAllows: unknown) => ({
    id: 'grant-1',
    connection: { name: 'GitHub' },
    temporaryAllows,
  })
  const open = async (next: ReturnType<typeof grant>, canRemove = true) => {
    await act(async () => root.render(<GrantTemporaryAllows grant={next} canRemove={canRemove} />))
    await act(async () => buttonNamed(container, 'Temporary allows (1)')!.click())
  }

  test('a grant with none shows nothing, and so does one whose allows have all ended', async () => {
    await act(async () => root.render(<GrantTemporaryAllows grant={grant([])} canRemove />))
    expect(container.textContent).toBe('')
    await act(async () =>
      root.render(
        <GrantTemporaryAllows
          grant={grant([
            { id: 'a', class: 'read', expiresAt: new Date(Date.now() - 1000).toISOString() },
          ])}
          canRemove
        />
      )
    )
    expect(container.textContent).toBe('')
  })

  test('lists each allow in words with when it ends, hiding the ended ones', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString()
    await act(async () =>
      root.render(
        <GrantTemporaryAllows
          grant={grant([
            { id: 'a', match: { methods: ['DELETE'], path: '/repos/acme/x' }, expiresAt: soon() },
            { id: 'b', operation: 'ec2:TerminateInstances', expiresAt: soon() },
            { id: 'c', class: 'read', expiresAt: past },
          ])}
          canRemove
        />
      )
    )
    // The control is a count; two are in force.
    await act(async () => buttonNamed(container, 'Temporary allows (2)')!.click())
    const list = container.querySelector('[aria-label="Temporary allows"]')!
    expect(list.textContent).toContain('DELETE /repos/acme/x')
    expect(list.textContent).toContain('AWS action ec2:TerminateInstances')
    expect(list.textContent).toContain('ends in 3 hours')
    expect(list.textContent).not.toContain('Read calls')
    expect(list.querySelectorAll('[data-confirm]')).toHaveLength(2)
  })

  test('each allow can be removed early, after a confirmation', async () => {
    await open(grant([{ id: 'allow-1', operation: 'ec2:TerminateInstances', expiresAt: soon() }]))
    expect(
      container.querySelector(
        'button[aria-label="Remove temporary allow for AWS action ec2:TerminateInstances"]'
      )
    ).not.toBeNull()
    expect(remove).not.toHaveBeenCalled()

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Confirm Remove temporary allow"]')!
        .click()
    )
    expect(remove).toHaveBeenCalledWith({
      variables: { grantId: 'grant-1', allowId: 'allow-1' },
      refetchQueries: ['GetAgentDetail'],
      awaitRefetchQueries: true,
    })
  })

  test('without permission to update the Workflow the allows are listed but cannot be removed', async () => {
    await open(grant([{ id: 'allow-1', class: 'read', expiresAt: soon() }]), false)
    expect(container.textContent).toContain('Read calls')
    expect(container.querySelector('[data-confirm]')).toBeNull()
  })
})
