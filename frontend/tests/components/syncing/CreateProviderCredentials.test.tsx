import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CreateProviderCredentials } from '@/components/syncing/CreateProviderCredentials'

jest.mock('@/graphql/queries/syncing/getProviders.gql', () => ({
  __esModule: true,
  default: Symbol('GetProviderList'),
}))
jest.mock('@/graphql/queries/syncing/getSavedCredentials.gql', () => ({
  __esModule: true,
  default: Symbol('GetSavedCredentials'),
}))
jest.mock('@/graphql/mutations/syncing/saveNewProviderCreds.gql', () => ({
  __esModule: true,
  default: Symbol('SaveNewProviderCreds'),
}))
jest.mock('@/graphql/mutations/syncing/validateRotationCredentials.gql', () => ({
  __esModule: true,
  default: Symbol('ValidateRotationCredentials'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: () => [jest.fn()],
  useQuery: () => ({ data: { providers: [], serverPublicKey: 'unused' } }),
}))
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest.requireActual<typeof React>('react').createContext({
    activeOrganisation: { id: 'org-1' },
  }),
}))
jest.mock('@/components/syncing/ProviderIcon', () => ({
  ProviderIcon: () => null,
}))
jest.mock('@/components/syncing/AWS/SetupAWSAuth', () => ({
  SetupAWSAuth: () => null,
}))
jest.mock('@/components/syncing/GitHub/SetupGhAuth', () => ({
  SetupGhAuth: () => null,
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('CreateProviderCredentials', () => {
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
    jest.restoreAllMocks()
  })

  test('keeps credential inputs controlled while initial provider state is populated', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () =>
      root.render(
        <CreateProviderCredentials
          initialProvider={
            {
              id: 'custom',
              name: 'Custom provider',
              expectedCredentials: ['access_token'],
              optionalCredentials: ['endpoint'],
              authScheme: 'token',
            } as any
          }
          onComplete={() => {}}
        />
      )
    )

    const uncontrolledWarning = consoleError.mock.calls.some((args) =>
      args.some(
        (arg) =>
          typeof arg === 'string' &&
          arg.includes('A component is changing an uncontrolled input to be controlled')
      )
    )

    expect(uncontrolledWarning).toBe(false)
  })

  test('does not show a dead Back action in the provider directory', async () => {
    await act(async () =>
      root.render(<CreateProviderCredentials provider={null} onComplete={() => {}} />)
    )

    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Back'
      )
    ).toBe(false)
  })

  test('masks only the PostgreSQL password field', async () => {
    await act(async () =>
      root.render(
        <CreateProviderCredentials
          initialProvider={
            {
              id: 'postgres',
              name: 'PostgreSQL',
              expectedCredentials: ['username', 'password', 'host'],
              optionalCredentials: ['port', 'database'],
              nonSensitiveCredentials: ['username', 'host', 'port', 'database'],
              authScheme: 'token',
            } as any
          }
          onComplete={() => {}}
        />
      )
    )

    const inputType = (label: string) =>
      Array.from(container.querySelectorAll('label'))
        .find((element) => element.textContent?.startsWith(label))
        ?.parentElement?.querySelector('input')?.type

    expect(inputType('USERNAME')).toBe('text')
    expect(inputType('PASSWORD')).toBe('password')
    expect(inputType('HOST')).toBe('text')
    expect(inputType('PORT')).toBe('text')
    expect(inputType('DATABASE')).toBe('text')
  })
})
