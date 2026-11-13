import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import {
  AgentActionApproveDialog,
  AgentActionReview,
  type AgentActionRequest,
} from '@/components/agents/AgentActionRequest'
import { decryptAsymmetric, randomFormattedKeyPair } from '@/utils/crypto/general'
import type { HttpDefinition } from '@/utils/agents/httpDefinition'
import { buttonNamed, click, field, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  ApproveAgentRequestActionOp: 'approve',
  CreateCustomAgentConnectionOp: 'create',
  UpdateCustomAgentConnectionOp: 'update',
  UpdateCustomAgentConnectionSecretOp: 'secret',
  RotateCustomAgentConnectionKeyOp: 'rotate',
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

const SECRET = 'real-secret-value'

const current: HttpDefinition = {
  specVersion: 1,
  hosts: [{ match: 'exact', value: 'api.example.com', path: '/v1/*' }],
  fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' } }],
  injections: [
    {
      type: 'header',
      name: 'Authorization',
      prefix: 'Bearer ',
      field: 'token',
      whenAbsent: 'attach',
    },
  ],
  preset: 'bearer',
}
const withPath = (path: string): HttpDefinition => ({
  ...current,
  hosts: [{ match: 'exact', value: 'api.example.com', path }],
})
const otherHost: HttpDefinition = {
  ...current,
  hosts: [{ match: 'exact', value: 'api.example.org', path: '/v1/*' }],
}

describe('reviewing a request that carries an action', () => {
  let container: HTMLDivElement
  let root: Root
  let approve: jest.Mock
  let server: { publicKey: string; privateKey: string }
  let connectionKey: { publicKey: string; privateKey: string }

  beforeAll(async () => {
    server = await randomFormattedKeyPair('hex')
    connectionKey = await randomFormattedKeyPair('hex')
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    approve = jest
      .fn()
      .mockResolvedValue({ data: { approveAgentRequestAction: { runtimeAction: 'retry' } } })
    ;(useMutation as jest.Mock).mockReturnValue([approve, { loading: false }])
    ;(useQuery as jest.Mock).mockReturnValue({ data: { serverPublicKey: server.publicKey } })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const base = {
    id: 'request-1',
    status: 'pending',
    revision: 'request-v5',
    workflow: { name: 'Default' },
    agent: { name: 'Deploy Agent' },
  }
  const createRequest = (): AgentActionRequest => ({
    ...base,
    title: 'Add Connection: Example API',
    action: {
      type: 'agent_connection.create',
      version: 1,
      serviceType: 'http',
      name: 'Example API',
      definition: current,
    },
    actionReview: {
      type: 'agent_connection.create',
      title: 'Add Connection: Example API',
      requiresSecret: true,
      current: null,
      proposed: { name: 'Example API', definition: current },
    },
    connection: null,
  })
  const updateRequest = (
    proposed: HttpDefinition,
    requiresSecret: boolean
  ): AgentActionRequest => ({
    ...base,
    title: 'Change hosts on Example API',
    action: {
      type: 'agent_connection.update',
      version: 1,
      connectionId: 'connection-1',
      definition: proposed,
    },
    actionReview: {
      type: 'agent_connection.update',
      title: 'Change hosts on Example API',
      requiresSecret,
      current: { name: 'Example API', definition: current },
      proposed: { name: 'Example API', definition: proposed },
    },
    connection: {
      id: 'connection-1',
      name: 'Example API',
      encryptionPublicKey: connectionKey.publicKey,
    },
  })
  const targetRequest = (type: string, requiresSecret: boolean): AgentActionRequest => ({
    ...base,
    title: type.endsWith('remove') ? 'Remove Example API from Default' : 'Update the secret',
    action: { type, version: 1, connectionId: 'connection-1' },
    actionReview: {
      type,
      title: 'Example',
      requiresSecret,
      current: { name: 'Example API', definition: current },
      proposed: null,
    },
    connection: {
      id: 'connection-1',
      name: 'Example API',
      encryptionPublicKey: connectionKey.publicKey,
    },
  })

  const open = async (request: AgentActionRequest) => {
    await act(async () => root.render(<AgentActionApproveDialog request={request} />))
    await click(container, 'Review and approve')
  }
  const secretInputs = () =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]'))
  const approved = async (label: string) => {
    await click(container, label)
    await settle(() => approve.mock.calls.length > 0)
    return approve.mock.calls[0][0].variables
  }
  const opened = async (ciphertext: string) =>
    JSON.parse(
      await decryptAsymmetric(ciphertext, connectionKey.privateKey, connectionKey.publicKey)
    )

  test('a new Connection is approved as filed, with the secret the reviewer enters', async () => {
    await open(createRequest())

    expect(container.textContent).toContain('Proposed by the Agent')
    expect(container.textContent).toContain('api.example.com/v1/*')
    // Agents never set a secret: approving always asks for it.
    expect(secretInputs()).toHaveLength(1)
    expect(buttonNamed(container, 'Approve and create')!.disabled).toBe(true)
    await type(secretInputs()[0], SECRET)

    const variables = await approved('Approve and create')
    expect(variables).toMatchObject({
      requestId: 'request-1',
      expectedRevision: 'request-v5',
      resolutionNote: null,
    })
    // Untouched, so the proposal is applied as it stands.
    expect(variables).not.toHaveProperty('action')
    expect(Object.keys(variables.inputs).sort()).toEqual([
      'encryptionPublicKey',
      'sealedValue',
      'serverWrappedKey',
    ])
    expect(JSON.stringify(variables)).not.toContain(SECRET)
    const privateKey = await decryptAsymmetric(
      variables.inputs.serverWrappedKey,
      server.privateKey,
      server.publicKey
    )
    expect(
      JSON.parse(
        await decryptAsymmetric(
          variables.inputs.sealedValue,
          privateKey,
          variables.inputs.encryptionPublicKey
        )
      )
    ).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: { token: SECRET },
    })
  })

  test('the reviewer can edit the proposal before approving it', async () => {
    await open(createRequest())
    await click(container, 'Edit proposal')
    await type(field(container, 'Connection name'), 'Example API (production)')
    await type(field(container, 'Path for host 1 (optional)'), '/v2/*')

    expect(container.textContent).toContain('Your edited proposal')
    await type(secretInputs()[0], SECRET)
    const variables = await approved('Approve and create')

    expect(variables.action).toEqual({
      type: 'agent_connection.create',
      version: 1,
      serviceType: 'http',
      name: 'Example API (production)',
      definition: withPath('/v2/*'),
    })
    expect(Object.keys(variables.inputs).sort()).toEqual([
      'encryptionPublicKey',
      'sealedValue',
      'serverWrappedKey',
    ])
  })

  test('an edit can be reset to what the Agent proposed', async () => {
    await open(createRequest())
    await click(container, 'Edit proposal')
    await type(field(container, 'Path for host 1 (optional)'), '/v2/*')
    expect(buttonNamed(container, 'Reset to the proposal')).toBeDefined()

    await click(container, 'Reset to the proposal')
    expect(container.textContent).toContain('Proposed by the Agent')
    expect(field(container, 'Path for host 1 (optional)').value).toBe('/v1/*')
  })

  test('a change that keeps the hosts needs no secret', async () => {
    await open(updateRequest(withPath('/v2/*'), false))

    expect(secretInputs()).toHaveLength(0)
    // The diff sets the proposal against the Connection as it is.
    expect(container.textContent).toContain('api.example.com/v1/*')
    expect(container.textContent).toContain('api.example.com/v2/*')

    const variables = await approved('Approve change')
    expect(variables).not.toHaveProperty('action')
    expect(variables).not.toHaveProperty('inputs')
  })

  test('a change of hosts asks for the secret, sealed to the Connection over the new hosts', async () => {
    await open(updateRequest(otherHost, true))

    expect(container.textContent).toContain('The allowed hosts changed.')
    expect(secretInputs()).toHaveLength(1)
    expect(buttonNamed(container, 'Approve change')!.disabled).toBe(true)
    await type(secretInputs()[0], SECRET)

    const variables = await approved('Approve change')
    expect(variables).not.toHaveProperty('action')
    expect(Object.keys(variables.inputs)).toEqual(['sealedValue'])
    expect(await opened(variables.inputs.sealedValue)).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.org' }],
      fields: { token: SECRET },
    })
  })

  test("the reviewer's own change of hosts asks for the secret too", async () => {
    await open(updateRequest(withPath('/v2/*'), false))
    expect(secretInputs()).toHaveLength(0)

    await click(container, 'Edit proposal')
    await type(field(container, 'Host 1'), 'files.example.com')
    expect(secretInputs()).toHaveLength(1)
    await type(secretInputs()[0], SECRET)

    const variables = await approved('Approve change')
    expect(variables.action).toEqual({
      type: 'agent_connection.update',
      version: 1,
      connectionId: 'connection-1',
      name: 'Example API',
      definition: {
        ...current,
        hosts: [{ match: 'exact', value: 'files.example.com', path: '/v2/*' }],
      },
    })
    expect((await opened(variables.inputs.sealedValue)).hosts).toEqual([
      { match: 'exact', value: 'files.example.com' },
    ])
  })

  test('a secret update carries only the newly sealed value', async () => {
    await open(targetRequest('agent_connection.secret_update', true))

    expect(container.textContent).toContain('enter a new secret for Example API')
    expect(buttonNamed(container, 'Edit proposal')).toBeUndefined()
    await type(secretInputs()[0], 'next-secret-value')

    const variables = await approved('Update secret')
    expect(variables).not.toHaveProperty('action')
    expect(Object.keys(variables.inputs)).toEqual(['sealedValue'])
    expect(await opened(variables.inputs.sealedValue)).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: { token: 'next-secret-value' },
    })
  })

  test('a removal needs no inputs at all', async () => {
    await open(targetRequest('agent_connection.remove', false))

    expect(container.textContent).toContain("Removes the Default Workflow's access to Example API")
    expect(secretInputs()).toHaveLength(0)
    const note = container.querySelector('textarea')!
    await type(note, 'No longer needed.')

    const variables = await approved('Approve removal')
    expect(variables).toEqual({
      requestId: 'request-1',
      expectedRevision: 'request-v5',
      resolutionNote: 'No longer needed.',
    })
  })

  test('refuses to approve a request that changed during the review', async () => {
    const request = updateRequest(withPath('/v2/*'), false)
    await open(request)
    await act(async () =>
      root.render(<AgentActionApproveDialog request={{ ...request, revision: 'request-v6' }} />)
    )

    expect(container.textContent).toContain('This request changed while you were reviewing it')
    expect(buttonNamed(container, 'Approve change')!.disabled).toBe(true)
    expect(approve).not.toHaveBeenCalled()
  })

  test('shows the server refusal and keeps the dialog open', async () => {
    approve.mockRejectedValue(
      new Error('The Connection changed after this request was made; start a new request')
    )
    await open(updateRequest(withPath('/v2/*'), false))
    await click(container, 'Approve change')
    await settle(() => approve.mock.calls.length > 0)
    await settle(() => !!container.querySelector('[role="alert"]'))

    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'The Connection changed after this request was made'
    )
  })

  describe('on the request card', () => {
    const show = async (request: AgentActionRequest) =>
      act(async () => root.render(<AgentActionReview request={request} />))

    test('a pending change shows what is added, removed and changed', async () => {
      await show(updateRequest(otherHost, true))

      expect(container.textContent).toContain('Proposed action')
      const hosts = Array.from(container.querySelectorAll('li')).map((item) => item.textContent)
      expect(hosts).toContain('+Added: api.example.org/v1/*')
      expect(hosts).toContain('−Removed: api.example.com/v1/*')
      expect(container.textContent).toContain('Approving this asks you for the secret.')
    })

    test('an approved one shows what was applied and how it was approved', async () => {
      const request = updateRequest(withPath('/v2/*'), false)
      await show({
        ...request,
        status: 'approved',
        appliedAction: { ...(request.action as object), definition: withPath('/v3/*') },
        approval: { version: 1, assurance: 'session' },
      })

      expect(container.textContent).toContain('Applied action')
      expect(container.textContent).toContain('Edited by the reviewer')
      expect(container.textContent).toContain('api.example.com/v3/*')
      expect(container.textContent).toContain('Approved with a signed-in Console session.')
    })

    test('a denied one keeps the proposal, with no approval line', async () => {
      await show({ ...updateRequest(withPath('/v2/*'), false), status: 'denied' })

      expect(container.textContent).toContain('Proposed action')
      expect(container.textContent).toContain('api.example.com/v2/*')
      expect(container.textContent).not.toContain('Approved with')
    })

    test('an action whose target is gone says so', async () => {
      await show({ ...updateRequest(withPath('/v2/*'), false), actionReview: null })

      expect(container.textContent).toContain('can no longer be reviewed')
    })
  })
})
