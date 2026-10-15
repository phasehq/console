/**
 * @jest-environment node
 */

const mockMutate = jest.fn()
const mockQuery = jest.fn()
const mockCreateNewEnv = jest.fn()

jest.mock('@/apollo/client', () => ({
  graphQlClient: {
    mutate: (...args: unknown[]) => mockMutate(...args),
    query: (...args: unknown[]) => mockQuery(...args),
  },
}))
jest.mock('@/graphql/mutations/createApp.gql', () => ({ CreateApplication: 'CreateApplication' }))
jest.mock('@/graphql/mutations/environments/initAppEnvironments.gql', () => ({
  InitAppEnvironments: 'InitAppEnvironments',
}))
jest.mock('@/graphql/mutations/environments/bulkProcessSecrets.gql', () => ({
  BulkProcessSecrets: 'BulkProcessSecrets',
}))
jest.mock('@/graphql/queries/secrets/getAppEnvironments.gql', () => ({
  GetAppEnvironments: 'GetAppEnvironments',
}))
jest.mock('@/graphql/queries/getApps.gql', () => ({ GetApps: 'GetApps' }))
jest.mock('@/graphql/mutations/apps/updateAppInfo.gql', () => ({
  UpdateAppInfoOp: 'UpdateAppInfoOp',
}))
jest.mock('@/utils/crypto', () => ({
  createNewEnv: (...args: unknown[]) => mockCreateNewEnv(...args),
  getUserKxPublicKey: async () => 'kx-pk',
  getUserKxPrivateKey: async () => 'kx-sk',
  decryptAsymmetric: async () => 'env-salt',
  encryptAsymmetric: async (plaintext: string) => `encrypted:${plaintext}`,
  digest: async () => 'digest',
}))

import { ApiEnvironmentEnvTypeChoices, OrganisationType } from '@/apollo/graphql'
import { createApplication, DEV_SECRETS, PROD_SECRETS, STAG_SECRETS } from '@/utils/app'

beforeEach(() => {
  jest.clearAllMocks()
  mockMutate.mockImplementation(async ({ mutation }) =>
    mutation === 'CreateApplication'
      ? { data: { createApp: { app: { id: 'app-1' } } } }
      : { data: {} }
  )
  mockQuery.mockResolvedValue({ data: {} })
  mockCreateNewEnv.mockImplementation(async (appId, name, envType) => ({
    createEnvPayload: { appId, name, envType, wrappedSeed: 'encrypted-seed' },
    adminKeysPayload: [{ userId: 'creator', wrappedSeed: 'creator-seed' }],
  }))
})

describe('createApplication', () => {
  it('initializes encrypted environments without legacy KMS credentials', async () => {
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => '00000000-0000-0000-0000-000000000001' },
      configurable: true,
    })
    const globalAccessUsers = [{ id: 'owner' }, { id: 'creator' }]

    try {
      const appId = await createApplication({
        name: 'My app',
        organisation: { id: 'org-1' } as OrganisationType,
        keyring: { publicKey: 'pk', privateKey: 'sk', symmetricKey: 'symmetric' },
        globalAccessUsers,
      })

      expect(appId).toBe('app-1')
      expect(mockMutate.mock.calls[0][0]).toEqual({
        mutation: 'CreateApplication',
        variables: {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'My app',
          organisationId: 'org-1',
        },
      })
      expect(mockCreateNewEnv.mock.calls).toEqual([
        ['app-1', 'Development', ApiEnvironmentEnvTypeChoices.Dev, globalAccessUsers],
        ['app-1', 'Staging', ApiEnvironmentEnvTypeChoices.Staging, globalAccessUsers],
        ['app-1', 'Production', ApiEnvironmentEnvTypeChoices.Prod, globalAccessUsers],
      ])
      const [{ mutation, variables }] = mockMutate.mock.calls[1]
      expect(mutation).toBe('InitAppEnvironments')
      expect(variables.devEnv.wrappedSeed).toBe('encrypted-seed')
      expect(variables.devAdminKeys).toEqual([{ userId: 'creator', wrappedSeed: 'creator-seed' }])
      expect(mockQuery).toHaveBeenCalledWith({
        query: 'GetApps',
        variables: { organisationId: 'org-1' },
        fetchPolicy: 'network-only',
      })
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
    }
  })

  it('sends example secret types as the lowercase values the API stores', async () => {
    mockQuery.mockImplementation(async ({ query }) =>
      query === 'GetAppEnvironments'
        ? {
            data: {
              appEnvironments: [
                ApiEnvironmentEnvTypeChoices.Dev,
                ApiEnvironmentEnvTypeChoices.Staging,
                ApiEnvironmentEnvTypeChoices.Prod,
              ].map((envType) => ({
                id: `env-${envType}`,
                envType,
                identityKey: 'env-pk',
                wrappedSalt: 'wrapped-salt',
              })),
            },
          }
        : { data: {} }
    )

    await createApplication({
      name: 'example-app',
      organisation: { id: 'org-1' } as OrganisationType,
      keyring: { publicKey: 'pk', privateKey: 'sk', symmetricKey: 'symmetric' },
      globalAccessUsers: [],
      createExampleSecrets: true,
    })

    const [{ variables }] = mockMutate.mock.calls.find(
      ([{ mutation }]) => mutation === 'BulkProcessSecrets'
    )!
    const types = variables.secretsToCreate.map((secret: { type: string }) => secret.type)

    expect(types).toHaveLength(DEV_SECRETS.length + STAG_SECRETS.length + PROD_SECRETS.length)
    expect(new Set(types)).toEqual(new Set(['secret', 'sealed', 'config']))
  })
})
