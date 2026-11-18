import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import {
  CreateCustomConnectionForm,
  EditCustomConnectionDialog,
} from '@/components/agents/CustomConnectionDialogs'
import { decryptAsymmetric, randomFormattedKeyPair } from '@/utils/crypto/general'
import type { HttpDefinition } from '@/utils/agents/httpDefinition'
import { buttonNamed, click, field, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  CreateCustomAgentConnectionOp: 'create',
  UpdateCustomAgentConnectionOp: 'update',
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

// Two secrets, each in its own header.
const twoSecrets: HttpDefinition = {
  specVersion: 1,
  hosts: [{ match: 'exact', value: 'api.example.com' }],
  fields: [
    { name: 'xapikey', kind: 'secret', source: { type: 'sealed' } },
    { name: 'xorgkey', kind: 'secret', source: { type: 'sealed' } },
  ],
  injections: [
    { type: 'header', name: 'X-Api-Key', field: 'xapikey', whenAbsent: 'attach' },
    { type: 'header', name: 'X-Org-Key', field: 'xorgkey', whenAbsent: 'attach' },
  ],
  preset: 'headers',
}

const STORED_MASK = '•'.repeat(40)

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
    for (const name of ['create', 'update'])
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
    expect(field(container, 'Token').maxLength).toBe(16384)
    await click(container, 'Advanced')
    expect(field(container, 'Environment variable name (optional)').maxLength).toBe(64)
    expect(field(container, 'Placeholder prefix (optional)').maxLength).toBe(16)
  })

  test('keeps the environment variable name under Advanced, with a line saying what it is', async () => {
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

    // Not in the form until Advanced is opened.
    expect(container.textContent).not.toContain('Environment variable name')
    await click(container, 'Advanced')
    const advanced = container.querySelector('section[aria-label="Advanced"]')!
    const name = field(container, 'Environment variable name (optional)')
    expect(advanced.contains(name)).toBe(true)
    expect(advanced.textContent).toContain(
      'The variable your SDK or CLI reads its key from. It is set to a placeholder for the Agent, never the real secret.'
    )

    await type(name, 'example_api_key')
    await submit()
    await settle(() => mutations.create.mock.calls.length > 0)
    expect(mutations.create.mock.calls[0][0].variables.definition.fields).toEqual([
      { name: 'token', kind: 'secret', source: { type: 'sealed' }, env: 'EXAMPLE_API_KEY' },
    ])
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

  const save = () => buttonNamed(container, 'Save Connection')!
  const openEdit = async (definition: HttpDefinition = stored, onOpen?: () => void) => {
    await act(async () =>
      root.render(
        <EditCustomConnectionDialog connection={connection(definition)} onOpen={onOpen} />
      )
    )
    await click(container, 'Edit')
  }
  const saved = async () => {
    await submit()
    await settle(() => mutations.update.mock.calls.length > 0)
    return mutations.update.mock.calls[0][0].variables
  }

  test('shows the stored secret as masking dots that are never a value', async () => {
    const onOpen = jest.fn()
    await openEdit(stored, onOpen)

    expect(onOpen).toHaveBeenCalledTimes(1)
    const [token] = secretInputs()
    expect(secretInputs()).toHaveLength(1)
    expect(token).toBe(field(container, 'Token'))
    // Nothing is read back: the dots are a placeholder over an empty input.
    expect(token.value).toBe('')
    expect(token.placeholder).toBe(STORED_MASK)
    expect(token.required).toBe(false)
    expect(container.textContent).not.toContain('Update secret')
    expect(container.textContent).not.toContain('Rotate')
  })

  test('saving is off until something changes, and on again only while it differs', async () => {
    await openEdit()
    expect(save().disabled).toBe(true)
    expect(save().title).toBe('Nothing has changed.')

    await type(field(container, 'Connection name'), 'Example API v2')
    expect(save().disabled).toBe(false)
    await type(field(container, 'Connection name'), 'Example API')
    expect(save().disabled).toBe(true)

    await type(field(container, 'Path for host 1 (optional)'), '/v2/*')
    expect(save().disabled).toBe(false)
    await type(field(container, 'Path for host 1 (optional)'), '/v1/*')
    expect(save().disabled).toBe(true)

    await type(secretInputs()[0], SECRET)
    expect(save().disabled).toBe(false)
    await type(secretInputs()[0], '')
    expect(save().disabled).toBe(true)
    expect(secretInputs()[0].placeholder).toBe(STORED_MASK)

    // Submitting an unchanged form sends nothing.
    await submit()
    expect(mutations.update).not.toHaveBeenCalled()
  })

  test('an edit that keeps the hosts and secrets sends no sealed value', async () => {
    await openEdit()

    expect(field(container, 'Host 1').value).toBe('api.example.com')
    await type(field(container, 'Path for host 1 (optional)'), '/v2/*')
    // The stored secret still stands.
    expect(secretInputs()[0].placeholder).toBe(STORED_MASK)
    expect(container.textContent).not.toContain('enter the secret again')

    expect(await saved()).toEqual({
      connectionId: 'connection-1',
      definition: {
        ...stored,
        hosts: [{ match: 'exact', value: 'api.example.com', path: '/v2/*' }],
      },
    })
  })

  test('a typed secret alone is sealed and sent with nothing else', async () => {
    await openEdit()
    await type(secretInputs()[0], 'next-secret-value')
    expect(secretInputs()[0].required).toBe(true)
    // One secret, so there is nothing else to enter.
    expect(container.textContent).not.toContain('enter all of them')

    const variables = await saved()
    expect(Object.keys(variables).sort()).toEqual(['connectionId', 'sealedValue'])
    expect(JSON.stringify(variables)).not.toContain('next-secret-value')
    expect(await opened(variables.sealedValue)).toEqual({
      v: 1,
      hosts: [{ match: 'exact', value: 'api.example.com' }],
      fields: { token: 'next-secret-value' },
    })
    // Nothing of it stays in the form afterwards.
    expect(secretInputs().every((input) => input.value === '')).toBe(true)
  })

  test('a short secret is refused before anything is sent', async () => {
    await openEdit()
    await type(secretInputs()[0], 'short')

    expect(container.textContent).toContain('The secret must be at least 8 bytes long.')
    expect(save().disabled).toBe(true)
  })

  test('changing one of several secrets asks for all of them, and says so then', async () => {
    await openEdit(twoSecrets)

    const [first, second] = secretInputs()
    expect(secretInputs()).toHaveLength(2)
    expect([first.placeholder, second.placeholder]).toEqual([STORED_MASK, STORED_MASK])
    expect(container.textContent).not.toContain('enter all of them')

    await type(first, 'first-secret-value')
    expect(container.textContent).toContain(
      'The secrets of this Connection are stored together and cannot be read back. To change one, enter all of them.'
    )
    // The other one loses its dots and becomes required.
    expect(secretInputs()[1].placeholder).toBe('')
    expect(secretInputs()[1].required).toBe(true)
    expect(save().disabled).toBe(true)
    expect(save().title).toBe('Enter the secret for xorgkey.')

    await type(secretInputs()[1], 'second-secret-value')
    expect(save().disabled).toBe(false)
    const variables = await saved()
    expect(Object.keys(variables).sort()).toEqual(['connectionId', 'sealedValue'])
    expect((await opened(variables.sealedValue)).fields).toEqual({
      xapikey: 'first-secret-value',
      xorgkey: 'second-secret-value',
    })
  })

  test('clearing what was typed puts the stored secrets back', async () => {
    await openEdit(twoSecrets)
    await type(secretInputs()[0], 'first-secret-value')
    await type(secretInputs()[0], '')

    expect(secretInputs().map((input) => input.placeholder)).toEqual([STORED_MASK, STORED_MASK])
    expect(container.textContent).not.toContain('enter all of them')
    expect(save().disabled).toBe(true)
  })

  test('an edit that changes the hosts asks for the secret again and says why', async () => {
    await openEdit()

    await type(field(container, 'Host 1'), 'api.example.org')
    expect(container.textContent).toContain('The allowed hosts changed.')
    expect(secretInputs()).toHaveLength(1)
    // The dots are gone: the stored value does not fit the new hosts.
    expect(secretInputs()[0].value).toBe('')
    expect(secretInputs()[0].placeholder).toBe('')
    expect(secretInputs()[0].required).toBe(true)
    // Saving waits for the secret.
    expect(save().disabled).toBe(true)

    await type(secretInputs()[0], SECRET)
    const variables = await saved()
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

  test('a port change asks for the secret again too', async () => {
    await openEdit()
    await type(field(container, 'Port for host 1 (optional)'), '8443')

    expect(container.textContent).toContain('The allowed hosts changed.')
    expect(secretInputs()[0].placeholder).toBe('')
    expect(save().disabled).toBe(true)
  })

  test('adding a secret field asks for every secret again', async () => {
    await openEdit(twoSecrets)
    await click(container, 'Add header')

    expect(container.textContent).toContain('The set of secrets changed.')
    expect(secretInputs()).toHaveLength(3)
    expect(secretInputs().map((input) => input.placeholder)).toEqual(['', '', ''])
    expect(secretInputs().every((input) => input.required)).toBe(true)
    expect(save().disabled).toBe(true)
  })

  test('a rename alone sends only the name', async () => {
    await openEdit()
    await type(field(container, 'Connection name'), 'Example API v2')

    expect(await saved()).toEqual({
      connectionId: 'connection-1',
      name: 'Example API v2',
    })
  })

  test('closing discards a typed secret', async () => {
    await openEdit()
    await type(secretInputs()[0], SECRET)
    await type(field(container, 'Connection name'), 'Example API v2')

    await click(container, 'Close dialog')
    expect(secretInputs()[0].value).toBe('')

    // Reopening starts from what is stored.
    await click(container, 'Edit')
    expect(secretInputs()[0].value).toBe('')
    expect(secretInputs()[0].placeholder).toBe(STORED_MASK)
    expect(field(container, 'Connection name').value).toBe('Example API')
    expect(save().disabled).toBe(true)
    expect(mutations.update).not.toHaveBeenCalled()
  })

  test('a failed save keeps the form, typed secret included, for another try', async () => {
    mutations.update.mockRejectedValueOnce(new Error('The sealed value does not open'))
    await openEdit()
    await type(field(container, 'Connection name'), 'Example API v2')
    await type(secretInputs()[0], SECRET)

    await submit()
    await settle(() => container.textContent!.includes('The sealed value does not open'))
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      'The sealed value does not open'
    )
    expect(field(container, 'Connection name').value).toBe('Example API v2')
    expect(secretInputs()[0].value).toBe(SECRET)
    expect(save().disabled).toBe(false)

    await submit()
    await settle(() => mutations.update.mock.calls.length > 1)
    expect(mutations.update.mock.calls[1][0].variables).toMatchObject({
      connectionId: 'connection-1',
      name: 'Example API v2',
    })
    expect(mutations.update.mock.calls[1][0]).toMatchObject({
      refetchQueries: ['GetAgentAssets', 'GetAgentDetail', 'GetAgentMesh'],
      awaitRefetchQueries: true,
    })
    await settle(() => secretInputs()[0].value === '')
    expect(secretInputs()[0].value).toBe('')
  })

  test('a definition the form cannot express can still be renamed and given a new secret', async () => {
    const mixed: HttpDefinition = {
      ...stored,
      fields: [...stored.fields, { name: 'other', kind: 'secret', source: { type: 'sealed' } }],
      injections: [...stored.injections, { type: 'query', name: 'k', field: 'other' }],
    }
    await openEdit(mixed)

    expect(container.textContent).toContain('uses a shape this form cannot edit')
    expect(container.querySelector('input[aria-label="Host 1"]')).toBeNull()
    expect(container.textContent).toContain('?k=<other>')
    expect(secretInputs().map((input) => input.placeholder)).toEqual([STORED_MASK, STORED_MASK])
    expect(save().disabled).toBe(true)

    await type(secretInputs()[0], 'first-secret-value')
    expect(container.textContent).toContain('To change one, enter all of them.')
    expect(secretInputs()[1].placeholder).toBe('')
    expect(save().disabled).toBe(true)
    await type(secretInputs()[1], 'second-secret-value')

    const variables = await saved()
    expect(Object.keys(variables).sort()).toEqual(['connectionId', 'sealedValue'])
    expect((await opened(variables.sealedValue)).fields).toEqual({
      token: 'first-secret-value',
      other: 'second-secret-value',
    })
  })

  describe('when the refetched Connection arrives after the dialog opened', () => {
    const newer: HttpDefinition = {
      ...stored,
      hosts: [{ match: 'exact', value: 'api.example.com', path: '/v2/*' }],
    }
    const rerender = async (definition: HttpDefinition) =>
      act(async () =>
        root.render(<EditCustomConnectionDialog connection={connection(definition)} />)
      )
    const pathInput = () => field(container, 'Path for host 1 (optional)')

    test('an untouched form starts again from it and Save stays disabled', async () => {
      await openEdit()
      expect(pathInput().value).toBe('/v1/*')

      await rerender(newer)
      expect(pathInput().value).toBe('/v2/*')
      expect(container.textContent).not.toContain('changed since you opened')
      expect(save().disabled).toBe(true)
    })

    test('edits are kept, flagged, and Reload discards them', async () => {
      await openEdit()
      await type(pathInput(), '/mine/*')

      await rerender(newer)
      expect(pathInput().value).toBe('/mine/*')
      expect(container.textContent).toContain('This Connection changed since you opened')

      await click(container, 'Reload')
      expect(pathInput().value).toBe('/v2/*')
      expect(container.textContent).not.toContain('changed since you opened')
      expect(save().disabled).toBe(true)
    })

    test('a typed secret counts as an edit', async () => {
      await openEdit()
      await type(secretInputs()[0], 'typed-secret-value')

      await rerender(newer)
      expect(pathInput().value).toBe('/v1/*')
      expect(container.textContent).toContain('This Connection changed since you opened')
      expect(secretInputs()[0].value).toBe('typed-secret-value')
    })
  })
})
