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
jest.mock('@/components/agents/AgentCredentialPicker', () => ({
  AgentCredentialPicker: ({ id, value, onChange, credentials, recommendedProviderId }: any) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select credentials</option>
      {credentials.map((credential: any) => (
        <option key={credential.id} value={credential.id}>
          {`${credential.name} (${credential.provider?.name || recommendedProviderId})${
            credential.provider?.id === recommendedProviderId ? ' · Recommended' : ''
          }`}
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

  const summaryColumns = () => {
    const summary = container.querySelector('section[aria-label="Request summary"]')!
    const [requestedBy, credential] = Array.from(summary.firstElementChild!.children).filter(
      (child) => child.tagName === 'DIV'
    )
    return { summary, requestedBy, credential }
  }

  test('says which Agent asks for which credential, and what approving does', async () => {
    await renderDialog()

    const { summary, requestedBy, credential } = summaryColumns()
    expect(requestedBy.textContent).toBe('Requested byDeploy AgentDefault Workflow')
    expect(credential.textContent).toBe('CredentialAWS EC2 full accessAWS Assume Role')
    // The service's logo leads the credential, so its kind reads at a glance.
    expect(credential.querySelector('[role="img"][aria-label="AWS"]')).not.toBeNull()
    expect(summary.lastElementChild!.textContent).toBe(
      "Complete setup connects the credential you pick to a new AWS Connection. It stays inside the Phase proxy, and its secret values are never copied into the Agent's configuration."
    )

    // Without a service type, the logo follows the credential provider.
    await act(async () => root.unmount())
    root = createRoot(container)
    await renderDialog({ ...request, serviceType: '' })
    expect(container.querySelector('[role="img"][aria-label="AWS"]')).not.toBeNull()
  })

  test('names the credential an update replaces', async () => {
    const update = {
      ...request,
      kind: 'credential_update',
      connection: {
        id: 'connection-1',
        name: 'AWS production',
        authentication: {
          id: 'old-keys',
          name: 'Old deploy keys',
          revision: 'credential-v1',
          provider: { id: 'aws', name: 'AWS Access Keys' },
        },
      },
    }
    await act(async () => {
      root.render(
        <AgentSetupRequestDialog organisationId="org-1" request={update} canCreateCredentials />
      )
      await Promise.resolve()
    })
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Update credentials')!
        .click()
    )

    expect(summaryColumns().summary.lastElementChild!.textContent).toBe(
      "Update credentials replaces Old deploy keys on the AWS production Connection. It stays inside the Phase proxy, and its secret values are never copied into the Agent's configuration."
    )
  })

  test('prioritizes the exact suggested provider while retaining compatible AWS alternatives', async () => {
    await renderDialog()

    const picker = container.querySelector<HTMLSelectElement>('#request-request-1-credential')!
    // The reviewer picks the credential; the recommended one is listed first.
    expect(picker.value).toBe('')
    expect(picker.options[1].textContent).toBe('AWS role (AWS Assume Role) · Recommended')
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
    // The summary and the picker already say it all, so no banner repeats it.
    expect(container.textContent).not.toContain('Phase will bind')
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
    const picker = container.querySelector<HTMLSelectElement>('#request-request-1-credential')!
    await act(async () => {
      picker.value = 'assume-role'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })

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
    // Re-review starts a fresh decision, so the credential is chosen again.
    expect(picker.value).toBe('')
    await act(async () => {
      picker.value = 'assume-role'
      picker.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => complete.click())
    expect(fulfill.mock.calls[0][0].variables.expectedRevision).toBe('request-v5')
  })

  describe('how long the access lasts', () => {
    const asked = (durationSeconds: number | null) => ({ ...request, durationSeconds })
    const duration = () =>
      container.querySelector<HTMLSelectElement>('#request-request-1-duration')!
    const choose = async (element: HTMLSelectElement, value: string) =>
      act(async () => {
        element.value = value
        element.dispatchEvent(new Event('change', { bubbles: true }))
      })
    const pickAndComplete = async () => {
      await choose(
        container.querySelector<HTMLSelectElement>('#request-request-1-credential')!,
        'access-keys'
      )
      await act(async () =>
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === 'Complete setup')!
          .click()
      )
      return fulfill.mock.calls[0][0].variables
    }

    test('starts at the requested duration and offers until revoked', async () => {
      await renderDialog(asked(28800))

      expect(duration().value).toBe('8h')
      expect(Array.from(duration().options).map((option) => option.value)).toEqual([
        '1h',
        '8h',
        '24h',
        '7d',
        'custom',
        'forever',
      ])
      expect(container.textContent).toContain('The Agent asked for 8 hours')
    })

    test('grants the requested duration as shown', async () => {
      await renderDialog(asked(28800))
      expect((await pickAndComplete()).durationSeconds).toBe(28800)
    })

    test('grants a different duration when the reviewer changes it', async () => {
      await renderDialog(asked(28800))
      await choose(duration(), '7d')
      const variables = await pickAndComplete()
      expect(variables.durationSeconds).toBe(604800)
      expect(variables).not.toHaveProperty('untilRevoked')
    })

    test('grants until revoked when the reviewer chooses it', async () => {
      await renderDialog(asked(3600))
      await choose(duration(), 'forever')
      const variables = await pickAndComplete()
      expect(variables.untilRevoked).toBe(true)
      expect(variables).not.toHaveProperty('durationSeconds')
    })

    test('a custom duration below the minimum cannot be granted', async () => {
      await renderDialog(asked(3600))
      await choose(duration(), 'custom')
      await choose(
        container.querySelector<HTMLSelectElement>('#request-request-1-duration-unit')!,
        'minutes'
      )
      const amount = container.querySelector<HTMLInputElement>(
        'input[aria-label="Custom duration"]'
      )!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, '1')
        amount.dispatchEvent(new Event('input', { bubbles: true }))
      })

      expect(container.textContent).toContain('at least 5 minutes')
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent === 'Complete setup'
        )!.disabled
      ).toBe(true)
    })
  })
})
