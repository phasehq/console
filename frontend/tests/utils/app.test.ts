/**
 * @jest-environment node
 */

const mockMutate = jest.fn()
const mockQuery = jest.fn()
const mockCreateNewEnv = jest.fn()
const mockWrap = jest.fn()

jest.mock('@/apollo/client', () => ({
  graphQlClient: {
    mutate: (...args: unknown[]) => mockMutate(...args),
    query: (...args: unknown[]) => mockQuery(...args),
  },
}))
jest.mock('@/graphql/mutations/createApp.gql', () => ({ CreateApplication: 'CreateApplication' }))
jest.mock('@/graphql/mutations/environments/createEnvironment.gql', () => ({
  CreateEnv: 'CreateEnv',
}))
jest.mock('@/graphql/mutations/apps/bulkAddAppMembers.gql', () => ({
  BulkAddMembersToApp: 'BulkAddMembersToApp',
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
  wrapEnvSecretsForAccount: (...args: unknown[]) => mockWrap(...args),
  getUserKxPublicKey: async () => 'kx-pk',
  getUserKxPrivateKey: async () => 'kx-sk',
  decryptAsymmetric: async () => 'env-salt',
  encryptAsymmetric: async (plaintext: string) => `encrypted:${plaintext}`,
  digest: async () => 'digest',
}))

import {
  ApiEnvironmentEnvTypeChoices,
  MemberType,
  OrganisationMemberType,
  OrganisationType,
  ServiceAccountType,
} from '@/apollo/graphql'
import { createApplication, DEV_SECRETS, PROD_SECRETS, STAG_SECRETS } from '@/utils/app'

const { Dev, Staging, Prod, Custom } = ApiEnvironmentEnvTypeChoices
const KEYRING = { publicKey: 'pk', privateKey: 'sk', symmetricKey: 'symmetric' }
const ORG = { id: 'org-1' } as OrganisationType
const ADMINS = [{ id: 'owner' }, { id: 'creator' }]
const create = (options: Partial<Parameters<typeof createApplication>[0]> = {}) =>
  createApplication({
    name: 'My app',
    organisation: ORG,
    keyring: KEYRING,
    globalAccessUsers: ADMINS,
    ...options,
  })

const priya = { id: 'priya', identityKey: 'pk-priya' } as OrganisationMemberType
const deployer = { id: 'ci', identityKey: 'pk-ci' } as ServiceAccountType

/** The requests sent, by mutation, in order */
const sent = (mutation: string) =>
  mockMutate.mock.calls
    .filter(([call]) => call.mutation === mutation)
    .map(([call]) => call.variables)

beforeEach(() => {
  jest.clearAllMocks()
  mockMutate.mockImplementation(async ({ mutation, variables }) => {
    if (mutation === 'CreateApplication') return { data: { createApp: { app: { id: 'app-1' } } } }
    if (mutation === 'CreateEnv') {
      const { name } = variables.envInput
      return {
        data: {
          createEnvironment: {
            environment: { id: `env-${name}`, name, identityKey: `ik-${name}` },
          },
        },
      }
    }
    if (mutation === 'BulkAddMembersToApp')
      return { data: { bulkAddAppMembers: { app: { id: 'app-1' } } } }
    return { data: {} }
  })
  mockQuery.mockResolvedValue({ data: {} })
  mockCreateNewEnv.mockImplementation(async (appId, name, envType) => ({
    createEnvPayload: { appId, name, envType, wrappedSeed: 'encrypted-seed' },
    adminKeysPayload: [{ userId: 'creator', wrappedSeed: 'creator-seed' }],
    envSecrets: { seed: `seed-${name}`, salt: `salt-${name}` },
  }))
  mockWrap.mockImplementation(async (secrets, account) => ({
    wrappedSeed: `${secrets.seed}>${account.id}`,
    wrappedSalt: `${secrets.salt}>${account.id}`,
  }))
})

