import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { IntegrationCredentialsTable } from '@/components/syncing/IntegrationCredentialsTable'

jest.mock('@/graphql/queries/syncing/getSavedCredential.gql', () => ({
  __esModule: true,
  default: {},
}))
jest.mock('@/components/syncing/UpdateProviderCredentials', () => ({
  UpdateProviderCredentials: () => null,
}))
jest.mock('@/components/syncing/DeleteProviderCredentialDialog', () => ({
  DeleteProviderCredentialDialog: () => <button type="button">Delete credential</button>,
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

test('renders a semantic inventory grouped by canonical integration', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <IntegrationCredentialsTable
        organisationId="org-1"
        canEdit
        canDelete
        onChanged={() => {}}
        credentials={[
          {
            id: 'aws-key',
            name: 'Production access keys',
            provider: { id: 'aws', name: 'AWS' },
            createdAt: '2026-09-02T10:00:00Z',
            updatedAt: '2026-09-03T10:00:00Z',
            syncCount: 2,
            agentConnectionCount: 1,
          },
          {
            id: 'aws-role',
            name: 'Deployment role',
            provider: { id: 'aws_assume_role', name: 'AWS Assume Role' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-04T10:00:00Z',
            syncCount: 0,
            agentConnectionCount: 0,
          },
          {
            id: 'github-token',
            name: 'Release automation',
            provider: { id: 'github', name: 'GitHub' },
            createdAt: '2026-09-05T10:00:00Z',
            updatedAt: '2026-09-05T10:00:00Z',
            syncCount: 1,
            agentConnectionCount: 0,
          },
        ]}
      />
    )
  })

  const html = container.innerHTML

  expect(html).toContain('<table')
  expect(html).toContain('scope="col"')
  expect(html.match(/Third-party service/g)).toHaveLength(2)
  expect(html).toContain('Deployment role, Production access keys')
  expect(html).toContain('Used by 3 integrations')
  expect(html).toContain('Used by 1 integration')
  expect(html).not.toContain('syncs or log streams')
  expect(html).not.toContain('Agent connection')
  expect(
    Array.from(container.querySelectorAll('span'))
      .find((element) => element.textContent === 'Used by 3 integrations')
      ?.classList.contains('whitespace-nowrap')
  ).toBe(true)
  expect(html).toContain('View credentials')

  await act(async () => root.unmount())
  container.remove()
})

test('delete-only users can delete metadata without opening the secret-detail manager', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <IntegrationCredentialsTable
        organisationId="org-1"
        canEdit={false}
        canDelete
        onChanged={() => {}}
        credentials={[
          {
            id: 'aws-role',
            name: 'Deployment role',
            provider: { id: 'aws_assume_role', name: 'AWS Assume Role' },
            agentConnectionCount: 0,
          },
        ]}
      />
    )
  })

  await act(async () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('View credentials'))!
      .click()
  )

  expect(container.textContent).toContain('Used by 0 integrations')
  expect(container.textContent).toContain('Delete credential')
  expect(container.textContent).not.toContain('Manage')

  await act(async () => root.unmount())
  container.remove()
})

test('opens and highlights a credential targeted by URL context', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <IntegrationCredentialsTable
        organisationId="org-1"
        canEdit
        canDelete
        onChanged={() => {}}
        initialProviderId="postgres"
        highlightedCredentialId="postgres-dev"
        credentials={[
          {
            id: 'postgres-dev',
            name: 'Development database',
            provider: { id: 'postgres', name: 'PostgreSQL' },
            agentConnectionCount: 1,
          },
        ]}
      />
    )
  })

  const highlighted = container.querySelector('#integration-credential-postgres-dev')
  expect(highlighted).not.toBeNull()
  expect(highlighted?.getAttribute('aria-current')).toBe('true')
  expect(highlighted?.classList.contains('border-emerald-500/60')).toBe(true)
  expect(container.textContent).toContain('Hide credentials')

  await act(async () => root.unmount())
  container.remove()
})
