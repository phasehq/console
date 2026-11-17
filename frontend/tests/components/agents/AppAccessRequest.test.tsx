import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import {
  AgentActionApproveDialog,
  AgentActionReview,
  type AgentActionRequest,
} from '@/components/agents/AgentActionRequest'
import GetAgentSettings from '@/graphql/queries/agents/getAgentSettings.gql'
import { buttonNamed, click, settle } from './customConnectionTestKit'

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
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const environments = [
  { id: 'env-dev', name: 'Development', envType: 'dev' },
  { id: 'env-stg', name: 'Staging', envType: 'staging' },
  { id: 'env-prd', name: 'Production', envType: 'prod' },
]

const appRequest = (
  access: 'read' | 'read_write' = 'read_write',
  current: unknown = null
): AgentActionRequest => ({
  id: 'request-1',
  status: 'pending',
  revision: 'request-v1',
  title: 'Read and write secrets in orders (Development, Staging, Production)',
  durationSeconds: 3600,
  workflow: { name: 'Default' },
  agent: { name: 'Deploy Agent' },
  connection: null,
  action: {
    type: 'agent_connection.app_access',
    version: 1,
    appId: 'app-1',
    environmentIds: environments.map((environment) => environment.id),
    access,
  },
  actionReview: {
    type: 'agent_connection.app_access',
    title: 'Read and write secrets in orders (Development, Staging, Production)',
    requiresSecret: false,
    current,
    requested: {
      app: { id: 'app-1', name: 'orders', sseEnabled: true },
      environments,
      access,
      durationSeconds: 3600,
    },
  },
})

const appAllowRequest = (): AgentActionRequest => ({
  id: 'request-2',
  status: 'pending',
  revision: 'request-v2',
  title: 'Allow create, update and delete secrets on orders secrets',
  durationSeconds: 3600,
  workflow: { name: 'Default' },
  agent: { name: 'Deploy Agent' },
  connection: { id: 'connection-1', name: 'orders secrets' },
  action: {
    type: 'agent_grant.allow',
    version: 1,
    connectionId: 'connection-1',
    allow: { classes: ['create', 'update', 'delete'] },
  },
  actionReview: {
    type: 'agent_grant.allow',
    title: 'Allow create, update and delete secrets on orders secrets',
    requiresSecret: false,
    current: {
      name: 'orders secrets',
      policy: {
        version: 1,
        default: 'allow',
        rules: ['create', 'update', 'delete'].map((name) => ({ class: name, effect: 'ask' })),
      },
      temporaryAllows: [],
      app: { id: 'app-1', name: 'orders' },
      environments: environments.slice(0, 2),
    },
    requested: { allow: { classes: ['create', 'update', 'delete'] }, durationSeconds: 3600 },
  },
})

