import React, { act, createRef } from 'react'
import { createRoot, Root } from 'react-dom/client'

type QueryResult = { data?: unknown; loading?: boolean; error?: unknown }
type GrantType = 'INDIVIDUAL' | 'TEAM'

/** What the fake backend holds: each account's keys in the app, by env, with how each was granted */
const mockServer = {
  queries: {} as Record<string, QueryResult>,
  keys: {} as Record<string, Record<string, GrantType[]>>,
  /** Called for each grants lookup; a test can make one hang or fail */
  onGrantsLookup: (_memberId: string): Promise<void> | void => undefined,
  mutations: [] as { name: string; variables: Record<string, any> }[],
}

const mockGrantsOf = async (memberId: string) => {
  await mockServer.onGrantsLookup(memberId)
  return {
    data: {
      environmentKeys: Object.entries(mockServer.keys[memberId] ?? {}).map(([envId, types]) => ({
        environment: { id: envId },
        grants: types.map((grantType) => ({ grantType })),
      })),
    },
  }
}

/** The scope mutation as the backend applies it: the account's own grants become exactly the list sent */
const mockMutate = async (name: string, options: { variables: Record<string, any> }) => {
  mockServer.mutations.push({ name, variables: options.variables })
  if (name === 'CreateEnv')
    return { data: { createEnvironment: { environment: { id: 'new', identityKey: 'ik-new' } } } }
  if (name === 'UpdateEnvScope') {
    const { memberId, envKeys } = options.variables
    const sent = new Set<string>(envKeys.map((key: { envId: string }) => key.envId))
    const next: Record<string, GrantType[]> = {}
    for (const [envId, types] of Object.entries(mockServer.keys[memberId] ?? {})) {
      const kept = types.filter((type) => type === 'TEAM')
      if (kept.length > 0) next[envId] = kept
    }
    for (const envId of sent) next[envId] = [...(next[envId] ?? []), 'INDIVIDUAL']
    mockServer.keys[memberId] = next
  }
  return { data: {} }
}

const mockClient = {
  query: ({ variables }: { variables: { memberId: string } }) => mockGrantsOf(variables.memberId),
  refetchQueries: () => Promise.resolve([]),
}

jest.mock('@apollo/client', () => ({
  useQuery: (query: string, options?: { skip?: boolean }) =>
    options?.skip ? { loading: false } : mockServer.queries[query] ?? { loading: true },
  useMutation: (mutation: string) => [
    (options: { variables: Record<string, any> }) => mockMutate(mutation, options),
  ],
  useApolloClient: () => mockClient,
}))

