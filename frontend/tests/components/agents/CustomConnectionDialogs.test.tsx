import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import {
  CreateCustomConnectionForm,
  EditCustomConnectionDialog,
  RotateCustomConnectionKeyAction,
  UpdateCustomConnectionSecretDialog,
} from '@/components/agents/CustomConnectionDialogs'
import { decryptAsymmetric, randomFormattedKeyPair } from '@/utils/crypto/general'
import type { HttpDefinition } from '@/utils/agents/httpDefinition'
import { buttonNamed, click, field, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
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
jest.mock('@/components/agents/AgentDialogs', () => ({
  ConfirmAgentAction: ({ title, description, actionLabel, onConfirm }: any) => (
    <div data-confirm={title}>
      <p>{description}</p>
      <button type="button" onClick={() => void onConfirm()}>
        {actionLabel}
      </button>
    </div>
  ),
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const SECRET = 'real-secret-value'

const stored: HttpDefinition = {
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

describe('custom Connection dialogs', () => {
  let container: HTMLDivElement
  let root: Root
  let server: { publicKey: string; privateKey: string }
  let connectionKey: { publicKey: string; privateKey: string }
  const mutations: Record<string, jest.Mock> = {}

  beforeAll(async () => {
    server = await randomFormattedKeyPair('hex')
    connectionKey = await randomFormattedKeyPair('hex')
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    for (const name of ['create', 'update', 'secret', 'rotate'])
      mutations[name] = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockImplementation((document: string) => [
      mutations[document],
      { loading: false },
    ])
    ;(useQuery as jest.Mock).mockReturnValue({ data: { serverPublicKey: server.publicKey } })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const connection = (definition: HttpDefinition = stored) => ({
    id: 'connection-1',
    name: 'Example API',
    serviceType: 'http',
    definition,
    encryptionPublicKey: connectionKey.publicKey,
    keyVersion: 1,
    serverReadable: true,
  })
  const submit = async () =>
    act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  const secretInputs = () =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]'))
  const opened = async (ciphertext: string) =>
    JSON.parse(
      await decryptAsymmetric(ciphertext, connectionKey.privateKey, connectionKey.publicKey)
    )

  test('creates one from a name, a host and a token, sealing the token in the browser', async () => {
    const onCreated = jest.fn()
    await act(async () =>
      root.render(
        <CreateCustomConnectionForm
          organisationId="org-1"
          initialName="Example API"
          serviceSelect={<div />}
          onCreated={onCreated}
        />
      )
    )

    expect(field(container, 'Connection name').value).toBe('Example API')
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(true)
    // A secret is typed into a password input that starts empty.
    const token = field(container, 'Token')
    expect(token.type).toBe('password')
    expect(token.value).toBe('')

    await type(field(container, 'Host 1'), 'api.example.com')
    expect(container.textContent).toContain(
      "curl -H 'Authorization: Bearer <token>' 'https://api.example.com/'"
    )
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(true)
    await type(token, SECRET)
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(false)

    await submit()
    await settle(() => onCreated.mock.calls.length > 0)

    const { variables } = mutations.create.mock.calls[0][0]
    expect(Object.keys(variables).sort()).toEqual([
      'definition',
      'encryptionPublicKey',
      'name',
      'organisationId',
      'sealedValue',
      'serverWrappedKey',
    ])
    expect(variables).toMatchObject({
      organisationId: 'org-1',
      name: 'Example API',
      definition: {
        specVersion: 1,
        hosts: [{ match: 'exact', value: 'api.example.com' }],
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
      },
    })
    expect(variables.encryptionPublicKey).toMatch(/^[0-9a-f]{64}$/)
    // The secret leaves the browser only as ciphertext.
    expect(JSON.stringify(variables)).not.toContain(SECRET)
    const privateKey = await decryptAsymmetric(
      variables.serverWrappedKey,
      server.privateKey,
      server.publicKey
    )
    expect(
      JSON.parse(
        await decryptAsymmetric(variables.sealedValue, privateKey, variables.encryptionPublicKey)
      )
    ).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: { token: SECRET },
    })
    // Nothing of it stays in the form afterwards.
    expect(secretInputs().every((input) => input.value === '')).toBe(true)
  })

  test('says what is wrong with a host or a secret before anything is sent', async () => {
    await act(async () =>
      root.render(
        <CreateCustomConnectionForm
          organisationId="org-1"
          initialName="Example API"
          serviceSelect={<div />}
          onCreated={jest.fn()}
        />
      )
    )

    await type(field(container, 'Host 1'), 'https://api.example.com')
    expect(container.textContent).toContain('Enter the host name only, without a scheme or a path.')
    await type(field(container, 'Host 1'), 'api.example.com')
    await type(field(container, 'Token'), 'short')
    expect(container.textContent).toContain('The secret must be at least 8 bytes long.')
    expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(true)
    expect(mutations.create).not.toHaveBeenCalled()
  })

  test('caps inputs at the lengths the server accepts', async () => {
    await act(async () =>
      root.render(
        <CreateCustomConnectionForm
          organisationId="org-1"
          initialName="Example API"
          serviceSelect={<div />}
          onCreated={jest.fn()}
        />
      )
    )

    expect(field(container, 'Connection name').maxLength).toBe(255)
    expect(field(container, 'Path for host 1 (optional)').maxLength).toBe(1024)
    expect(field(container, 'Port for host 1 (optional)').maxLength).toBe(5)
    expect(field(container, 'Environment variable name (optional)').maxLength).toBe(64)
    expect(field(container, 'Token').maxLength).toBe(16384)
    await click(container, 'Advanced')
    expect(field(container, 'Placeholder prefix (optional)').maxLength).toBe(16)
  })

  test('warns when plain HTTP is allowed and stores the choice', async () => {
    await act(async () =>
      root.render(
        <CreateCustomConnectionForm
          organisationId="org-1"
          initialName="Example API"
          serviceSelect={<div />}
          onCreated={jest.fn()}
        />
      )
    )
    await type(field(container, 'Host 1'), 'api.example.com')
    await type(field(container, 'Token'), SECRET)
    await click(container, 'Advanced')
    expect(container.textContent).not.toContain('anyone on the network path')

    const toggles = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'))
    expect(toggles.map((toggle) => toggle.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    await act(async () => toggles[0].click())
    await act(async () => toggles[1].click())
    expect(container.textContent).toContain('anyone on the network path can read the secret')

    await submit()
    await settle(() => mutations.create.mock.calls.length > 0)
    const { definition } = mutations.create.mock.calls[0][0].variables
    expect(definition.allowPlainHttp).toBe(true)
    expect(definition.injections[0].whenAbsent).toBe('block')
  })

  test('an edit that keeps the hosts and secrets asks for no secret', async () => {
    await act(async () => root.render(<EditCustomConnectionDialog connection={connection()} />))
    await click(container, 'Edit')

    expect(field(container, 'Host 1').value).toBe('api.example.com')
    expect(secretInputs()).toHaveLength(0)
    await type(field(container, 'Path for host 1 (optional)'), '/v2/*')
    expect(secretInputs()).toHaveLength(0)

    await submit()
    await settle(() => mutations.update.mock.calls.length > 0)
    expect(mutations.update.mock.calls[0][0].variables).toEqual({
      connectionId: 'connection-1',
      definition: {
        ...stored,
        hosts: [{ match: 'exact', value: 'api.example.com', path: '/v2/*' }],
      },
    })
  })

  test('an edit that changes the hosts asks for the secret again and says why', async () => {
    await act(async () => root.render(<EditCustomConnectionDialog connection={connection()} />))
    await click(container, 'Edit')

    await type(field(container, 'Host 1'), 'api.example.org')
    expect(container.textContent).toContain('The allowed hosts changed.')
    expect(secretInputs()).toHaveLength(1)
    expect(secretInputs()[0].value).toBe('')
    // Saving waits for the secret.
    expect(buttonNamed(container, 'Save Connection')!.disabled).toBe(true)

    await type(secretInputs()[0], SECRET)
    await submit()
    await settle(() => mutations.update.mock.calls.length > 0)

    const { variables } = mutations.update.mock.calls[0][0]
    expect(variables.definition.hosts).toEqual([
      { match: 'exact', value: 'api.example.org', path: '/v1/*' },
    ])
    expect(JSON.stringify(variables)).not.toContain(SECRET)
    // Sealed to the Connection's stored key, over the new hosts.
    expect(await opened(variables.sealedValue)).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.org' }],
      fields: { token: SECRET },
    })
  })

  test('a rename alone sends only the name', async () => {
    await act(async () => root.render(<EditCustomConnectionDialog connection={connection()} />))
    await click(container, 'Edit')
    await type(field(container, 'Connection name'), 'Example API v2')

    await submit()
    await settle(() => mutations.update.mock.calls.length > 0)
    expect(mutations.update.mock.calls[0][0].variables).toEqual({
      connectionId: 'connection-1',
      name: 'Example API v2',
    })
  })

  test('a definition the form cannot express can only be renamed', async () => {
    const mixed: HttpDefinition = {
      ...stored,
      fields: [...stored.fields, { name: 'other', kind: 'secret', source: { type: 'sealed' } }],
      injections: [...stored.injections, { type: 'query', name: 'k', field: 'other' }],
    }
    await act(async () =>
      root.render(<EditCustomConnectionDialog connection={connection(mixed)} />)
    )
    await click(container, 'Edit')

    expect(container.textContent).toContain('uses a shape this form cannot edit')
    expect(container.querySelector('input[aria-label="Host 1"]')).toBeNull()
    expect(container.textContent).toContain('?k=<other>')
  })

  test('updates the secret through write-only inputs, sealed to the stored key', async () => {
    const onOpen = jest.fn()
    await act(async () =>
      root.render(<UpdateCustomConnectionSecretDialog connection={connection()} onOpen={onOpen} />)
    )
    await click(container, 'Update secret')
    // Opening refreshes the Connection, so a rotated key is picked up.
    expect(onOpen).toHaveBeenCalledTimes(1)

    const [input] = secretInputs()
    expect(input.value).toBe('')
    expect(Array.from(container.querySelectorAll('button[type="submit"]'))[0]).toHaveProperty(
      'disabled',
      true
    )
    await type(input, 'next-secret-value')
    await submit()
    await settle(() => mutations.secret.mock.calls.length > 0)

    const { variables } = mutations.secret.mock.calls[0][0]
    expect(Object.keys(variables).sort()).toEqual(['connectionId', 'sealedValue'])
    expect(await opened(variables.sealedValue)).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: { token: 'next-secret-value' },
    })
    expect(secretInputs()[0].value).toBe('')
  })

  test('rotates the key only after a confirmation', async () => {
    await act(async () =>
      root.render(<RotateCustomConnectionKeyAction connection={connection()} />)
    )

    expect(container.querySelector('[data-confirm="Rotate encryption key"]')).not.toBeNull()
    expect(container.textContent).toContain('re-encrypts the stored secret')
    expect(mutations.rotate).not.toHaveBeenCalled()
    await click(container, 'Rotate key')
    await settle(() => mutations.rotate.mock.calls.length > 0)
    expect(mutations.rotate.mock.calls[0][0].variables).toEqual({ connectionId: 'connection-1' })
  })
})
