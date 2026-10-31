import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SetupAWSAuth } from '@/components/syncing/AWS/SetupAWSAuth'
import type { ProviderType } from '@/apollo/graphql'

jest.mock('@/graphql/queries/syncing/getSavedCredentials.gql', () => ({}))
jest.mock('@/graphql/mutations/syncing/saveNewProviderCreds.gql', () => ({}))
jest.mock('@/graphql/queries/syncing/aws/validateAssumeRoleAuth.gql', () => ({}))
jest.mock('@/graphql/queries/syncing/aws/validateAssumeRoleCredentials.gql', () => ({}))
jest.mock('@apollo/client', () => {
  // Stable functions: the component's effects depend on their identity.
  const mutation = [jest.fn(), { loading: false }]
  const lazyQuery = [jest.fn().mockResolvedValue({ data: undefined })]
  return {
    ...jest.requireActual('@apollo/client'),
    useMutation: jest.fn(() => mutation),
    useLazyQuery: jest.fn(() => lazyQuery),
  }
})
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest
    .requireActual<typeof React>('react')
    .createContext({ activeOrganisation: { id: 'org-1' } }),
}))
jest.mock('@/utils/syncing/general', () => ({ encryptProviderCredentials: jest.fn() }))
jest.mock('@/components/syncing/ProviderIcon', () => ({ ProviderIcon: () => null }))
jest.mock('@/components/syncing/AWS/AWSRegionPicker', () => ({ AWSRegionPicker: () => null }))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const aws = { id: 'aws', name: 'AWS' } as ProviderType

describe('SetupAWSAuth', () => {
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

  const selectedTab = async (exactProvider?: boolean) => {
    await act(async () => {
      root.render(
        <SetupAWSAuth
          provider={aws}
          serverPublicKey="server-key"
          exactProvider={exactProvider}
          onComplete={jest.fn()}
          onBack={jest.fn()}
        />
      )
    })
    return container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
  }

  test('opens on Assume Role when any AWS credential will do', async () => {
    expect(await selectedTab()).toContain('Assume Role')
  })

  test('opens on Access Keys when access keys were requested', async () => {
    expect(await selectedTab(true)).toContain('Access Keys')
  })
})
