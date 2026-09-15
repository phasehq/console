import {
  canonicalIntegrationId,
  groupIntegrationCredentials,
  integrationCredentialHref,
  integrationMatchesSearch,
  type IntegrationCredentialSummary,
} from '@/utils/integrationCredentials'

const credential = (
  overrides: Partial<IntegrationCredentialSummary> &
    Pick<IntegrationCredentialSummary, 'id' | 'name'>
): IntegrationCredentialSummary => ({
  provider: { id: 'github', name: 'GitHub' },
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-02T12:00:00Z',
  syncCount: 0,
  agentConnectionCount: 0,
  ...overrides,
})

test('canonicalises both AWS authentication methods as one integration', () => {
  expect(canonicalIntegrationId('aws')).toBe('aws')
  expect(canonicalIntegrationId('AWS_ASSUME_ROLE')).toBe('aws')

  const groups = groupIntegrationCredentials([
    credential({
      id: 'access-keys',
      name: 'AWS access keys',
      provider: { id: 'aws', name: 'AWS' },
      syncCount: 2,
    }),
    credential({
      id: 'assume-role',
      name: 'AWS role',
      provider: { id: 'aws_assume_role', name: 'AWS Assume Role' },
      agentConnectionCount: 3,
    }),
  ])

  expect(groups).toHaveLength(1)
  expect(groups[0]).toMatchObject({
    id: 'aws',
    name: 'AWS',
    credentialCount: 2,
    syncCount: 2,
    agentConnectionCount: 3,
    usageCount: 5,
  })
})

test('uses the earliest created time, latest updated time, and stable provider order', () => {
  const groups = groupIntegrationCredentials([
    credential({ id: 'github', name: 'GitHub', createdAt: '2026-09-03T12:00:00Z' }),
    credential({
      id: 'aws-new',
      name: 'AWS new',
      provider: { id: 'aws', name: 'AWS' },
      createdAt: '2026-09-04T12:00:00Z',
      updatedAt: '2026-09-06T12:00:00Z',
    }),
    credential({
      id: 'aws-old',
      name: 'AWS old',
      provider: { id: 'aws_assume_role', name: 'AWS Assume Role' },
      createdAt: '2026-08-30T12:00:00Z',
      updatedAt: '2026-09-01T12:00:00Z',
    }),
  ])

  expect(groups.map((group) => group.name)).toEqual(['AWS', 'GitHub'])
  expect(groups[0].createdAt).toBe('2026-08-30T12:00:00Z')
  expect(groups[0].updatedAt).toBe('2026-09-06T12:00:00Z')
  expect(groups[0].credentials.map((item) => item.id)).toEqual(['aws-new', 'aws-old'])
})

test('searches integration and credential names', () => {
  const [group] = groupIntegrationCredentials([
    credential({ id: 'prod', name: 'Production deployer' }),
  ])

  expect(integrationMatchesSearch(group, 'github')).toBe(true)
  expect(integrationMatchesSearch(group, 'deployer')).toBe(true)
  expect(integrationMatchesSearch(group, 'aws')).toBe(false)
})

test('builds a credential deep link using the canonical provider group', () => {
  expect(
    integrationCredentialHref('phase dev', {
      id: 'role/production',
      provider: { id: 'AWS_ASSUME_ROLE', name: 'AWS Assume Role' },
    })
  ).toBe('/phase%20dev/integrations/credentials?provider=aws&credential=role%2Fproduction')
})
