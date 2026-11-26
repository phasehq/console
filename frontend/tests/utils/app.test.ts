/**
 * @jest-environment node
 */

const mockMutate = jest.fn()
const mockQuery = jest.fn()
const mockCreateNewEnv = jest.fn()
const mockWrap = jest.fn()
const mockEncrypt = jest.fn()

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
jest.mock('@/graphql/mutations/teams/addTeamApps.gql', () => ({ AddTeamAppsOp: 'AddTeamAppsOp' }))
jest.mock('@/graphql/mutations/syncing/initAppSync.gql', () => ({
  __esModule: true,
  default: 'InitAppSyncing',
}))
jest.mock('@/graphql/queries/syncing/getServerKey.gql', () => ({
  __esModule: true,
  default: 'GetServerKey',
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
  wrapEnvSecretsForServer: async (secrets: { seed: string; salt: string }, serverKey: string) => ({
    wrappedSeed: `${secrets.seed}>${serverKey}`,
    wrappedSalt: `${secrets.salt}>${serverKey}`,
  }),
  encryptSecretsForEnv: (...args: unknown[]) => mockEncrypt(...args),
  getUserKxPublicKey: async () => 'kx-pk',
  getUserKxPrivateKey: async () => 'kx-sk',
  decryptAsymmetric: async () => 'env-salt',
  encryptAsymmetric: async (plaintext: string) => `encrypted:${plaintext}`,
  digest: async () => 'digest',
}))

