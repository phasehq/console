import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation, useQuery } from '@apollo/client'
import { AgentSetupRequestDialog } from '@/components/agents/AgentSetupRequestDialog'
import { FulfillAgentRequestOp } from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetProviderList from '@/graphql/queries/syncing/getProviders.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'

jest.mock('@/graphql/mutations/agents/manageAgentAssets.gql', () => ({
  FulfillAgentRequestOp: Symbol('FulfillAgentRequestOp'),
}))
jest.mock('@/graphql/queries/syncing/getProviders.gql', () => ({
  __esModule: true,
  default: Symbol('GetProviderList'),
}))
jest.mock('@/graphql/queries/syncing/getSavedCredentials.gql', () => ({
  __esModule: true,
  default: Symbol('GetSavedCredentials'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
  useQuery: jest.fn(),
}))
jest.mock('@/components/agents/AgentSelect', () => ({
  AgentSelect: ({ id, value, onChange, options }: any) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
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
      { children, buttonContent, onOpen, onClose }: any,
      ref: any
    ) {
      const openModal = () => onOpen?.()
      const closeModal = () => onClose?.()
      ReactModule.useImperativeHandle(ref, () => ({ closeModal, openModal }))
      return (
        <div>
          <button type="button" onClick={openModal}>
            {buttonContent}
          </button>
          {children}
        </div>
      )
    }),
  }
})
jest.mock('@/components/syncing/CreateProviderCredentialsDialog', () => ({
  CreateProviderCredentialsDialog: ({ initialProvider, initialName }: any) => (
    <button
      type="button"
      data-testid="add-integration"
      data-provider={initialProvider.id}
      data-name={initialName}
    >
      Add integration
    </button>
  ),
}))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const request = {
  id: 'request-1',
  kind: 'setup',
  status: 'pending',
  serviceType: 'aws',
  credentialProvider: 'aws_assume_role',
  credentialName: 'AWS EC2 full access',
  revision: 'request-v4',
  agent: { name: 'Deploy Agent' },
  workflow: { name: 'Default' },
}

describe('Agent setup request fulfillment', () => {
  let container: HTMLDivElement
  let root: Root
  let fulfill: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    fulfill = jest.fn().mockResolvedValue({ data: {} })
    ;(useMutation as jest.Mock).mockImplementation((document) => {
      if (document === FulfillAgentRequestOp) return [fulfill, { loading: false }]
      throw new Error('Unexpected mutation')
    })
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
          loading: false,
          error: undefined,
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

  const renderDialog = async (nextRequest = request) => {
    await act(async () => {
      root.render(
        <AgentSetupRequestDialog
          organisationId="org-1"
          request={nextRequest}
          canCreateCredentials
        />
      )
      await Promise.resolve()
    })
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Set up Connection')!
        .click()
    )
  }

  test('prioritizes the exact suggested provider while retaining compatible AWS alternatives', async () => {
    await renderDialog()

    const picker = container.querySelector<HTMLSelectElement>('#request-request-1-credential')!
    expect(picker.value).toBe('assume-role')
    expect(picker.textContent).toContain('AWS role (AWS Assume Role) · Recommended')
    expect(picker.textContent).toContain('AWS access keys')
    expect(container.querySelector('[data-testid="add-integration"]')).toMatchObject({
      dataset: expect.objectContaining({
        provider: 'aws_assume_role',
        name: 'AWS EC2 full access',
      }),
    })
  })

  test('fulfills with reviewed request and selected credential revisions', async () => {
    await renderDialog()
    const picker = container.querySelector<HTMLSelectElement>('#request-request-1-credential')!
    await act(async () => {
      picker.value = 'access-keys'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Complete setup')!
        .click()
    )

    expect(fulfill).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: {
          requestId: 'request-1',
          expectedRevision: 'request-v4',
          credentialId: 'access-keys',
          expectedCredentialRevision: 'credential-v2',
          resolutionNote: null,
        },
      })
    )
  })

  test('requires an explicit re-review when polling changes the request revision', async () => {
    await renderDialog()

    const revisedRequest = { ...request, revision: 'request-v5' }
    await act(async () => {
      root.render(
        <AgentSetupRequestDialog
          organisationId="org-1"
          request={revisedRequest}
          canCreateCredentials
        />
      )
      await Promise.resolve()
    })

    const complete = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Complete setup'
    )!
    expect(container.textContent).toContain('changed while you were reviewing it')
    expect(complete.disabled).toBe(true)
    await act(async () => complete.click())
    expect(fulfill).not.toHaveBeenCalled()

    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Set up Connection')!
        .click()
    )
    expect(container.textContent).not.toContain('changed while you were reviewing it')
    await act(async () => complete.click())
    expect(fulfill.mock.calls[0][0].variables.expectedRevision).toBe('request-v5')
  })
})
