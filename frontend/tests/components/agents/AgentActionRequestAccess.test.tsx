import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import {
  AgentActionApproveDialog,
  AgentActionReview,
  type AgentActionRequest,
} from '@/components/agents/AgentActionRequest'
import GetAgentSettings from '@/graphql/queries/agents/getAgentSettings.gql'
import { buttonNamed, click, field, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  ApproveAgentRequestActionOp: 'approve',
}))
jest.mock('@/graphql/queries/agents/getAgentSettings.gql', () => ({
  __esModule: true,
  default: Symbol('GetAgentSettings'),
}))
jest.mock('@/graphql/queries/syncing/getServerKey.gql', () => ({
  __esModule: true,
  default: Symbol('GetServerKey'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('@/components/common/GenericDialog', () =>
  jest.requireActual('./customConnectionTestKit').dialogMock()
)
jest.mock('@/components/agents/AgentSelect', () =>
  jest.requireActual('./customConnectionTestKit').selectMock()
)
jest.mock('@/components/agents/AgentDialogs', () => ({ ConfirmAgentAction: () => null }))
jest.mock('@/components/agents/HardenedRequestMarkdown', () => ({
  HardenedRequestMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const base = {
  id: 'request-1',
  status: 'pending',
  revision: 'request-v1',
  workflow: { name: 'Default' },
  agent: { name: 'Deploy Agent' },
  connection: { id: 'connection-1', name: 'GitHub' },
}

const blockedCall = {
  method: 'DELETE',
  host: 'api.github.com',
  path: '/repos/acme/x',
  class: 'delete',
}

const allowRequest = (): AgentActionRequest => ({
  ...base,
  title: 'Allow DELETE /repos/acme/x on GitHub',
  durationSeconds: 3600,
  action: {
    type: 'agent_grant.allow',
    version: 1,
    connectionId: 'connection-1',
    allow: { match: { methods: ['DELETE'], path: '/repos/acme/x' } },
    blockedCall,
  },
  actionReview: {
    type: 'agent_grant.allow',
    title: 'Allow DELETE /repos/acme/x on GitHub',
    requiresSecret: false,
    current: {
      name: 'GitHub',
      policy: { version: 1, default: 'allow', rules: [{ class: 'delete', effect: 'ask' }] },
      temporaryAllows: [],
    },
    requested: {
      allow: { match: { methods: ['DELETE'], path: '/repos/acme/x' } },
      blockedCall,
      durationSeconds: 3600,
    },
  },
})

const renewRequest = (): AgentActionRequest => ({
  ...base,
  title: 'Renew access to GitHub',
  durationSeconds: 86400,
  action: { type: 'agent_grant.renew', version: 1, connectionId: 'connection-1' },
  actionReview: {
    type: 'agent_grant.renew',
    title: 'Renew access to GitHub',
    requiresSecret: false,
    current: { name: 'GitHub', state: 'expired', expiresAt: '2026-11-13T10:00:00Z' },
    requested: { durationSeconds: 86400 },
  },
})

const contextRequest = (
  requested = '# Notes\nUse the staging repo.\n<script>alert(1)</script>'
): AgentActionRequest => ({
  ...base,
  connection: null,
  title: 'Update the context of Default',
  action: { type: 'agent_workflow.context_update', version: 1, markdown: requested },
  actionReview: {
    type: 'agent_workflow.context_update',
    title: 'Update the context of Default',
    requiresSecret: false,
    current: { markdown: '# Notes\nUse the production repo.' },
    requested: { markdown: requested },
  },
})

describe('reviewing requests for access, renewals and context', () => {
  let container: HTMLDivElement
  let root: Root
  let approve: jest.Mock
  let maximum: number | undefined
  let fallback: number | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    maximum = 86400
    fallback = 28800
    approve = jest
      .fn()
      .mockResolvedValue({ data: { approveAgentRequestAction: { runtimeAction: 'retry' } } })
    ;(useMutation as jest.Mock).mockReturnValue([approve, { loading: false }])
    ;(useQuery as jest.Mock).mockImplementation((document) =>
      document === GetAgentSettings
        ? {
            data: maximum
              ? {
                  agentSettings: {
                    maxRequestDurationSeconds: maximum,
                    defaultRequestDurationSeconds: fallback,
                  },
                }
              : undefined,
          }
        : { data: { serverPublicKey: 'key' } }
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const open = async (request: AgentActionRequest) => {
    await act(async () =>
      root.render(<AgentActionApproveDialog request={request} organisationId="org-1" />)
    )
    await click(container, 'Review and approve')
  }
  const select = (suffix: string) =>
    container.querySelector<HTMLSelectElement>(`select[id$="${suffix}"]`)!
  const choose = async (element: HTMLSelectElement, value: string) =>
    act(async () => {
      element.value = value
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
  const options = (element: HTMLSelectElement) =>
    Array.from(element.options).map((option) => option.value)
  const approved = async (label: string) => {
    await click(container, label)
    await settle(() => approve.mock.calls.length > 0)
    return approve.mock.calls[0][0].variables
  }

  describe('an allow', () => {
    test('shows the call that was refused, the rule that would be added, and that it is temporary', async () => {
      await open(allowRequest())

      const text = container.textContent!
      expect(text).toContain('The call that was refused')
      expect(text).toContain('DELETE api.github.com')
      expect(text).toContain('/repos/acme/x')
      expect(text).toContain('Rule that would be added')
      expect(text).toContain('Allow DELETE /repos/acme/x')
      expect(text).toContain('This is temporary')
      expect(text).toContain('asked for 1 hour')
      expect(text).toContain(
        "The Connection's rules now: reads, create and update allowed, delete ask."
      )
    })

    test('starts at the requested duration and never offers until revoked', async () => {
      await open(allowRequest())

      const duration = select('-duration')
      expect(duration.value).toBe('1h')
      expect(options(duration)).not.toContain('forever')
      expect(options(duration)).toEqual(['1h', '8h', '24h', '7d', 'custom'])
    })

    test('approves for the requested duration, as filed', async () => {
      await open(allowRequest())
      const variables = await approved('Approve and allow')

      expect(variables).toMatchObject({
        requestId: 'request-1',
        expectedRevision: 'request-v1',
        durationSeconds: 3600,
      })
      expect(variables).not.toHaveProperty('untilRevoked')
      expect(variables).not.toHaveProperty('action')
    })

    test('a different duration is sent as chosen, within the organisation maximum', async () => {
      await open(allowRequest())
      await choose(select('-duration'), '24h')
      expect((await approved('Approve and allow')).durationSeconds).toBe(86400)
    })

    test('refuses a duration beyond the organisation maximum', async () => {
      await open(allowRequest())
      await choose(select('-duration'), '7d')

      expect(container.textContent).toContain('Your organisation allows at most 1 day here')
      expect(buttonNamed(container, 'Approve and allow')!.disabled).toBe(true)
    })

    test('an allow with no duration starts at the organisation default and sends it', async () => {
      fallback = 3600
      const request = allowRequest()
      await open({
        ...request,
        durationSeconds: null,
        actionReview: {
          ...(request.actionReview as object),
          requested: { ...(request.actionReview as any).requested, durationSeconds: undefined },
        } as any,
      })
      expect(select('-duration').value).toBe('1h')
      expect((await approved('Approve and allow')).durationSeconds).toBe(3600)
    })

    test('the reviewer can narrow the rule before approving', async () => {
      await open(allowRequest())
      await click(container, 'Narrow the rule')
      await type(field(container, 'Path'), '/repos/acme/x/*')

      expect(container.textContent).toContain('Allow DELETE /repos/acme/x/*')
      const variables = await approved('Approve and allow')
      expect(variables.action).toEqual({
        type: 'agent_grant.allow',
        version: 1,
        connectionId: 'connection-1',
        allow: { match: { methods: ['DELETE'], path: '/repos/acme/x/*' } },
        blockedCall,
      })
    })

    test('a class request can be narrowed to the refused call, and never to credential minting', async () => {
      const request = allowRequest()
      ;(request.action as any).allow = { class: 'delete' }
      ;(request.actionReview as any).requested.allow = { class: 'delete' }
      await open(request)
      await click(container, 'Narrow the rule')

      const kinds = Array.from(container.querySelectorAll<HTMLSelectElement>('select')).flatMap(
        (element) => options(element)
      )
      expect(kinds).not.toContain('credential_minting')
      await choose(select('-allow-scope'), 'match')
      await type(field(container, 'Path'), '/repos/acme/x')
      const variables = await approved('Approve and allow')
      expect(variables.action.allow).toEqual({
        match: { methods: ['DELETE'], path: '/repos/acme/x' },
      })
      expect(JSON.stringify(variables)).not.toContain('credential_minting')
    })

    test('the request list shows the same rule without a dialog', async () => {
      await act(async () => root.render(<AgentActionReview request={allowRequest()} />))
      expect(container.textContent).toContain('Allow DELETE /repos/acme/x')
      expect(container.textContent).toContain('This is temporary')
    })
  })

  describe('a renewal', () => {
    test('shows the Connection, where its access stands and the duration asked for', async () => {
      await open(renewRequest())

      const text = container.textContent!
      expect(text).toContain('GitHub')
      expect(text).toContain('Expired')
      expect(text).toContain('1 day')
    })

    test('offers until revoked, and sends it', async () => {
      await open(renewRequest())
      expect(select('-duration').value).toBe('24h')
      expect(options(select('-duration'))).toContain('forever')

      await choose(select('-duration'), 'forever')
      const variables = await approved('Approve renewal')
      expect(variables.untilRevoked).toBe(true)
      expect(variables).not.toHaveProperty('durationSeconds')
    })

    test('a renewal with no duration starts at the organisation default and sends it', async () => {
      fallback = 604800
      const request = renewRequest()
      await open({
        ...request,
        durationSeconds: null,
        actionReview: { ...(request.actionReview as object), requested: {} } as any,
      })
      expect(select('-duration').value).toBe('7d')
      expect(container.textContent).not.toContain('The Agent asked for')
      expect((await approved('Approve renewal')).durationSeconds).toBe(604800)
    })

    test('a custom duration is sent in seconds', async () => {
      await open(renewRequest())
      await choose(select('-duration'), 'custom')
      await type(field(container, 'Custom duration'), '3')
      await choose(select('-unit'), 'days')

      expect((await approved('Approve renewal')).durationSeconds).toBe(259200)
    })

    test('a duration below the minimum is refused', async () => {
      await open(renewRequest())
      await choose(select('-duration'), 'custom')
      await choose(select('-unit'), 'minutes')
      await type(field(container, 'Custom duration'), '2')

      expect(container.textContent).toContain('at least 5 minutes')
      expect(buttonNamed(container, 'Approve renewal')!.disabled).toBe(true)
    })
  })

  describe('a context change', () => {
    test('shows a line diff as plain text and warns it is text an Agent wrote', async () => {
      await open(contextRequest())

      const diff = container.querySelector('pre[aria-label="Changes to the context"]')!
      expect(diff.textContent).toContain('Use the production repo.')
      expect(diff.textContent).toContain('Use the staging repo.')
      expect(diff.textContent).toContain('<script>alert(1)</script>')
      // Text, never markup.
      expect(container.querySelector('script')).toBeNull()
      expect(container.textContent).toContain('text an Agent wrote')
    })

    test('has no duration to grant', async () => {
      await open(contextRequest())
      expect(container.querySelector('select')).toBeNull()
      expect(container.textContent).not.toContain('Grant access for')
    })

    test('is approved as filed when untouched', async () => {
      await open(contextRequest())
      const variables = await approved('Approve context change')
      expect(variables).not.toHaveProperty('action')
      expect(variables).not.toHaveProperty('durationSeconds')
    })

    test('the reviewer can edit the requested text before approving', async () => {
      await open(contextRequest())
      await click(container, 'Edit request')
      const text = container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Requested context"]'
      )!
      expect(text.maxLength).toBe(16384)
      await type(text, '# Notes\nUse the staging repo.')

      expect(container.textContent).toContain('Your edits')
      const variables = await approved('Approve context change')
      expect(variables.action).toEqual({
        type: 'agent_workflow.context_update',
        version: 1,
        markdown: '# Notes\nUse the staging repo.',
      })
    })

    test('text over the cap cannot be approved', async () => {
      await open(contextRequest())
      await click(container, 'Edit request')
      await type(
        container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Requested context"]')!,
        'x'.repeat(16385)
      )
      expect(container.textContent).toContain('16,385 / 16,384: too long to save')
      expect(buttonNamed(container, 'Approve context change')!.disabled).toBe(true)
    })
  })

  describe('a new Connection', () => {
    const createWith = (durationSeconds: number | null): AgentActionRequest => ({
      ...base,
      connection: null,
      title: 'Add Connection: Example API',
      durationSeconds,
      action: { type: 'agent_connection.create', version: 1, serviceType: 'http', name: 'Example' },
      actionReview: {
        type: 'agent_connection.create',
        title: 'Add Connection: Example API',
        requiresSecret: true,
        current: null,
        requested: {
          name: 'Example',
          definition: {
            specVersion: 1,
            hosts: [{ match: 'exact', value: 'api.example.com' }],
            fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' } }],
            injections: [
              { type: 'header', name: 'Authorization', prefix: 'Bearer ', field: 'token' },
            ],
          },
          ...(durationSeconds ? { durationSeconds } : {}),
        },
      },
    })

    test('starts at the requested duration and offers until revoked', async () => {
      await open(createWith(28800))
      expect(select('-duration').value).toBe('8h')
      expect(options(select('-duration'))).toContain('forever')
      expect(container.textContent).toContain('asked for 8 hours')
    })

    test('a request with no duration starts at the organisation default', async () => {
      await open(createWith(null))
      expect(select('-duration').value).toBe('8h')
      // The hint is only for a duration the Agent named.
      expect(container.textContent).not.toContain('The Agent asked for')
    })

    test('a request with no duration and no default read yet holds Approve back', async () => {
      ;(useQuery as jest.Mock).mockImplementation((document) =>
        document === GetAgentSettings
          ? { data: undefined, loading: true }
          : { data: { serverPublicKey: 'key' } }
      )
      await open(createWith(null))
      expect(container.textContent).toContain('Reading the organisation default duration.')
      expect(buttonNamed(container, 'Approve and create')!.disabled).toBe(true)
    })

    test('an unusual request keeps its own value as "As requested"', async () => {
      await open(createWith(5400))
      expect(select('-duration').value).toBe('requested')
      expect(
        Array.from(select('-duration').options).find((option) => option.value === 'requested')!
          .textContent
      ).toBe('As requested (90 minutes)')
    })
  })

  describe('once resolved', () => {
    const resolved = (access: unknown, action = allowRequest()): AgentActionRequest => ({
      ...action,
      status: 'approved',
      appliedAction: action.action,
      access,
    })

    test('says what was asked and what was granted', async () => {
      await act(async () =>
        root.render(
          <AgentActionReview
            request={resolved({
              requestedDurationSeconds: 3600,
              grantedDurationSeconds: 28800,
              expiresAt: '2026-11-14T18:00:00Z',
            })}
          />
        )
      )
      expect(container.textContent).toContain('Asked for 1 hour.')
      expect(container.textContent).toContain('Granted 8 hours')
    })

    test('access granted until revoked says so', async () => {
      await act(async () =>
        root.render(
          <AgentActionReview
            request={resolved(
              { requestedDurationSeconds: 3600, grantedDurationSeconds: null, expiresAt: null },
              renewRequest()
            )}
          />
        )
      )
      expect(container.textContent).toContain('Granted until revoked.')
      expect(container.textContent).toContain('renewed')
    })

    test('a renewal of access with no end does not read as a short grant', async () => {
      const record = { requestedDurationSeconds: 900, grantedDurationSeconds: 900, expiresAt: null }
      const request = renewRequest()
      await act(async () =>
        root.render(
          <AgentActionReview
            request={{
              ...resolved(record, request),
              appliedAction: { ...(request.action as object), access: record },
            }}
          />
        )
      )
      expect(container.textContent).toContain('Access stays until revoked.')
      expect(container.textContent).not.toContain('Granted 15 minutes')
      // The access record the server adds is not a reviewer's edit.
      expect(container.textContent).not.toContain('Edited by the reviewer')
    })

    test('a denied allow does not read as allowed', async () => {
      await act(async () =>
        root.render(
          <AgentActionReview
            request={{ ...allowRequest(), status: 'denied', appliedAction: null }}
          />
        )
      )
      expect(container.textContent).not.toMatch(/Allowed .* for a limited time/)
      expect(container.textContent).toContain(
        'Asked to allow DELETE /repos/acme/x for a limited time.'
      )
    })
  })
})
