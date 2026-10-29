import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useQuery } from '@apollo/client'
import { CreateGCPSecretManagerSync } from '@/components/syncing/GCP/CreateGCPSecretManagerSync'
import GetSavedCredential from '@/graphql/queries/syncing/getSavedCredential.gql'

jest.mock('@/graphql/queries/syncing/gcp/getGcpSecrets.gql', () => ({
  __esModule: true,
  default: Symbol('GetGcpSecrets'),
}))
jest.mock('@/graphql/queries/syncing/getAppSyncStatus.gql', () => ({
  __esModule: true,
  default: Symbol('GetAppSyncStatus'),
}))
jest.mock('@/graphql/queries/secrets/getAppEnvironments.gql', () => ({
  __esModule: true,
  default: Symbol('GetAppEnvironments'),
}))
jest.mock('@/graphql/queries/syncing/getSavedCredential.gql', () => ({
  __esModule: true,
  default: Symbol('GetSavedCredential'),
}))
jest.mock('@/graphql/mutations/syncing/gcp/createGcpSecretManagerSync.gql', () => ({
  __esModule: true,
  default: Symbol('CreateGcpSecretManagerSync'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useQuery: jest.fn(),
  useLazyQuery: () => [jest.fn(), { loading: false }],
  useMutation: () => [jest.fn(), { loading: false }],
}))
jest.mock('@/contexts/organisationContext', () => ({
  organisationContext: jest
    .requireActual<typeof React>('react')
    .createContext({ activeOrganisation: { id: 'org-1' } }),
}))
jest.mock('@/components/syncing/ProviderCredentialPicker', () => ({
  ProviderCredentialPicker: ({ setCredential }: any) => (
    <button type="button" onClick={() => setCredential({ id: 'gcp-credential', name: 'GCP' })}>
      Pick credential
    </button>
  ),
}))
jest.mock('@/components/syncing/GCP/GCPLocationPicker', () => ({ GCPLocationPicker: () => null }))
jest.mock('@/components/syncing/GCP/GCPScriptTabs', () => ({ GCPScriptBlock: () => null }))
jest.mock('@/components/common/Input', () => ({
  Input: ({ label, value, setValue }: any) => (
    <input aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} />
  ),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('CreateGCPSecretManagerSync', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(useQuery as jest.Mock).mockImplementation((document, options) =>
      document === GetSavedCredential && !options?.skip
        ? {
            data: {
              providerCredential: {
                id: options.variables.credentialId,
                credentials: JSON.stringify({
                  workload_identity_provider:
                    'projects/123456789012/locations/global/workloadIdentityPools/phase/providers/phase-abcd1234',
                }),
              },
            },
          }
        : { data: undefined }
    )
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  test('defaults the project to the one holding the credential identity pool', async () => {
    await act(async () =>
      root.render(<CreateGCPSecretManagerSync appId="app-1" closeModal={() => {}} />)
    )
    const project = () => container.querySelector<HTMLInputElement>('[aria-label="Project"]')!
    expect(project().value).toBe('')

    const pick = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Pick credential'
    )!
    await act(async () => pick.click())

    expect(useQuery).toHaveBeenCalledWith(GetSavedCredential, {
      variables: { credentialId: 'gcp-credential' },
      skip: false,
    })
    expect(project().value).toBe('123456789012')
  })
})
