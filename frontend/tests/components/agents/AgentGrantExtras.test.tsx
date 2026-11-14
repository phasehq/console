import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  ExpiredConnections,
  GrantExpiryText,
  readExpiredConnections,
} from '@/components/agents/AgentGrantExtras'

jest.mock('@/components/agents/AgentDialogs', () => ({
  GrantWorkflowDialog: ({ connections, initialConnectionId, triggerLabel }: any) => (
    <button type="button" data-connection={initialConnectionId} data-count={connections.length}>
      {triggerLabel}
    </button>
  ),
}))
jest.mock('@/graphql/mutations/agents/manageAgents.gql', () => ({ GrantAgentWorkflowOp: 'grant' }))
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
          grantable={[{ id: 'c1', name: 'GitHub', serviceType: 'http', takesPolicy: true }]}
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
          grantable={[{ id: 'c1', name: 'GitHub', serviceType: 'http', takesPolicy: true }]}
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
