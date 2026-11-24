import { act, createRef } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { EnvironmentType } from '@/apollo/graphql'

jest.mock(
  '@/graphql/mutations/environments/secrets/rotation/createRotatingSecret.gql',
  () => ({ CreateRotatingSecretOP: 'CreateRotatingSecretOP' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/secrets/rotation/getRotationProviders.gql',
  () => ({ GetRotationProviders: 'GetRotationProviders' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/secrets/rotation/importRotationTemplate.gql',
  () => ({ ImportRotationTemplate: 'ImportRotationTemplate' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/secrets/rotation/getOpenAIProjects.gql',
  () => ({ GetOpenAIProjects: 'GetOpenAIProjects' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/syncing/getSavedCredentials.gql',
  () => ({ __esModule: true, default: 'GetSavedCredentials' }),
  { virtual: true }
)
jest.mock('@apollo/client', () => {
  const providers = {
    rotationProviders: [
      {
        id: 'openai',
        name: 'OpenAI',
        outputSchema: [{ id: 'api_key', label: 'API key' }],
        configSchema: [{ id: 'name_template', label: 'Name template' }],
      },
    ],
  }
  const credentials = { savedCredentials: [] }
  const idle = { data: undefined, loading: false, error: undefined }
  return {
    useQuery: (query: string) => ({
      data: query === 'GetRotationProviders' ? providers : credentials,
    }),
    useLazyQuery: () => [jest.fn(), idle],
    useMutation: () => [jest.fn(), idle],
  }
})
jest.mock('@/contexts/organisationContext', () => {
  const { createContext } = jest.requireActual('react')
  return {
    organisationContext: createContext({ activeOrganisation: { id: 'org-1', name: 'acme' } }),
  }
})
jest.mock('@/components/apps/EnableSSEDialog', () => ({ EnableSSEDialog: () => null }))
jest.mock('@/components/syncing/ProviderCredentialPicker', () => ({
  ProviderCredentialPicker: () => null,
}))
jest.mock('@/components/syncing/ProviderIcon', () => ({ ProviderIcon: () => null }))
jest.mock('@/components/onboarding/Stepper', () => ({ Stepper: () => null }))
jest.mock('@/utils/crypto', () => ({ encryptAsymmetric: jest.fn() }))
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), error: jest.fn(), warn: jest.fn() },
}))

import { CreateRotatingSecretDialog } from '@/ee/components/secrets/rotation/CreateRotatingSecretDialog'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// A new object each time, as the grid hands the dialog its environment on every render
const environment = () =>
  ({
    id: 'env-qa',
    name: 'QA',
    identityKey: 'key',
    app: { id: 'app-1', name: 'storefront', sseEnabled: true },
  }) as EnvironmentType
const prefill = {
  providerId: 'openai',
  keyMap: [{ id: 'api_key', keyName: 'OPENAI_API_KEY' }],
  name: 'OpenAI API key',
}

describe('CreateRotatingSecretDialog', () => {
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

  it('keeps what was typed when the grid behind it renders again', async () => {
    const ref = createRef<{ openModal: () => void; closeModal: () => void }>()
    const render = () =>
      act(async () => {
        root.render(
          <CreateRotatingSecretDialog
            ref={ref}
            environment={environment()}
            path="/"
            initialState={prefill}
          />
        )
      })
    await render()
    await act(async () => ref.current!.openModal())

    const nameField = () =>
      document.body.querySelector('input[placeholder="e.g. OpenAI prod key"]') as HTMLInputElement
    expect(nameField().value).toBe('OpenAI API key')

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(nameField(), 'Renamed by hand')
      nameField().dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(nameField().value).toBe('Renamed by hand')

    await render()
    expect(nameField().value).toBe('Renamed by hand')
  })
})