describe('createApplication', () => {
  it('creates Development, Staging and Production by default, without legacy KMS credentials', async () => {
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => '00000000-0000-0000-0000-000000000001' },
      configurable: true,
    })

    try {
      const created = await create()

      expect(sent('CreateApplication')).toEqual([
        { id: '00000000-0000-0000-0000-000000000001', name: 'My app', organisationId: 'org-1' },
      ])
      expect(mockCreateNewEnv.mock.calls).toEqual([
        ['app-1', 'Development', Dev, ADMINS],
        ['app-1', 'Staging', Staging, ADMINS],
        ['app-1', 'Production', Prod, ADMINS],
      ])
      // One at a time, in order, each with its keys wrapped for the admins and the creator
      const envs = sent('CreateEnv')
      expect(envs.map((variables) => variables.envInput.name)).toEqual([
        'Development',
        'Staging',
        'Production',
      ])
      expect(envs[0]).toEqual({
        envInput: {
          appId: 'app-1',
          name: 'Development',
          envType: Dev,
          wrappedSeed: 'encrypted-seed',
          color: null,
        },
        adminKeys: [{ userId: 'creator', wrappedSeed: 'creator-seed' }],
      })
      expect(created).toEqual({
        id: 'app-1',
        environments: [
          { id: 'env-Development', name: 'Development' },
          { id: 'env-Staging', name: 'Staging' },
          { id: 'env-Production', name: 'Production' },
        ],
        accessGiven: true,
      })
      expect(sent('BulkAddMembersToApp')).toEqual([])
      expect(mockQuery).toHaveBeenCalledWith({
        query: 'GetApps',
        variables: { organisationId: 'org-1' },
        fetchPolicy: 'network-only',
      })
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
    }
  })

  it('creates the environments asked for, with their types and colours', async () => {
    await create({
      environments: [
        { name: 'Live', envType: Prod },
        { name: 'Preview', envType: Custom, color: '#10b981' },
      ],
    })

    expect(
      sent('CreateEnv').map(({ envInput }) => [envInput.name, envInput.envType, envInput.color])
    ).toEqual([
      ['Live', Prod, null],
      ['Preview', Custom, '#10b981'],
    ])
  })

  it('gives each account its environments in one request, with the keys wrapped for it', async () => {
    const created = await create({
      access: [
        { account: priya, memberType: MemberType.User, environments: [0, 2] },
        { account: deployer, memberType: MemberType.Service, environments: [1] },
      ],
    })

    const keysFor = (account: { id: string }, env: string) => ({
      envId: `env-${env}`,
      userId: account.id,
      identityKey: `ik-${env}`,
      wrappedSeed: `seed-${env}>${account.id}`,
      wrappedSalt: `salt-${env}>${account.id}`,
    })
    expect(sent('BulkAddMembersToApp')).toEqual([
      {
        appId: 'app-1',
        members: [
          {
            memberId: 'priya',
            memberType: MemberType.User,
            envKeys: [keysFor(priya, 'Development'), keysFor(priya, 'Production')],
          },
          {
            memberId: 'ci',
            memberType: MemberType.Service,
            envKeys: [keysFor(deployer, 'Staging')],
          },
        ],
      },
    ])
    expect(created.accessGiven).toBe(true)
  })

  it('carries on past an environment that fails, and gives access to the others only', async () => {
    const plain = mockMutate.getMockImplementation()!
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'CreateEnv' && options.variables.envInput.name === 'Staging')
        throw new Error('An Environment with this name already exists in this App!')
      return plain(options)
    })

    const created = await create({
      access: [
        { account: priya, memberType: MemberType.User, environments: [0, 1] },
        { account: deployer, memberType: MemberType.Service, environments: [1] },
      ],
    })

    expect(created.environments).toEqual([
      { id: 'env-Development', name: 'Development' },
      null,
      { id: 'env-Production', name: 'Production' },
    ])
    // Production is still created after the failure; an account left with nothing isn't sent
    const [{ members }] = sent('BulkAddMembersToApp')
    expect(members).toEqual([
      expect.objectContaining({
        memberId: 'priya',
        envKeys: [expect.objectContaining({ envId: 'env-Development' })],
      }),
    ])
    expect(created.accessGiven).toBe(true)
  })

  it('reports access it could not give, without throwing: the App is there to fix it in', async () => {
    const plain = mockMutate.getMockImplementation()!
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'BulkAddMembersToApp') throw new Error('no permission')
      return plain(options)
    })

    const created = await create({
      access: [{ account: priya, memberType: MemberType.User, environments: [0] }],
    })

    expect(created.id).toBe('app-1')
    expect(created.accessGiven).toBe(false)
  })

  it('throws when the App itself is not created, before any environment', async () => {
    mockMutate.mockRejectedValueOnce(new Error("You don't have permission to create Apps"))

    await expect(create()).rejects.toThrow("You don't have permission to create Apps")
    expect(sent('CreateEnv')).toEqual([])
  })

  it('says what it is doing as it goes', async () => {
    const stages: string[] = []
    await create({
      environments: [
        { name: 'Development', envType: Dev },
        { name: 'Production', envType: Prod },
      ],
      access: [{ account: priya, memberType: MemberType.User, environments: [0] }],
      onProgress: (stage) => stages.push(stage),
    })

    expect(stages).toEqual([
      'Creating the App…',
      'Creating Environments (1 of 2)…',
      'Creating Environments (2 of 2)…',
      'Giving access to 1 account…',
    ])
  })

  it('sends example secret types as the lowercase values the API stores', async () => {
    mockQuery.mockImplementation(async ({ query }) =>
      query === 'GetAppEnvironments'
        ? {
            data: {
              appEnvironments: [Dev, Staging, Prod].map((envType) => ({
                id: `env-${envType}`,
                envType,
                identityKey: 'env-pk',
                wrappedSalt: 'wrapped-salt',
              })),
            },
          }
        : { data: {} }
    )

    await create({ name: 'example-app', globalAccessUsers: [], createExampleSecrets: true })

    const [{ secretsToCreate }] = sent('BulkProcessSecrets')
    const types = secretsToCreate.map((secret: { type: string }) => secret.type)

    expect(types).toHaveLength(DEV_SECRETS.length + STAG_SECRETS.length + PROD_SECRETS.length)
    expect(new Set(types)).toEqual(new Set(['secret', 'sealed', 'config']))
  })
})