import {
  ApiEnvironmentEnvTypeChoices,
  ApiSecretTypeChoices,
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

const secretOf = (key: string, value: string) => ({
  key,
  value,
  comment: '',
  path: '/',
  type: ApiSecretTypeChoices.Secret,
  tags: [],
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
  mockQuery.mockImplementation(async ({ query }) =>
    query === 'GetServerKey' ? { data: { serverPublicKey: 'server-pk' } } : { data: {} }
  )
  mockEncrypt.mockImplementation(async (secrets, env) =>
    secrets.map((secret: { key: string; value: string }) => ({
      envId: env.id,
      key: `${secret.key}@${env.identityKey}`,
      value: `${secret.value}@${env.identityKey}`,
      keyDigest: `${secret.key}#${env.salt}`,
    }))
  )
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
          // The server decides: Production is primary
          isPrimary: null,
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
        secretsImported: true,
        accessGiven: true,
        teamsGiven: true,
        sseEnabled: false,
      })
      expect(sent('BulkAddMembersToApp')).toEqual([])
      expect(sent('BulkProcessSecrets')).toEqual([])
      // An App without teams stays end-to-end encrypted
      expect(sent('InitAppSyncing')).toEqual([])
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

  it('makes the environment asked for primary, and no other', async () => {
    await create({
      environments: [
        { name: 'Development', envType: Dev, isPrimary: false },
        { name: 'Production', envType: Prod, isPrimary: false },
        { name: 'Main', envType: Custom, isPrimary: true },
      ],
    })

    expect(sent('CreateEnv').map(({ envInput }) => [envInput.name, envInput.isPrimary])).toEqual([
      ['Development', false],
      ['Production', false],
      ['Main', true],
    ])
  })

  it("imports each environment's secrets under its own keys, in one request", async () => {
    const stages: string[] = []
    const created = await create({
      secrets: [
        {
          environment: 0,
          secrets: [secretOf('API_KEY', 'dev-key')],
        },
        {
          environment: 2,
          secrets: [secretOf('API_KEY', ''), secretOf('DEBUG', '')],
        },
      ],
      onProgress: (stage) => stages.push(stage),
    })

    expect(mockEncrypt.mock.calls.map(([, env]) => env)).toEqual([
      { id: 'env-Development', identityKey: 'ik-Development', salt: 'salt-Development' },
      { id: 'env-Production', identityKey: 'ik-Production', salt: 'salt-Production' },
    ])
    expect(sent('BulkProcessSecrets')).toEqual([
      {
        secretsToCreate: [
          expect.objectContaining({ envId: 'env-Development', value: 'dev-key@ik-Development' }),
          expect.objectContaining({ envId: 'env-Production', key: 'API_KEY@ik-Production' }),
          expect.objectContaining({ envId: 'env-Production', key: 'DEBUG@ik-Production' }),
        ],
        secretsToUpdate: [],
        secretsToDelete: [],
      },
    ])
    // Counted by key: the same key in two environments is one secret
    expect(stages).toContain('Importing 2 secrets…')
    expect(created.secretsImported).toBe(true)
  })

  it("leaves out an environment that wasn't created, and says when the import fails", async () => {
    const plain = mockMutate.getMockImplementation()!
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'CreateEnv' && options.variables.envInput.name === 'Staging')
        throw new Error('An Environment with this name already exists in this App!')
      if (options.mutation === 'BulkProcessSecrets') throw new Error('Secrets limit reached')
      return plain(options)
    })
    const secret = secretOf('API_KEY', 'v')

    const created = await create({
      secrets: [
        { environment: 1, secrets: [secret] },
        { environment: 2, secrets: [secret] },
      ],
    })

    expect(mockEncrypt.mock.calls.map(([, env]) => env.id)).toEqual(['env-Production'])
    expect(created.id).toBe('app-1')
    expect(created.secretsImported).toBe(false)
  })

  it('turns on server-side encryption for teams, then gives each team its environments', async () => {
    const stages: string[] = []
    const created = await create({
      teams: [
        { teamId: 'platform', environments: [0, 1, 2] },
        { teamId: 'frontend', environments: [0] },
      ],
      onProgress: (stage) => stages.push(stage),
    })

    // The server gets a copy of every environment's keys, wrapped for its own key
    expect(sent('InitAppSyncing')).toEqual([
      {
        appId: 'app-1',
        envKeys: ['Development', 'Staging', 'Production'].map((env) => ({
          envId: `env-${env}`,
          identityKey: `ik-${env}`,
          wrappedSeed: `seed-${env}>server-pk`,
          wrappedSalt: `salt-${env}>server-pk`,
        })),
      },
    ])
    expect(sent('AddTeamAppsOp')).toEqual([
      {
        teamId: 'platform',
        appEnvs: [{ appId: 'app-1', envIds: ['env-Development', 'env-Staging', 'env-Production'] }],
      },
      { teamId: 'frontend', appEnvs: [{ appId: 'app-1', envIds: ['env-Development'] }] },
    ])
    expect(stages.slice(-2)).toEqual([
      'Turning on server-side encryption…',
      'Giving 2 teams access…',
    ])
    expect(created.teamsGiven).toBe(true)
  })

  it('gives no team access when server-side encryption could not be turned on', async () => {
    const plain = mockMutate.getMockImplementation()!
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'InitAppSyncing') throw new Error('no permission')
      return plain(options)
    })

    const created = await create({ teams: [{ teamId: 'platform', environments: [0] }] })

    expect(sent('AddTeamAppsOp')).toEqual([])
    expect(created.teamsGiven).toBe(false)
    expect(created.sseEnabled).toBe(false)
  })

  it('still gives the other teams access when one fails', async () => {
    const plain = mockMutate.getMockImplementation()!
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'AddTeamAppsOp' && options.variables.teamId === 'platform')
        throw new Error("You don't have access to this team")
      return plain(options)
    })

    const created = await create({
      teams: [
        { teamId: 'platform', environments: [0] },
        { teamId: 'frontend', environments: [0] },
      ],
    })

    expect(sent('AddTeamAppsOp').map(({ teamId }) => teamId)).toEqual(['platform', 'frontend'])
    expect(created.teamsGiven).toBe(false)
  })

  it('turns on server-side encryption when asked, with the keys it made wrapped for the server', async () => {
    const stages: string[] = []
    const created = await create({
      serverSideEncryption: true,
      onProgress: (stage) => stages.push(stage),
    })

    expect(mockQuery).toHaveBeenCalledWith({ query: 'GetServerKey', fetchPolicy: 'network-only' })
    expect(sent('InitAppSyncing')).toEqual([
      {
        appId: 'app-1',
        envKeys: ['Development', 'Staging', 'Production'].map((env) => ({
          envId: `env-${env}`,
          identityKey: `ik-${env}`,
          wrappedSeed: `seed-${env}>server-pk`,
          wrappedSalt: `salt-${env}>server-pk`,
        })),
      },
    ])
    // Made here, as for any App: the server is only handed a copy
    expect(mockCreateNewEnv).toHaveBeenCalledTimes(3)
    expect(stages.at(-1)).toBe('Turning on server-side encryption…')
    expect(sent('AddTeamAppsOp')).toEqual([])
    expect(created.sseEnabled).toBe(true)
  })

  it('turns it on for the environments that were created, and not at all without one', async () => {
    const plain = mockMutate.getMockImplementation()!
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'CreateEnv' && options.variables.envInput.name !== 'Staging')
        throw new Error('An Environment with this name already exists in this App!')
      return plain(options)
    })

    await create({ serverSideEncryption: true })
    expect(sent('InitAppSyncing')[0].envKeys.map((key: { envId: string }) => key.envId)).toEqual([
      'env-Staging',
    ])

    mockMutate.mockClear()
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'CreateEnv') throw new Error('Environment limit reached')
      return plain(options)
    })
    const created = await create({ serverSideEncryption: true })

    // The server needs a key for every environment, so there's nothing to send
    expect(sent('InitAppSyncing')).toEqual([])
    expect(created.sseEnabled).toBe(false)
  })

  it('reports server-side encryption it could not turn on, and carries on', async () => {
    const plain = mockMutate.getMockImplementation()!
    mockMutate.mockImplementation(async (options) => {
      if (options.mutation === 'InitAppSyncing')
        throw new Error("You don't have permission to change the encryption mode of this App")
      return plain(options)
    })

    const created = await create({
      serverSideEncryption: true,
      secrets: [{ environment: 0, secrets: [secretOf('API_KEY', 'v')] }],
    })

    expect(created.id).toBe('app-1')
    expect(created.sseEnabled).toBe(false)
    expect(created.secretsImported).toBe(true)
  })

  it('settles the encryption mode before importing secrets or giving anyone access', async () => {
    await create({
      secrets: [{ environment: 0, secrets: [secretOf('API_KEY', 'v')] }],
      access: [{ account: priya, memberType: MemberType.User, environments: [0] }],
      teams: [{ teamId: 'platform', environments: [0] }],
    })

    const order = mockMutate.mock.calls.map(([{ mutation }]) => mutation)
    expect(order.slice(order.indexOf('InitAppSyncing'))).toEqual([
      'InitAppSyncing',
      'BulkProcessSecrets',
      'BulkAddMembersToApp',
      'AddTeamAppsOp',
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