jest.mock(
  '@/graphql/queries/organisation/getGlobalAccessUsers.gql',
  () => ({ GetGlobalAccessUsers: 'GetGlobalAccessUsers' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/mutations/environments/createEnvironment.gql',
  () => ({ CreateEnv: 'CreateEnv' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/mutations/environments/bulkProcessSecrets.gql',
  () => ({ BulkProcessSecrets: 'BulkProcessSecrets' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/mutations/environments/createFolder.gql',
  () => ({ CreateNewSecretFolder: 'CreateNewSecretFolder' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/mutations/environments/readSecret.gql',
  () => ({ LogSecretReads: 'LogSecretReads' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/mutations/apps/updateEnvScope.gql',
  () => ({ __esModule: true, default: 'UpdateEnvScope' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/apps/getAppMembers.gql',
  () => ({ __esModule: true, default: 'GetAppMembers' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/apps/getAppServiceAccounts.gql',
  () => ({ GetAppServiceAccounts: 'GetAppServiceAccounts' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/access/getMemberEnvKeyGrants.gql',
  () => ({ GetMemberEnvKeyGrants: 'GetMemberEnvKeyGrants' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/secrets/getAppEnvironments.gql',
  () => ({ GetAppEnvironments: 'GetAppEnvironments' }),
  { virtual: true }
)

jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return {
    organisationContext: React.createContext({
      activeOrganisation: { id: 'org-1', plan: 'EN', planDetail: { maxEnvsPerApp: null } },
    }),
  }
})
jest.mock('@/contexts/keyringContext', () => {
  const React = require('react')
  return { KeyringContext: React.createContext({ keyring: { publicKey: 'pk', privateKey: 'sk' } }) }
})
jest.mock('@/hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({ hasPermission: () => true }),
}))
jest.mock('@/utils/crypto', () => ({
  createNewEnv: async (appId: string, name: string) => ({
    createEnvPayload: { appId, name },
    adminKeysPayload: [],
    serverKeysPayload: { wrappedSeed: null, wrappedSalt: null },
    envSecrets: { seed: 'seed-new', salt: 'salt-new' },
  }),
  encryptSecretsForEnv: async () => [],
  unwrapEnvSecretsForUser: async (seed: string, salt: string) => ({ seed, salt }),
  wrapEnvSecretsForAccount: async () => ({ wrappedSeed: 'wrapped', wrappedSalt: 'wrapped' }),
}))
jest.mock('@/components/settings/organisation/UpsellDialog', () => ({ UpsellDialog: () => null }))
jest.mock('@/components/environments/EnvAccessPicker', () => ({
  EnvAccessPicker: ({
    members,
    selectedIds,
  }: {
    members: { id: string }[]
    selectedIds: Set<string>
  }) => (
    <div
      data-testid="picker"
      data-listed={members.map((member) => member.id).join(',')}
      data-selected={[...selectedIds].sort().join(',')}
    />
  ),
}))
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}))

import { toast } from 'react-toastify'
import {
  CreateEnvironmentDialog,
  CreateEnvironmentDialogHandle,
} from '@/components/environments/CreateEnvironmentDialog'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no Web Animations; Headless UI's transitions only ask whether any are running
Element.prototype.getAnimations = () => []

const env = (id: string, index: number) => ({
  id,
  name: id,
  index,
  identityKey: `ik-${id}`,
  wrappedSeed: `seed-${id}`,
  wrappedSalt: `salt-${id}`,
})
const ROLE = { name: 'Developer', permissions: JSON.stringify({ global_access: false }) }
const member = (id: string) => ({ id, fullName: id, email: `${id}@example.com`, role: ROLE })

const loaded = (data: unknown): QueryResult => ({ data, loading: false })
const MEMBERS = loaded({ appUsers: [member('alice'), member('bob')] })

describe('CreateEnvironmentDialog', () => {
  let container: HTMLDivElement
  let root: Root
  const dialog = createRef<CreateEnvironmentDialogHandle>()
  const contentsOf = () => ({ secrets: [], folders: [] })

  const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const render = () =>
    act(async () =>
      root.render(<CreateEnvironmentDialog ref={dialog} appId="app-1" contentsOf={contentsOf} />)
    )
  const open = async (cloneFromId?: string) => {
    await act(async () => dialog.current!.openModal(cloneFromId ? { cloneFromId } : undefined))
    await settle()
  }
  const form = () => document.body.querySelector('form')!
  const createButton = () => form().querySelector<HTMLButtonElement>('button[type="submit"]')!
  const picker = () => document.body.querySelector<HTMLElement>('[data-testid="picker"]')
  const typeName = async (name: string) => {
    const input = form().querySelector('input')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, name)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const create = async () => {
    await act(async () => createButton().click())
    await settle()
    await settle()
  }
  const sent = (name: string) => mockServer.mutations.filter((mutation) => mutation.name === name)
  const scopeSentFor = (memberId: string) =>
    sent('UpdateEnvScope')
      .find((mutation) => mutation.variables.memberId === memberId)
      ?.variables.envKeys.map((key: { envId: string }) => key.envId)

  beforeEach(async () => {
    mockServer.queries = {
      GetGlobalAccessUsers: loaded({
        organisationGlobalAccessUsers: [{ id: 'owner', role: { name: 'Owner' } }],
      }),
      GetAppEnvironments: loaded({
        appEnvironments: [env('dev', 0), env('staging', 1), env('prod', 2)],
        sseEnabled: false,
      }),
      GetAppMembers: MEMBERS,
      GetAppServiceAccounts: loaded({ appServiceAccounts: [] }),
    }
    mockServer.keys = {}
    mockServer.onGrantsLookup = () => undefined
    mockServer.mutations = []
    jest.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await render()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('starts a copy with the accounts that hold the source themselves', async () => {
    mockServer.keys = { alice: { prod: ['INDIVIDUAL'] }, bob: { dev: ['INDIVIDUAL'] } }
    await open('prod')
    expect(picker()!.dataset.selected).toBe('alice')

    await typeName('prod-eu')
    await create()
    expect(scopeSentFor('alice')).toEqual(['prod', 'new'])
    expect(scopeSentFor('bob')).toBeUndefined()
    expect(toast.success).toHaveBeenCalledWith('Environment created!')
  })

  it('leaves an account unticked when only a team gives it the source', async () => {
    mockServer.keys = {
      alice: { dev: ['INDIVIDUAL'], prod: ['TEAM'] },
      bob: { prod: ['INDIVIDUAL', 'TEAM'] },
    }
    await open('prod')
    expect(picker()!.dataset.selected).toBe('bob')

    await typeName('prod-eu')
    await create()
    // Her access to the copy would be her own, and outlive her place in the team
    expect(mockServer.keys.alice.new).toBeUndefined()
    expect(mockServer.keys.bob.new).toEqual(['INDIVIDUAL'])
  })

  it('cannot be submitted as a copy while its accounts are still loading', async () => {
    mockServer.keys = { alice: { prod: ['INDIVIDUAL'] } }
    mockServer.queries.GetAppMembers = { loading: true }
    await render()
    await open('prod')
    await typeName('prod-eu')
    expect(picker()).toBeNull()
    expect(createButton().disabled).toBe(true)
    await create()
    expect(sent('CreateEnv')).toHaveLength(0)

    mockServer.queries.GetAppMembers = MEMBERS
    await render()
    await settle()
    expect(picker()!.dataset.selected).toBe('alice')
    expect(createButton().disabled).toBe(false)
  })

  it("cannot be submitted as a copy while the accounts' access is still being read", async () => {
    mockServer.keys = { alice: { prod: ['INDIVIDUAL'] } }
    const held: (() => void)[] = []
    mockServer.onGrantsLookup = () => new Promise<void>((resolve) => held.push(resolve))
    await open('prod')
    await typeName('prod-eu')
    expect(picker()!.dataset.selected).toBe('')
    expect(createButton().disabled).toBe(true)
    await create()
    expect(sent('CreateEnv')).toHaveLength(0)

    await act(async () => held.forEach((release) => release()))
    await settle()
    expect(picker()!.dataset.selected).toBe('alice')
    expect(createButton().disabled).toBe(false)
  })

  it("says so when the source's access can't be read, before and after creating", async () => {
    mockServer.keys = { alice: { prod: ['INDIVIDUAL'] } }
    mockServer.onGrantsLookup = () => Promise.reject(new Error('network'))
    await open('prod')
    expect(picker()!.dataset.selected).toBe('')
    expect(form().textContent).toContain("Couldn't load who has access to prod")

    await typeName('prod-eu')
    await create()
    expect(sent('CreateEnv')).toHaveLength(1)
    expect(toast.success).not.toHaveBeenCalled()
    expect((toast.warning as jest.Mock).mock.calls[0][0]).toContain('nobody was given access')
  })

  it('creates an empty Environment without waiting for accounts', async () => {
    mockServer.queries.GetAppMembers = { loading: true }
    await render()
    await open()
    await typeName('scratch')
    expect(createButton().disabled).toBe(false)
    await create()
    expect(sent('CreateEnv')).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith('Environment created!')
  })
})
