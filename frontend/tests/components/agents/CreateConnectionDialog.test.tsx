import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import {
  CreateConnectionDialog,
  UpdateConnectionDialog,
} from '@/components/agents/AgentConnectionDialogs'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { generateConnectionName } from '@/utils/agents/names'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  CreateAgentConnectionOp: Symbol('CreateAgentConnectionOp'),
  UpdateAgentConnectionOp: Symbol('UpdateAgentConnectionOp'),
}))
jest.mock('@/graphql/queries/syncing/getProviders.gql', () => ({
  __esModule: true,
  default: Symbol('GetProviderList'),
}))
jest.mock('@/graphql/queries/syncing/getSavedCredentials.gql', () => ({
  __esModule: true,
  default: Symbol('GetSavedCredentials'),
}))
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest.requireActual<typeof React>('react').createContext({
    activeOrganisation: {
      id: 'org-1',
      name: 'phase',
      role: {
        permissions: JSON.stringify({
          permissions: { IntegrationCredentials: ['read', 'create', 'update'] },
          app_permissions: {},
          global_access: false,
        }),
      },
    },
  }),
}))
jest.mock('@/utils/agents/names', () => ({
  generateConnectionName: jest.fn(() => 'amber-cobalt-forest'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('@headlessui/react', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  const Dialog = function MockHeadlessDialog({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
  Dialog.Panel = function MockHeadlessDialogPanel({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
  Dialog.Title = function MockHeadlessDialogTitle({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
  const Transition = function MockHeadlessTransition({
    show,
    children,
  }: {
    show: boolean
    children: React.ReactNode
  }) {
    return show ? <>{children}</> : null
  }
  Transition.Child = function MockHeadlessTransitionChild({
    children,
  }: {
    children: React.ReactNode
  }) {
    return <>{children}</>
  }
  return { Dialog, Transition }
})
jest.mock('@/components/agents/AgentSelect', () => ({
  AgentSelect: ({ id, value, onChange, options, disabled }: any) => (
    <select
      id={id}
      aria-label={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))
jest.mock('@/components/common/GenericDialog', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return {
    __esModule: true,
    default: ReactModule.forwardRef(function MockDialog(
      { children, dialogTitle, title, buttonContent, onOpen, onClose }: any,
      ref: any
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ closeModal: jest.fn() }))
      return (
        <div>
          {buttonContent ? (
            <button type="button" aria-label={`Open ${title}`} onClick={onOpen}>
              {buttonContent}
            </button>
          ) : null}
          <button type="button" aria-label={`Close ${title}`} onClick={onClose}>
            Close
          </button>
          {dialogTitle || title}
          {children}
        </div>
      )
    }),
  }
})
jest.mock('@/components/syncing/CreateProviderCredentials', () => ({
  CreateProviderCredentials: ({ initialProvider }: any) => (
    <div data-testid="create-credentials-form">{initialProvider?.id}</div>
  ),
}))
jest.mock('@/components/syncing/UpdateProviderCredentials', () => ({
  UpdateProviderCredentials: ({ credential }: any) => (
    <div data-testid="credential-editor">Editing {credential.name}</div>
  ),
}))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('Agent Connection credentials', () => {
  let container: HTMLDivElement
  let root: Root
  let save: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    save = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockReturnValue([save, { loading: false }])
    ;(useQuery as jest.Mock).mockImplementation((document) => {
      if (document === GetSavedCredentials)
        return {
          data: {
            savedCredentials: [
              {
                id: 'access-keys',
                name: 'AWS access keys',
                revision: 'credential-v2',
                provider: { id: 'aws', name: 'AWS Access Keys' },
              },
              {
                id: 'assume-role',
                name: 'AWS role',
                revision: 'credential-v7',
                provider: { id: 'aws_assume_role', name: 'AWS Assume Role' },
              },
            ],
          },
          refetch: jest.fn(),
        }
      if (document === GetProviderList)
        return {
          data: {
            providers: [
              { id: 'aws', name: 'AWS Access Keys' },
              { id: 'aws_assume_role', name: 'AWS Assume Role' },
            ],
          },
        }
      throw new Error('Unexpected query')
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  test('creates a Connection with ProviderCredentials and no source or policy fields', async () => {
    await act(async () =>
      root.render(
        <CreateConnectionDialog
          organisationId="org-1"
          services={[
            {
              serviceType: 'aws',
              displayName: 'Amazon Web Services',
              provider: 'aws_assume_role',
            },
          ]}
        />
      )
    )

    const name = container.querySelector<HTMLInputElement>('input')!
    expect(name.value).toBe('amber-cobalt-forest')
    expect(generateConnectionName).toHaveBeenCalledTimes(1)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        name,
        'AWS production'
      )
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const selects = container.querySelectorAll<HTMLSelectElement>('select')
    await act(async () => {
      selects[0].value = 'aws'
      selects[0].dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    const credential = container.querySelectorAll<HTMLSelectElement>('select')[1]
    expect(credential.options[1].value).toBe('assume-role')
    await act(async () => {
      credential.value = 'assume-role'
      credential.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('Add integration')
    expect(container.querySelector('[data-testid="create-credentials-form"]')).toBeNull()

    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          organisationId: 'org-1',
          name: 'AWS production',
          serviceType: 'aws',
          authenticationId: 'assume-role',
          config: {},
        },
      })
    )
    expect(JSON.stringify(save.mock.calls[0][0].variables)).not.toMatch(/source|policy/i)
    expect(container.textContent).not.toMatch(/policy/i)
  })

  test('keeps a manually edited Connection draft when the dialog is dismissed and reopened', async () => {
    await act(async () =>
      root.render(
        <CreateConnectionDialog
          organisationId="org-1"
          services={[
            {
              serviceType: 'aws',
              displayName: 'Amazon Web Services',
              provider: 'aws_assume_role',
            },
          ]}
        />
      )
    )

    const name = container.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        name,
        'AWS production'
      )
      name.dispatchEvent(new Event('input', { bubbles: true }))
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close Create Connection"]')!
        .click()
      container
        .querySelector<HTMLButtonElement>('[aria-label="Open Create Connection"]')!
        .click()
    })

    expect(name.value).toBe('AWS production')
    expect(generateConnectionName).toHaveBeenCalledTimes(1)
  })

  test('keeps credential management out of edit mode and links to the selected credential', async () => {
    await act(async () =>
      root.render(
        <UpdateConnectionDialog
          organisationId="org-1"
          services={[
            {
              serviceType: 'aws',
              displayName: 'Amazon Web Services',
              provider: 'aws_assume_role',
            },
          ]}
          connection={{
            id: 'connection-1',
            name: 'AWS production',
            serviceType: 'aws',
            authentication: {
              id: 'assume-role',
              name: 'AWS role',
              revision: 'credential-v7',
              provider: { id: 'aws_assume_role', name: 'AWS Assume Role' },
            },
          }}
        />
      )
    )

    expect(container.textContent).toContain('Edit Amazon Web Services Connection')
    expect(container.querySelectorAll('select')).toHaveLength(1)
    expect(container.textContent).not.toContain('Edit selected credential')
    expect(container.querySelector('[data-testid="create-credentials-form"]')).toBeNull()
    expect(
      container.querySelector<HTMLAnchorElement>('a[href*="credential=assume-role"]')?.href
    ).toBe('http://localhost/phase/integrations/credentials?provider=aws&credential=assume-role')

    const credentials = container.querySelector<HTMLSelectElement>('select')!
    expect(Array.from(credentials.options).at(-1)?.textContent).toBe('Add integration')
    await act(async () => {
      credentials.value = '__add_integration__'
      credentials.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="create-credentials-form"]')?.textContent).toBe(
      'aws_assume_role'
    )
  })

  test('renames a Connection without resubmitting hidden credentials', async () => {
    await act(async () =>
      root.render(
        <organisationContext.Provider
          value={
            {
              activeOrganisation: {
                id: 'org-1',
                role: {
                  permissions: JSON.stringify({
                    permissions: { IntegrationCredentials: [] },
                    app_permissions: {},
                    global_access: false,
                  }),
                },
              },
            } as any
          }
        >
          <UpdateConnectionDialog
            organisationId="org-1"
            services={[
              {
                serviceType: 'aws',
                displayName: 'Amazon Web Services',
                provider: 'aws_assume_role',
              },
            ]}
            connection={{
              id: 'connection-1',
              name: 'AWS production',
              serviceType: 'aws',
              authentication: null,
            }}
          />
        </organisationContext.Provider>
      )
    )

    const name = container.querySelector<HTMLInputElement>('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        name,
        'AWS renamed'
      )
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.textContent).toContain('Credential details are hidden')
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    )

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          connectionId: 'connection-1',
          name: 'AWS renamed',
        },
      })
    )
    expect(save.mock.calls[0][0].variables).not.toHaveProperty('authenticationId')
  })
})
