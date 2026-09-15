import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { UpdateProviderCredentials } from '@/components/syncing/UpdateProviderCredentials'
import { organisationContext } from '@/contexts/organisationContext'
import UpdateProviderCreds from '@/graphql/mutations/syncing/updateProviderCreds.gql'

jest.mock('@/graphql/queries/syncing/getServerKey.gql', () => ({
  __esModule: true,
  default: Symbol('GetServerKey'),
}))
jest.mock('@/graphql/mutations/syncing/updateProviderCreds.gql', () => ({
  __esModule: true,
  default: Symbol('UpdateProviderCreds'),
}))
jest.mock('@/graphql/mutations/syncing/validateRotationCredentials.gql', () => ({
  __esModule: true,
  default: Symbol('ValidateRotationCredentials'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: () => ({ data: { serverPublicKey: 'unused' } }),
}))
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest.requireActual<typeof React>('react').createContext({
    activeOrganisation: {
      id: 'org-1',
      role: {
        permissions: JSON.stringify({
          permissions: { IntegrationCredentials: ['read', 'delete'] },
          app_permissions: {},
          global_access: false,
        }),
      },
    },
  }),
}))
jest.mock('@/utils/syncing/general', () => ({
  ...jest.requireActual('@/utils/syncing/general'),
  encryptProviderCredentials: jest.fn(async (_provider, credentials) => credentials),
}))
jest.mock('@/components/common/Input', () => ({
  Input: ({ label, disabled, readOnly, secret, value, setValue, ...rest }: any) => (
    <input
      {...rest}
      aria-label={label}
      disabled={disabled}
      readOnly={readOnly}
      type={secret ? 'password' : 'text'}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  ),
}))
jest.mock('@/components/syncing/AWS/AWSRegionPicker', () => ({
  AWSRegionPicker: ({ disabled }: any) => (
    <button type="button" data-testid="region" disabled={disabled}>
      Region
    </button>
  ),
}))
jest.mock('@/components/syncing/DeleteProviderCredentialDialog', () => ({
  DeleteProviderCredentialDialog: () => <button type="button">Delete</button>,
}))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('UpdateProviderCredentials', () => {
  let container: HTMLDivElement
  let root: Root
  let updateCredentials: jest.Mock
  let validateRotationCredentials: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    updateCredentials = jest.fn()
    validateRotationCredentials = jest.fn()
    ;(useMutation as jest.Mock)
      .mockReset()
      .mockImplementation((document) =>
        document === UpdateProviderCreds
          ? [updateCredentials, { loading: false }]
          : [validateRotationCredentials, { loading: false }]
      )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  test('disables every editable control and hides Save for a delete-only viewer', async () => {
    await act(async () =>
      root.render(
        <UpdateProviderCredentials
          credential={
            {
              id: 'credential-1',
              revision: 'revision-1',
              name: 'AWS role',
              credentials: JSON.stringify({
                role_arn: 'arn:aws:iam::1:role/agent',
                region: 'us-east-2',
              }),
              provider: {
                id: 'aws_assume_role',
                name: 'AWS Assume Role',
                expectedCredentials: ['role_arn', 'region'],
                optionalCredentials: [],
              },
            } as any
          }
        />
      )
    )

    expect(Array.from(container.querySelectorAll('input')).every((input) => input.disabled)).toBe(
      true
    )
    expect(container.querySelector<HTMLButtonElement>('[data-testid="region"]')?.disabled).toBe(
      true
    )
    expect(container.textContent).toContain('Delete')
    expect(container.textContent).not.toContain('Save')
  })

  test('masks only the PostgreSQL password field', async () => {
    await act(async () =>
      root.render(
        <UpdateProviderCredentials
          credential={
            {
              id: 'credential-1',
              revision: 'revision-1',
              name: 'PostgreSQL',
              credentials: JSON.stringify({
                username: 'phase',
                password: 'password',
                host: 'database.internal',
                port: '5432',
                database: 'phase',
              }),
              provider: {
                id: 'postgres',
                name: 'PostgreSQL',
                expectedCredentials: ['username', 'password', 'host'],
                optionalCredentials: ['port', 'database'],
                nonSensitiveCredentials: ['username', 'host', 'port', 'database'],
              },
            } as any
          }
        />
      )
    )

    expect(container.querySelector<HTMLInputElement>('[aria-label="USERNAME"]')?.type).toBe('text')
    expect(container.querySelector<HTMLInputElement>('[aria-label="PASSWORD"]')?.type).toBe(
      'password'
    )
    expect(container.querySelector<HTMLInputElement>('[aria-label="HOST"]')?.type).toBe('text')
    expect(container.querySelector<HTMLInputElement>('[aria-label="PORT (Optional)"]')?.type).toBe(
      'text'
    )
    expect(
      container.querySelector<HTMLInputElement>('[aria-label="DATABASE (Optional)"]')?.type
    ).toBe('text')
  })

  test('locks bound PostgreSQL routing fields while keeping the name and password editable', async () => {
    await act(async () =>
      root.render(
        <organisationContext.Provider
          value={
            {
              activeOrganisation: {
                id: 'org-1',
                role: {
                  permissions: JSON.stringify({
                    permissions: { IntegrationCredentials: ['read', 'update'] },
                    app_permissions: {},
                    global_access: false,
                  }),
                },
              },
            } as any
          }
        >
          <UpdateProviderCredentials
            credential={
              {
                id: 'credential-1',
                revision: 'revision-1',
                name: 'PostgreSQL',
                agentConnectionCount: 2,
                credentials: JSON.stringify({
                  username: 'phase',
                  password: 'password',
                  host: 'database.internal',
                  port: '5432',
                  database: 'phase',
                }),
                provider: {
                  id: 'postgres',
                  name: 'PostgreSQL',
                  expectedCredentials: ['username', 'password', 'host'],
                  optionalCredentials: ['port', 'database'],
                },
              } as any
            }
          />
        </organisationContext.Provider>
      )
    )

    expect(container.querySelector<HTMLInputElement>('[aria-label="Name"]')?.disabled).toBe(false)
    expect(container.querySelector<HTMLInputElement>('[aria-label="PASSWORD"]')?.disabled).toBe(
      false
    )
    for (const label of ['USERNAME', 'HOST', 'PORT (Optional)', 'DATABASE (Optional)']) {
      const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
      expect(field?.disabled).toBe(true)
      expect(field?.readOnly).toBe(true)
      expect(field?.getAttribute('aria-describedby')).toBeTruthy()
    }
    expect(container.textContent).toContain(
      'create a new credential and switch the affected Connections to it'
    )
    expect(container.textContent).toContain('You can still rotate the password here.')
  })

  test('keeps PostgreSQL routing fields editable when the credential is unbound', async () => {
    await act(async () =>
      root.render(
        <organisationContext.Provider
          value={
            {
              activeOrganisation: {
                id: 'org-1',
                role: {
                  permissions: JSON.stringify({
                    permissions: { IntegrationCredentials: ['read', 'update'] },
                    app_permissions: {},
                    global_access: false,
                  }),
                },
              },
            } as any
          }
        >
          <UpdateProviderCredentials
            credential={
              {
                id: 'credential-1',
                revision: 'revision-1',
                name: 'PostgreSQL',
                agentConnectionCount: 0,
                credentials: JSON.stringify({
                  username: 'phase',
                  password: 'password',
                  host: 'database.internal',
                  port: '5432',
                  database: 'phase',
                }),
                provider: {
                  id: 'postgres',
                  name: 'PostgreSQL',
                  expectedCredentials: ['username', 'password', 'host'],
                  optionalCredentials: ['port', 'database'],
                },
              } as any
            }
          />
        </organisationContext.Provider>
      )
    )

    for (const label of ['USERNAME', 'HOST', 'PORT (Optional)', 'DATABASE (Optional)']) {
      const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)
      expect(field?.disabled).toBe(false)
      expect(field?.readOnly).toBe(false)
      expect(field?.getAttribute('aria-describedby')).toBeNull()
    }
    expect(container.textContent).not.toContain('Username, host, port, and database are locked')
  })

  test('uses the latest returned revision for consecutive saves', async () => {
    updateCredentials
      .mockResolvedValueOnce({
        data: {
          updateProviderCredentials: {
            credential: { id: 'credential-1', revision: 'revision-2' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProviderCredentials: {
            credential: { id: 'credential-1', revision: 'revision-3' },
          },
        },
      })

    await act(async () =>
      root.render(
        <organisationContext.Provider
          value={
            {
              activeOrganisation: {
                id: 'org-1',
                role: {
                  permissions: JSON.stringify({
                    permissions: {
                      IntegrationCredentials: ['read', 'update', 'delete'],
                    },
                    app_permissions: {},
                    global_access: false,
                  }),
                },
              },
            } as any
          }
        >
          <UpdateProviderCredentials
            credential={
              {
                id: 'credential-1',
                revision: 'revision-1',
                name: 'Cloudflare',
                credentials: JSON.stringify({ access_token: 'first' }),
                provider: {
                  id: 'cloudflare',
                  name: 'Cloudflare',
                  expectedCredentials: ['access_token'],
                  optionalCredentials: [],
                },
              } as any
            }
          />
        </organisationContext.Provider>
      )
    )

    const token = container.querySelector<HTMLInputElement>('[aria-label="ACCESS TOKEN"]')!
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Save')
    )!
    const setToken = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          token,
          value
        )
        token.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

    await setToken('second')
    await act(async () => save.click())
    expect(save.disabled).toBe(true)
    await setToken('third')
    expect(save.disabled).toBe(false)
    await act(async () => save.click())

    expect(updateCredentials).toHaveBeenCalledTimes(2)
    expect(updateCredentials.mock.calls[0][0].variables.expectedRevision).toBe('revision-1')
    expect(updateCredentials.mock.calls[1][0].variables.expectedRevision).toBe('revision-2')
  })

  test('shows credential update failures inline and keeps the edit retryable', async () => {
    updateCredentials.mockRejectedValueOnce(new Error('Credential revision changed'))

    await act(async () =>
      root.render(
        <organisationContext.Provider
          value={
            {
              activeOrganisation: {
                id: 'org-1',
                role: {
                  permissions: JSON.stringify({
                    permissions: { IntegrationCredentials: ['read', 'update'] },
                    app_permissions: {},
                    global_access: false,
                  }),
                },
              },
            } as any
          }
        >
          <UpdateProviderCredentials
            credential={
              {
                id: 'credential-1',
                revision: 'revision-1',
                name: 'Cloudflare',
                credentials: JSON.stringify({ access_token: 'first' }),
                provider: {
                  id: 'cloudflare',
                  name: 'Cloudflare',
                  expectedCredentials: ['access_token'],
                  optionalCredentials: [],
                },
              } as any
            }
          />
        </organisationContext.Provider>
      )
    )

    const token = container.querySelector<HTMLInputElement>('[aria-label="ACCESS TOKEN"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        token,
        'second'
      )
      token.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('Save')
    )!

    await act(async () => save.click())

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Credential revision changed'
    )
    expect(save.disabled).toBe(false)
  })
})
