import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import { AgentPresetPicker } from '@/components/agents/AgentPresetPicker'
import { CreateCustomConnectionForm } from '@/components/agents/CustomConnectionDialogs'
import { readPresets } from '@/utils/agents/connectionPresets'
import { randomFormattedKeyPair } from '@/utils/crypto/general'
import { buttonNamed, field, settle, type } from './customConnectionTestKit'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  CreateCustomAgentConnectionOp: 'create',
}))
jest.mock('@/graphql/queries/agents/getAgentConnectionPresets.gql', () => ({
  __esModule: true,
  default: Symbol('GetAgentConnectionPresets'),
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

const bearer = (host: string) => ({
  specVersion: 1,
  hosts: host ? [{ match: 'exact', value: host, port: 443 }] : [],
  fields: [{ name: 'token', kind: 'secret', source: { type: 'sealed' }, env: 'PRESET_TOKEN' }],
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
})
const raw = [
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments and billing.',
    docsUrl: 'https://docs.stripe.com/keys',
    category: 'payments',
    hosts: [{ match: 'exact', value: 'api.stripe.com' }],
    hostsEditable: false,
    labels: { token: 'Secret or restricted key' },
    definition: bearer('api.stripe.com'),
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'The GitHub REST API.',
    docsUrl: 'https://docs.github.com/rest',
    category: 'source-control',
    hosts: [{ match: 'exact', value: 'api.github.com' }],
    hostsEditable: true,
    labels: { token: 'Access token' },
    definition: bearer('api.github.com'),
  },
  {
    id: 'mcp-server',
    name: 'MCP server',
    description: 'Any MCP server.',
    docsUrl: 'https://modelcontextprotocol.io',
    category: 'mcp',
    hosts: [],
    hostsEditable: true,
    labels: { token: 'Access token' },
    definition: bearer(''),
  },
]

describe('provider presets in Create Connection', () => {
  let container: HTMLDivElement
  let root: Root
  let create: jest.Mock
  let server: { publicKey: string; privateKey: string }

  beforeAll(async () => {
    server = await randomFormattedKeyPair('hex')
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    create = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([create, { loading: false }])
    ;(useQuery as jest.Mock).mockReturnValue({
      data: { agentConnectionPresets: raw, serverPublicKey: server.publicKey },
      loading: false,
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  describe('the picker', () => {
    const render = async (onChoose = jest.fn()) => {
      await act(async () =>
        root.render(<AgentPresetPicker organisationId="org-1" onChoose={onChoose} />)
      )
      return onChoose
    }

    test('groups providers by category, with a way to start from scratch', async () => {
      await render()
      const groups = Array.from(container.querySelectorAll('section h4')).map(
        (heading) => heading.textContent
      )
      expect(groups).toEqual(['MCP', 'Payments', 'Source control'])
      expect(buttonNamed(container, 'Start from scratch')).toBeDefined()
    })

    test('searches by name, description and category', async () => {
      await render()
      const search = container.querySelector<HTMLInputElement>(
        'input[aria-label="Search providers"]'
      )!
      await type(search, 'billing')
      expect(container.textContent).toContain('Stripe')
      expect(container.textContent).not.toContain('GitHub')
      await type(search, 'source')
      expect(container.textContent).toContain('GitHub')
      expect(container.textContent).not.toContain('Stripe')
      await type(search, 'zzz')
      expect(container.textContent).toContain('No provider matches that search')
    })

    test('choosing a provider hands it on; so does starting from scratch', async () => {
      const onChoose = await render()
      await act(async () =>
        Array.from(container.querySelectorAll<HTMLButtonElement>('li button'))
          .find((button) => button.textContent!.startsWith('Stripe'))!
          .click()
      )
      expect(onChoose.mock.calls[0][0]).toMatchObject({ id: 'stripe', hostsEditable: false })
      await act(async () => buttonNamed(container, 'Start from scratch')!.click())
      expect(onChoose.mock.calls[1][0]).toBeNull()
    })

    test('if the providers cannot be loaded, starting from scratch still works', async () => {
      ;(useQuery as jest.Mock).mockReturnValue({
        data: undefined,
        loading: false,
        error: new Error('x'),
      })
      await render()
      expect(container.textContent).toContain('You can still start from scratch')
      expect(buttonNamed(container, 'Start from scratch')).toBeDefined()
    })
  })

  describe('the form a preset fills in', () => {
    const form = async (id: string | null) => {
      const preset = id ? readPresets(raw).find((candidate) => candidate.id === id)! : null
      await act(async () =>
        root.render(
          <CreateCustomConnectionForm
            organisationId="org-1"
            initialName="my-connection"
            preset={preset}
            onChangePreset={jest.fn()}
            serviceSelect={<div />}
            onCreated={jest.fn()}
          />
        )
      )
    }
    const submit = async () =>
      act(async () => {
        container
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })

    test('pre-fills the host and keeps them fixed when the provider fixes them', async () => {
      await form('stripe')
      const host = field(container, 'Host 1')
      expect(host.value).toBe('api.stripe.com')
      expect(host.readOnly).toBe(true)
      expect(field(container, 'Port for host 1 (optional)').readOnly).toBe(true)
      expect(buttonNamed(container, 'Add host')).toBeUndefined()
      expect(container.textContent).toContain('fixed by the provider')
    })

    test('hosts of a self-hostable provider stay editable', async () => {
      await form('github')
      const host = field(container, 'Host 1')
      expect(host.value).toBe('api.github.com')
      expect(host.readOnly).toBe(false)
      expect(buttonNamed(container, 'Add host')).toBeDefined()
    })

    test('a provider with no host leaves the host to the member', async () => {
      await form('mcp-server')
      expect(field(container, 'Host 1').value).toBe('')
      expect(field(container, 'Host 1').readOnly).toBe(false)
    })

    test('labels the secret input from the preset and links to its docs', async () => {
      await form('stripe')
      expect(field(container, 'Secret or restricted key').type).toBe('password')
      const docs = container.querySelector<HTMLAnchorElement>(
        'a[href="https://docs.stripe.com/keys"]'
      )!
      expect(docs.rel).toContain('noopener')
      expect(docs.target).toBe('_blank')
    })

    test('the member still names the Connection and enters the secret', async () => {
      await form('stripe')
      expect(field(container, 'Connection name').value).toBe('my-connection')
      expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(true)
      await type(field(container, 'Secret or restricted key'), 'sk_test_real-secret-value')
      expect(buttonNamed(container, 'Create Connection')!.disabled).toBe(false)
    })

    test('creates with the preset definition and no secret in the clear', async () => {
      await form('github')
      await type(field(container, 'Access token'), 'ghp_real-secret-value')
      await submit()
      await settle(() => create.mock.calls.length > 0)

      const { variables } = create.mock.calls[0][0]
      expect(variables.name).toBe('my-connection')
      expect(variables.definition.hosts).toEqual([
        { match: 'exact', value: 'api.github.com', port: 443 },
      ])
      expect(variables.definition.fields[0]).toMatchObject({ name: 'token', env: 'PRESET_TOKEN' })
      expect(JSON.stringify(variables)).not.toContain('ghp_real-secret-value')
    })

    test('from scratch has no locked host and no preset header', async () => {
      await form(null)
      expect(field(container, 'Host 1').readOnly).toBe(false)
      expect(container.querySelector('a[href]')).toBeNull()
      expect(field(container, 'Token')).toBeDefined()
    })
  })
})
