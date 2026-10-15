/**
 * @jest-environment node
 */

const mockMutate = jest.fn()
const mockQuery = jest.fn()

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
  newAppSeed: async () => 'seed',
  newAppToken: async () => 'token',
  newAppWrapKey: async () => 'wrap-key',
  encryptAppSeed: async () => 'encrypted-seed',
  appKeyring: async () => ({ publicKey: 'app-pk', privateKey: 'app-sk' }),
  splitSecret: async () => ['share-0', 'share-1'],
  getWrappedKeyShare: async () => 'wrapped-share',
  createNewEnv: async () => ({ createEnvPayload: {}, adminKeysPayload: [] }),
  getUserKxPublicKey: async () => 'kx-pk',
  getUserKxPrivateKey: async () => 'kx-sk',
  decryptAsymmetric: async () => 'env-salt',
  encryptAsymmetric: async (plaintext: string) => `encrypted:${plaintext}`,
  digest: async () => 'digest',
}))

import { ApiEnvironmentEnvTypeChoices, OrganisationType } from '@/apollo/graphql'
import { createApplication, DEV_SECRETS, PROD_SECRETS, STAG_SECRETS } from '@/utils/app'

describe('createApplication example secrets', () => {
  it('sends secret types as the lowercase values the API stores', async () => {
    mockMutate.mockImplementation(async ({ mutation }) =>
      mutation === 'CreateApplication'
        ? { data: { createApp: { app: { id: 'app-1' } } } }
        : { data: {} }
    )
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