describe('reviewing a request for app secrets', () => {
  let container: HTMLDivElement
  let root: Root
  let approve: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    approve = jest
      .fn()
      .mockResolvedValue({ data: { approveAgentRequestAction: { runtimeAction: 'retry' } } })
    ;(useMutation as jest.Mock).mockReturnValue([approve, { loading: false }])
    ;(useQuery as jest.Mock).mockImplementation((document) =>
      document === GetAgentSettings
        ? {
            data: {
              agentSettings: {
                maxRequestDurationSeconds: 86400,
                defaultRequestDurationSeconds: 28800,
              },
            },
          }
        : { data: undefined }
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
  const checkbox = (name: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')).find(
      (box) => box.textContent === name
    )!
  const toggle = async (name: string) => act(async () => checkbox(name).click())
  const select = (suffix: string) =>
    container.querySelector<HTMLSelectElement>(`select[id$="${suffix}"]`)
  const choose = async (element: HTMLSelectElement, value: string) =>
    act(async () => {
      element.value = value
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
  const approved = async () => {
    await click(container, 'Approve access')
    await settle(() => approve.mock.calls.length > 0)
    return approve.mock.calls[0][0].variables
  }

  test('shows the app, every environment ticked, the level and both durations', async () => {
    await open(appRequest())

    const text = container.textContent!
    expect(text).toContain('orders')
    expect(
      environments.map((environment) => checkbox(environment.name).getAttribute('aria-checked'))
    ).toEqual(['true', 'true', 'true'])
    const level = container.querySelector('[role="radiogroup"][aria-label="Access"]')!
    expect(level.querySelector('[aria-checked="true"]')!.textContent).toBe('Read and write')
    expect(text).toContain('Grant access for')
    expect(text).toContain('Write access ends after')
    // The write duration starts at what was asked for.
    expect(select('-write-duration')!.value).toBe('1h')
    expect(text).toContain('Approving creates a Connection for these environments')
    // Nothing internal is shown.
    expect(text).not.toContain('read_write')
    expect(text).not.toContain('app_access')
  })

  test('approves as filed, sending the write duration', async () => {
    await open(appRequest())
    const variables = await approved()

    expect(variables).toMatchObject({
      requestId: 'request-1',
      expectedRevision: 'request-v1',
      durationSeconds: 3600,
      inputs: { writeDurationSeconds: 3600 },
    })
    expect(variables).not.toHaveProperty('action')
  })

  test('an unticked environment narrows the approved action, and the last one stays', async () => {
    await open(appRequest())
    await toggle('Production')

    expect(container.textContent).toContain('Your edits')
    const variables = await approved()
    expect(variables.action).toEqual({
      type: 'agent_connection.app_access',
      version: 1,
      appId: 'app-1',
      environmentIds: ['env-dev', 'env-stg'],
      access: 'read_write',
    })
  })

  test('the last ticked environment cannot be unticked', async () => {
    await open(appRequest())
    await toggle('Production')
    await toggle('Staging')

    expect(checkbox('Development').disabled).toBe(true)
    expect(checkbox('Development').getAttribute('aria-checked')).toBe('true')
    expect(buttonNamed(container, 'Approve access')!.disabled).toBe(false)
  })

  test('switching to Read hides the write duration and sends no write input', async () => {
    await open(appRequest())
    await click(container, 'Read')

    expect(container.textContent).not.toContain('Write access ends after')
    expect(select('-write-duration')).toBeNull()
    const variables = await approved()
    expect(variables.action).toMatchObject({ access: 'read' })
    expect(variables).not.toHaveProperty('inputs')
  })

  test('switching a read request to Read and write shows the write duration', async () => {
    await open(appRequest('read'))
    expect(container.textContent).not.toContain('Write access ends after')

    await click(container, 'Read and write')
    expect(container.textContent).toContain('Write access ends after')
    const variables = await approved()
    expect(variables.action).toMatchObject({ access: 'read_write' })
    expect(variables.inputs).toEqual({ writeDurationSeconds: 3600 })
  })

  test('write access longer than the organisation maximum cannot be approved', async () => {
    await open(appRequest())
    await choose(select('-write-duration')!, '7d')

    expect(container.textContent).toContain('Your organisation allows at most 1 day here')
    expect(buttonNamed(container, 'Approve access')!.disabled).toBe(true)
  })

  test.each([
    ['7 days', 7 * 86400, 3 * 86400, '3', 'days'],
    ['2 days', 2 * 86400, 12 * 3600, '12', 'hours'],
  ])(
    'a request for %s above an odd organisation maximum starts the write field at the maximum',
    async (_name, asked, maximum, amount, unit) => {
      ;(useQuery as jest.Mock).mockImplementation((document) =>
        document === GetAgentSettings
          ? {
              data: {
                agentSettings: {
                  maxRequestDurationSeconds: maximum,
                  defaultRequestDurationSeconds: 3600,
                },
              },
            }
          : { data: undefined }
      )
      const request = appRequest()
      request.durationSeconds = asked
      ;(request.actionReview as any).requested.durationSeconds = asked
      await open(request)

      expect(select('-write-duration')!.value).toBe('custom')
      expect(
        container.querySelector<HTMLInputElement>('input[id$="-write-duration-amount"]')!.value
      ).toBe(amount)
      expect(select('-write-duration-unit')!.value).toBe(unit)
      expect(container.textContent).not.toMatch(/allows at most .* here/)
      expect(buttonNamed(container, 'Approve access')!.disabled).toBe(false)
      const variables = await approved()
      expect(variables.inputs).toEqual({ writeDurationSeconds: maximum })
    }
  )

  test('a request whose environments are all gone can no longer be applied', async () => {
    const request = appRequest()
    ;(request.actionReview as any).requested.environments = []
    await open(request)

    const approveButton = buttonNamed(container, 'Approve access')!
    expect(approveButton.disabled).toBe(true)
    expect(approveButton.title).toBe('This action can no longer be applied.')
    expect(container.querySelector('[role="checkbox"]')).toBeNull()
  })

  test('names the Connection approval would reuse', async () => {
    await open(
      appRequest('read_write', { connectionId: 'c-1', name: 'orders secrets', policy: {} })
    )

    expect(container.textContent).toContain(
      'Approving reuses the Connection orders secrets, whose access rules apply.'
    )
  })

  test('shows a refusal from the server in the dialog', async () => {
    approve.mockRejectedValue(
      new Error(
        "The access rules of 'orders secrets' block delete calls, and approving a request never changes a block."
      )
    )
    await open(appRequest())
    await click(container, 'Approve access')
    await settle(() => !!container.querySelector('[role="alert"]'))

    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "The access rules of 'orders secrets' block delete calls"
    )
  })

  test('the request card shows the app, environments and level in plain words', async () => {
    await act(async () => root.render(<AgentActionReview request={appRequest()} />))

    const text = container.textContent!
    expect(text).toContain('orders')
    expect(text).toContain('Development, Staging, Production')
    expect(text).toContain('Read and write')
    expect(text).toContain('Asks for access for 1 hour')
  })

  test('an approved request says until when it may write', async () => {
    const request = appRequest()
    request.status = 'approved'
    request.appliedAction = {
      ...(request.action as object),
      writeAccess: { grantedDurationSeconds: 3600, expiresAt: '2026-11-17T12:00:00Z' },
    }
    await act(async () => root.render(<AgentActionReview request={request} />))

    expect(container.textContent).toContain('Read and write access to the app')
    expect(container.textContent).toContain('with write access until')
  })

  describe('an allow on an app Connection', () => {
    test('reads as the secrets it allows, with the app and environments', async () => {
      await open(appAllowRequest())

      const text = container.textContent!
      expect(text).toContain('Create, update and delete secrets')
      expect(text).toContain('orders')
      expect(text).toContain('Development, Staging')
      expect(buttonNamed(container, 'Narrow the rule')).toBeUndefined()
    })

    test('a resolved allow in the singular form reads as secrets too', async () => {
      const request = appAllowRequest()
      request.status = 'approved'
      request.connection = { id: 'connection-1', name: 'orders secrets', serviceType: 'phase_app' }
      request.appliedAction = { type: 'agent_grant.allow', version: 1, allow: { class: 'delete' } }
      await act(async () => root.render(<AgentActionReview request={request} />))

      expect(container.textContent).toContain('Allowed delete secrets for a limited time.')
    })

    test('approves as filed', async () => {
      await open(appAllowRequest())
      await click(container, 'Approve and allow')
      await settle(() => approve.mock.calls.length > 0)

      const variables = approve.mock.calls[0][0].variables
      expect(variables).toMatchObject({ requestId: 'request-2', durationSeconds: 3600 })
      expect(variables).not.toHaveProperty('action')
    })
  })

  describe('a request about an app the reviewer cannot access', () => {
    // As the server sends it to such a member: no app, no environment names.
    const withheld = (): AgentActionRequest => {
      const request = appRequest()
      return {
        ...request,
        title: "Read and write secrets in an app you can't access",
        appRestricted: true,
        hiddenEnvironmentCount: 3,
        actionReview: {
          ...(request.actionReview as Record<string, unknown>),
          title: "Read and write secrets in an app you can't access",
          requested: {
            app: null,
            appRestricted: true,
            environments: [],
            hiddenEnvironmentCount: 3,
            access: 'read_write',
            durationSeconds: 3600,
          },
        },
      }
    }

    test('shows the request with the app withheld and Approve disabled, saying why', async () => {
      await open(withheld())

      const text = container.textContent!
      expect(text).toContain("An app you can't access")
      expect(text).toContain("3 environments you can't access")
      expect(text).toContain('You need access to this app to review this request.')
      expect(text).not.toContain('This action can no longer be applied')
      expect(container.querySelectorAll('[role="checkbox"]')).toHaveLength(0)
      const button = buttonNamed(container, 'Approve access')!
      expect(button.disabled).toBe(true)
      await act(async () => button.click())
      expect(approve).not.toHaveBeenCalled()
    })

    test('with some environments, names those and counts the rest, and cannot approve', async () => {
      const request = appRequest()
      await open({
        ...request,
        hiddenEnvironmentCount: 2,
        actionReview: {
          ...(request.actionReview as Record<string, unknown>),
          requested: {
            app: { id: 'app-1', name: 'orders', sseEnabled: true },
            appRestricted: false,
            environments: environments.slice(0, 1),
            hiddenEnvironmentCount: 2,
            access: 'read_write',
            durationSeconds: 3600,
          },
        },
      })

      const text = container.textContent!
      expect(text).toContain('orders')
      expect(text).toContain("Development+2 more you can't access")
      expect(text).toContain('You need access to every environment in this request to approve it.')
      expect(buttonNamed(container, 'Approve access')!.disabled).toBe(true)
    })

    test('an allow on such a Connection reads as secrets on an app you cannot access', async () => {
      const request = appAllowRequest()
      const review = request.actionReview as Record<string, any>
      await open({
        ...request,
        title: "Allow create secrets on a Connection to an app you can't access",
        appRestricted: true,
        hiddenEnvironmentCount: 2,
        connection: { id: 'connection-1', name: 'App secrets' },
        actionReview: {
          ...review,
          current: {
            ...review.current,
            name: 'App secrets',
            app: null,
            appRestricted: true,
            environments: [],
            hiddenEnvironmentCount: 2,
          },
        },
      })

      const text = container.textContent!
      expect(text).toContain('Create, update and delete secrets')
      expect(text).toContain("An app you can't access")
      expect(text).not.toContain('orders')
      expect(buttonNamed(container, 'Narrow the rule')).toBeUndefined()
      expect(buttonNamed(container, 'Approve and allow')!.disabled).toBe(true)
    })
  })
})

describe('who gains access', () => {
  it('has one sentence saying token holders can read the secrets', () => {
    const { TOKEN_HOLDERS_LINE } = require('@/utils/agents/appAccess')
    expect(TOKEN_HOLDERS_LINE).toBe(
      'Anyone who can create a token for this Agent can read these secrets with it.'
    )
  })
})
