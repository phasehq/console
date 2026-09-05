import { createApplication } from '@/utils/app'
import { graphQlClient } from '@/apollo/client'
import { createNewEnv } from '@/utils/crypto'
import { ApiEnvironmentEnvTypeChoices, OrganisationType } from '@/apollo/graphql'

jest.mock('@/apollo/client', () => ({ graphQlClient: { mutate: jest.fn(), query: jest.fn() } }))
jest.mock('@/utils/crypto', () => ({ createNewEnv: jest.fn() }))
jest.mock('@/graphql/mutations/createApp.gql', () => ({ CreateApplication: 'create-app' }))
jest.mock('@/graphql/mutations/environments/initAppEnvironments.gql', () => ({ InitAppEnvironments: 'init-envs' }))
jest.mock('@/graphql/mutations/environments/bulkProcessSecrets.gql', () => ({ BulkProcessSecrets: 'bulk-secrets' }))
jest.mock('@/graphql/queries/secrets/getAppEnvironments.gql', () => ({ GetAppEnvironments: 'get-envs' }))
jest.mock('@/graphql/queries/getApps.gql', () => ({ GetApps: 'get-apps' }))
jest.mock('@/graphql/mutations/apps/updateAppInfo.gql', () => ({ UpdateAppInfoOp: 'update-app' }))

test('app creation initializes encrypted environments without legacy KMS credentials', async () => {
  const originalCrypto = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => '00000000-0000-0000-0000-000000000001' },
    configurable: true,
  })
  const mutate = graphQlClient.mutate as jest.Mock
  const query = graphQlClient.query as jest.Mock
  const createEnv = createNewEnv as jest.Mock
  const recipients = [{ id: 'owner' }, { id: 'creator' }]
  mutate.mockResolvedValueOnce({ data: { createApp: { app: { id: 'new-app' } } } }).mockResolvedValue({ data: {} })
  query.mockResolvedValue({ data: {} })
  createEnv.mockImplementation(async (appId, name, type) => ({
    createEnvPayload: { appId, name, type, wrappedSeed: 'encrypted-seed', wrappedSalt: 'encrypted-salt' },
    adminKeysPayload: [{ userId: 'creator', wrappedSeed: 'creator-seed' }],
  }))

  try {
    const result = await createApplication({
      name: 'My app', organisation: { id: 'org' } as OrganisationType,
      keyring: { publicKey: 'public', privateKey: 'private', symmetricKey: 'symmetric' },
      globalAccessUsers: recipients,
    })
    expect(result).toBe('new-app')
    expect(mutate.mock.calls[0][0]).toEqual({
      mutation: 'create-app',
      variables: { id: '00000000-0000-0000-0000-000000000001', name: 'My app', organisationId: 'org' },
    })
    expect(createEnv.mock.calls).toEqual([
      ['new-app', 'Development', ApiEnvironmentEnvTypeChoices.Dev, recipients],
      ['new-app', 'Staging', ApiEnvironmentEnvTypeChoices.Staging, recipients],
      ['new-app', 'Production', ApiEnvironmentEnvTypeChoices.Prod, recipients],
    ])
    const initialization = mutate.mock.calls[1][0]
    expect(initialization.mutation).toBe('init-envs')
    expect(initialization.variables.devEnv.wrappedSeed).toBe('encrypted-seed')
    expect(initialization.variables.devAdminKeys).toEqual([{ userId: 'creator', wrappedSeed: 'creator-seed' }])
    expect(query).toHaveBeenCalledWith({ query: 'get-apps', variables: { organisationId: 'org' }, fetchPolicy: 'network-only' })
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
    jest.clearAllMocks()
  }
})
