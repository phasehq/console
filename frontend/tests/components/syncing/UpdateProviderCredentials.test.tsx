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
jest.mock('@/components/common/CopyButton', () => ({
  __esModule: true,
  default: ({ value }: any) => (
    <button type="button" data-copy={value}>
      Copy
    </button>
  ),
}))
jest.mock('@/utils/syncing/aws', () => ({
  generateExternalId: jest.fn(async () => 'generated-external-id'),
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

  const renderEditable = (credential: any) =>
    act(async () =>
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
          <UpdateProviderCredentials credential={credential} />
        </organisationContext.Provider>
      )
    )
  const field = (label: string) =>
    container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  const button = (text: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === text
    )
  const typeInto = (input: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const savedRevision = (revision: string) => ({
    data: { updateProviderCredentials: { credential: { id: 'credential-1', revision } } },
  })

  test('shows stored sealed values as a placeholder and only sends the ones typed', async () => {
    updateCredentials.mockResolvedValue(savedRevision('revision-2'))
    await renderEditable({
      id: 'credential-1',
      revision: 'revision-1',
      name: 'AWS keys',
      credentials: JSON.stringify({ access_key_id: 'AKIAIOSFODNN7EXAMPLE', region: 'us-east-2' }),
      sealedCredentials: ['secret_access_key'],
      provider: {
        id: 'aws',
        name: 'AWS',
        expectedCredentials: ['access_key_id', 'secret_access_key', 'region'],
        optionalCredentials: [],
        nonSensitiveCredentials: ['access_key_id', 'region'],
        endpointCredentials: [],
      },
    })

    expect(field('ACCESS KEY ID').type).toBe('text')
    expect(field('ACCESS KEY ID').value).toBe('AKIAIOSFODNN7EXAMPLE')
    expect(field('SECRET ACCESS KEY').type).toBe('password')
    expect(field('SECRET ACCESS KEY').value).toBe('')
    expect(field('SECRET ACCESS KEY').placeholder).toBe('•'.repeat(40))

    // A cleared sealed field keeps the stored value, so it is not an edit
    await typeInto(field('SECRET ACCESS KEY'), 'typed')
    expect(button('Save')!.disabled).toBe(false)
    await typeInto(field('SECRET ACCESS KEY'), '')
    expect(button('Save')!.disabled).toBe(true)

    await typeInto(field('ACCESS KEY ID'), 'AKIAI44QH8DHBEXAMPLE')
    await act(async () => button('Save')!.click())
    expect(JSON.parse(updateCredentials.mock.calls[0][0].variables.credentials)).toEqual({
      access_key_id: 'AKIAI44QH8DHBEXAMPLE',
      region: 'us-east-2',
    })

    await typeInto(field('SECRET ACCESS KEY'), 'rotated-secret')
    await act(async () => button('Save')!.click())
    expect(JSON.parse(updateCredentials.mock.calls[1][0].variables.credentials)).toEqual({
      access_key_id: 'AKIAI44QH8DHBEXAMPLE',
      secret_access_key: 'rotated-secret',
      region: 'us-east-2',
    })
    // Once saved, the new value is write-only too
    expect(field('SECRET ACCESS KEY').value).toBe('')
    expect(field('SECRET ACCESS KEY').placeholder).toBe('•'.repeat(40))
  })

  test('asks for the sealed values again when an endpoint moves', async () => {
    await renderEditable({
      id: 'credential-1',
      revision: 'revision-1',
      name: 'PostgreSQL',
      credentials: JSON.stringify({ username: 'phase', host: 'database.internal', port: '5432' }),
      sealedCredentials: ['password'],
      provider: {
        id: 'postgres',
        name: 'PostgreSQL',
        expectedCredentials: ['username', 'password', 'host'],
        optionalCredentials: ['port', 'database'],
        nonSensitiveCredentials: ['username', 'host', 'port', 'database'],
        endpointCredentials: ['host', 'port'],
      },
    })

    await typeInto(field('USERNAME'), 'phase_app')
    expect(field('PASSWORD').placeholder).toBe('•'.repeat(40))

    await typeInto(field('HOST'), 'replica.internal')
    expect(field('PASSWORD').placeholder).toBe('Re-enter to change HOST')

    await typeInto(field('HOST'), 'database.internal')
    expect(field('PASSWORD').placeholder).toBe('•'.repeat(40))
  })

  test('regenerates a sealed AWS External ID and hands the new value over', async () => {
    updateCredentials.mockResolvedValue(savedRevision('revision-2'))
    await renderEditable({
      id: 'credential-1',
      revision: 'revision-1',
      name: 'AWS role',
      credentials: JSON.stringify({ role_arn: 'arn:aws:iam::1:role/phase', region: 'us-east-2' }),
      sealedCredentials: ['external_id'],
      provider: {
        id: 'aws_assume_role',
        name: 'AWS Assume Role',
        expectedCredentials: ['role_arn', 'region'],
        optionalCredentials: ['external_id'],
        nonSensitiveCredentials: ['role_arn', 'region'],
        endpointCredentials: ['role_arn'],
      },
    })

    expect(field('EXTERNAL ID (Optional)').placeholder).toBe('•'.repeat(40))
    expect(field('EXTERNAL ID (Optional)').required).toBe(false)
    expect(button('Generate')).toBeUndefined()
    expect(container.querySelector('[data-copy]')).toBeNull()

    await typeInto(field('ROLE ARN'), 'arn:aws:iam::2:role/phase')
    expect(field('EXTERNAL ID (Optional)').required).toBe(true)
    expect(field('EXTERNAL ID (Optional)').placeholder).toBe('Re-enter to change ROLE ARN')
    await typeInto(field('ROLE ARN'), 'arn:aws:iam::1:role/phase')

    await act(async () => button('Regenerate')!.click())

    // Masked like any sealed field, but revealable and copyable before saving
    expect(field('EXTERNAL ID (Optional)').type).toBe('password')
    expect(field('EXTERNAL ID (Optional)').value).toBe('generated-external-id')
    expect(container.querySelector('[data-copy]')?.getAttribute('data-copy')).toBe(
      'generated-external-id'
    )
    expect(container.textContent).toContain("Add this External ID to the role's trust policy")

    await act(async () => button('Save')!.click())
    expect(JSON.parse(updateCredentials.mock.calls[0][0].variables.credentials)).toEqual({
      role_arn: 'arn:aws:iam::1:role/phase',
      region: 'us-east-2',
      external_id: 'generated-external-id',
    })
    expect(field('EXTERNAL ID (Optional)').value).toBe('')
    expect(container.querySelector('[data-copy]')).toBeNull()
    expect(button('Regenerate')).toBeDefined()
  })

  test('offers Generate when no External ID is stored', async () => {
    await renderEditable({
      id: 'credential-1',
      revision: 'revision-1',
      name: 'AWS role',
      credentials: JSON.stringify({ role_arn: 'arn:aws:iam::1:role/phase', region: 'us-east-2' }),
      sealedCredentials: [],
      provider: {
        id: 'aws_assume_role',
        name: 'AWS Assume Role',
        expectedCredentials: ['role_arn', 'region'],
        optionalCredentials: ['external_id'],
        nonSensitiveCredentials: ['role_arn', 'region'],
        endpointCredentials: ['role_arn'],
      },
    })

    expect(field('EXTERNAL ID (Optional)').placeholder).toBe('')
    expect(button('Regenerate')).toBeUndefined()
    expect(button('Generate')).toBeDefined()
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

  test('keeps PostgreSQL routing fields editable when Agent Connections use the credential', async () => {
    await renderEditable({
      id: 'credential-1',
      revision: 'revision-1',
      name: 'PostgreSQL',
      agentConnectionCount: 2,
      credentials: JSON.stringify({
        username: 'phase',
        host: 'database.internal',
        port: '5432',
        database: 'phase',
      }),
      sealedCredentials: ['password'],
      provider: {
        id: 'postgres',
        name: 'PostgreSQL',
        expectedCredentials: ['username', 'password', 'host'],
        optionalCredentials: ['port', 'database'],
        nonSensitiveCredentials: ['username', 'host', 'port', 'database'],
        endpointCredentials: ['host', 'port'],
      },
    })

    for (const label of [
      'USERNAME',
      'PASSWORD',
      'HOST',
      'PORT (Optional)',
      'DATABASE (Optional)',
    ]) {
      expect(field(label).disabled).toBe(false)
      expect(field(label).readOnly).toBe(false)
    }
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
                credentials: '{}',
                sealedCredentials: ['access_token'],
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
                credentials: '{}',
                sealedCredentials: ['access_token'],
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
