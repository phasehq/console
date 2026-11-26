import React, { act, createRef } from 'react'
import { createRoot, Root } from 'react-dom/client'

type QueryResult = { data?: unknown; loading?: boolean }
const mockQueries: Record<string, QueryResult> = {}
const mockCreateApplication = jest.fn()
const mockPush = jest.fn()
let mockPicker: Record<string, any> = {}

jest.mock('@apollo/client', () => ({
  useQuery: (query: string, options?: { skip?: boolean }) =>
    options?.skip ? { loading: false } : mockQueries[query] ?? { loading: true },
}))
jest.mock(
  '@/graphql/queries/organisation/getGlobalAccessUsers.gql',
  () => ({ GetGlobalAccessUsers: 'GetGlobalAccessUsers' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/organisation/getOrganisationMembers.gql',
  () => ({ __esModule: true, default: 'GetOrganisationMembers' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/service-accounts/getServiceAccounts.gql',
  () => ({ GetServiceAccounts: 'GetServiceAccounts' }),
  { virtual: true }
)
jest.mock('@/graphql/queries/teams/getTeams.gql', () => ({ GetTeams: 'GetTeams' }), {
  virtual: true,
})
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ team: 'acme' }),
}))
jest.mock('react-toastify', () => ({
  toast: { success: jest.fn(), warning: jest.fn(), error: jest.fn() },
}))
jest.mock('@/contexts/keyringContext', () => {
  const React = require('react')
  return { KeyringContext: React.createContext({ keyring: { publicKey: 'pk', privateKey: 'sk' } }) }
})
jest.mock('@/utils/app', () => ({
  createApplication: (...args: unknown[]) => mockCreateApplication(...args),
  DEFAULT_APP_ENVIRONMENTS: [
    { name: 'Development', envType: 'DEV' },
    { name: 'Staging', envType: 'STAGING' },
    { name: 'Production', envType: 'PROD' },
  ],
}))
jest.mock('@/components/settings/organisation/UpsellDialog', () => ({
  UpsellDialog: ({ title }: { title: string }) => <span data-testid="upsell">{title}</span>,
}))
jest.mock('@/components/settings/organisation/PlanLabel', () => ({ PlanLabel: () => null }))
jest.mock('@/components/common/ColorPicker', () => ({
  ColorPicker: ({ color, setColor }: { color: string; setColor: (color: string) => void }) => (
    <button
      type="button"
      data-testid="color"
      data-color={color}
      onClick={() => setColor('#123456')}
    />
  ),
}))
jest.mock('@/components/apps/AppAccessPicker', () => ({
  AppAccessPicker: (props: Record<string, any>) => {
    mockPicker = props
    return <div data-testid="picker" />
  },
}))

import { toast } from 'react-toastify'
import { MemberType, OrganisationType } from '@/apollo/graphql'
import NewAppDialog from '@/components/apps/NewAppDialog'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no Web Animations; Headless UI's transitions only ask whether any are running
Element.prototype.getAnimations = () => []
// Nor crypto.randomUUID, which parsing a .env file uses for each secret's id
const originalCrypto = globalThis.crypto
let lastId = 0
beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => `00000000-0000-0000-0000-${String((lastId += 1)).padStart(12, '0')}`,
    },
    configurable: true,
  })
})
afterAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: originalCrypto, configurable: true })
})

const permissions = (
  globalAccess: boolean,
  extra: { org?: Record<string, string[]>; app?: Record<string, string[]> } = {}
) =>
  JSON.stringify({
    global_access: globalAccess,
    permissions: { Members: ['read'], ServiceAccounts: ['read'], ...extra.org },
    app_permissions: { Members: ['create'], ServiceAccounts: ['create'], ...extra.app },
  })
const OWNER_ROLE = { name: 'Owner', permissions: permissions(true) }
const DEV_ROLE = { name: 'Developer', permissions: permissions(false) }
// May import secrets into a new App
const IMPORTER_ROLE = {
  name: 'Owner',
  permissions: permissions(true, { app: { Secrets: ['create'] } }),
}
// May give teams access: Teams read and update, and the App's encryption mode
const teamsRole = (globalAccess: boolean, addAnyTeam: boolean) => ({
  name: globalAccess ? 'Owner' : 'Manager',
  permissions: permissions(globalAccess, {
    org: { Teams: ['read', 'update'] },
    app: { EncryptionMode: ['update'], ...(addAnyTeam ? { Teams: ['create'] } : {}) },
  }),
})
const organisation = (overrides: Partial<OrganisationType> = {}) =>
  ({
    id: 'org-1',
    name: 'acme',
    plan: 'EN',
    planDetail: { maxEnvsPerApp: null },
    role: OWNER_ROLE,
    memberId: 'me',
    ...overrides,
  }) as unknown as OrganisationType

const ME = {
  id: 'me',
  fullName: 'Jordan',
  email: 'jordan@acme.example',
  role: OWNER_ROLE,
  identityKey: 'pk-me',
  self: true,
}
const ALICE = {
  id: 'alice',
  fullName: 'Alice',
  email: 'alice@acme.example',
  role: DEV_ROLE,
  identityKey: 'pk-alice',
}
const PAT = {
  id: 'pat',
  fullName: 'Pat',
  email: 'pat@acme.example',
  role: DEV_ROLE,
  identityKey: '',
}
const CI = { id: 'ci', name: 'ci-deployer', identityKey: 'pk-ci' }
const team = (id: string, memberIds: string[], ownerId: string | null = null) => ({
  id,
  name: id,
  owner: ownerId ? { id: ownerId } : null,
  members: memberIds.map((memberId) => ({ id: `${id}-${memberId}`, orgMember: { id: memberId } })),
})
const PLATFORM = team('platform', ['me', 'alice'])
const MOBILE = team('mobile', ['alice'])
const WEB = team('web', ['alice'], 'me')
const loaded = (data: unknown): QueryResult => ({ data, loading: false })

describe('NewAppDialog', () => {
  let container: HTMLDivElement
  let root: Root
  const dialog = createRef<{ openModal: () => void }>()

  const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const render = (org = organisation()) =>
    act(async () =>
      root.render(<NewAppDialog ref={dialog} organisation={org} showButton={false} />)
    )
  const open = async (org?: OrganisationType) => {
    await render(org)
    await act(async () => dialog.current!.openModal())
    await settle()
  }
  const form = () => document.body.querySelector('form')!
  const envInputs = () =>
    Array.from(
      form().querySelectorAll<HTMLInputElement>(
        'ul[aria-label="Environments"] input[aria-label="Environment name"]'
      )
    )
  const envNames = () => envInputs().map((input) => input.value)
  const button = (label: string | RegExp) =>
    Array.from(form().querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
      typeof label === 'string'
        ? candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label
        : label.test(candidate.textContent ?? '')
    )
  const click = async (target: HTMLElement) => {
    await act(async () => target.click())
    await settle()
  }
  const type = async (input: HTMLInputElement, value: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const typeText = async (value: string) => {
    const textarea = form().querySelector('textarea')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const primaryRadios = () =>
    Array.from(form().querySelectorAll<HTMLInputElement>('input[name="primaryEnvironment"]'))
  const primaryOf = (options: { environments: { name: string; isPrimary: boolean }[] }) =>
    options.environments.filter((env) => env.isPrimary).map((env) => env.name)
  const submit = async () => {
    await act(async () => {
      form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await settle()
    await settle()
  }
  const name = async (value: string) =>
    type(form().querySelector<HTMLInputElement>('#appName')!, value)
  const sentOptions = () => mockCreateApplication.mock.calls[0][0]

  beforeEach(async () => {
    for (const key of Object.keys(mockQueries)) delete mockQueries[key]
    Object.assign(mockQueries, {
      GetGlobalAccessUsers: loaded({ organisationGlobalAccessUsers: [ME] }),
      GetOrganisationMembers: loaded({ organisationMembers: [ME, ALICE, PAT] }),
      GetServiceAccounts: loaded({ serviceAccounts: [CI] }),
    })
    mockPicker = {}
    jest.clearAllMocks()
    mockCreateApplication.mockImplementation(async ({ environments }) => ({
      id: 'app-9',
      environments: environments.map((env: { name: string }) => ({
        id: `env-${env.name}`,
        name: env.name,
      })),
      secretsImported: true,
      accessGiven: true,
      teamsGiven: true,
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('starts with Development, Staging and Production', async () => {
    await open()
    expect(envNames()).toEqual(['Development', 'Staging', 'Production'])
    // The standard three show their stoplight colours until one is picked
    const colors = Array.from(form().querySelectorAll<HTMLElement>('[data-testid="color"]'))
    expect(colors.map((swatch) => swatch.dataset.color)).toEqual(['#22c55e', '#eab308', '#ef4444'])
  })

  it('brings a removed standard environment back in its place, ahead of added ones', async () => {
    await open()
    await click(button('Remove Staging')!)
    await click(button(/Add Environment/)!)
    await type(envInputs()[2], 'Preview')
    expect(envNames()).toEqual(['Development', 'Production', 'Preview'])

    await click(button(/^\s*Staging$/)!)
    expect(envNames()).toEqual(['Development', 'Staging', 'Production', 'Preview'])
    expect(button(/^\s*Staging$/)).toBeUndefined()
  })

  it('keeps a name to what an environment name can hold', async () => {
    await open()
    await type(envInputs()[0], 'dev env!')
    expect(envNames()[0]).toBe('devenv')
  })

  it('marks two environments with the same name, in any case, and does not go on', async () => {
    await open()
    await name('payments')
    await type(envInputs()[1], 'development')
    expect(form().textContent!.match(/Another Environment has this name/g)).toHaveLength(2)

    await submit()
    expect(document.body.querySelector('[data-testid="picker"]')).toBeNull()
    expect(mockCreateApplication).not.toHaveBeenCalled()
  })

  it("keeps an App's last environment", async () => {
    await open()
    await click(button('Remove Development')!)
    await click(button('Remove Staging')!)
    expect(button('Remove Production')!.disabled).toBe(true)
  })

  it("turns Add into an upgrade at the plan's limit, and counts towards it", async () => {
    await open(organisation({ plan: 'FR' as any, planDetail: { maxEnvsPerApp: 3 } as any }))
    expect(form().textContent).toContain('3 of 3 on the Free plan')
    expect(document.body.querySelector('[data-testid="upsell"]')!.textContent).toBe(
      'Upgrade to Pro for more environments'
    )
    expect(button(/Add Environment/)).toBeUndefined()

    await click(button('Remove Staging')!)
    expect(form().textContent).toContain('2 of 3 on the Free plan')
    expect(button(/Add Environment/)).toBeDefined()
    expect(document.body.querySelector('[data-testid="upsell"]')).toBeNull()
  })

  it('shows no limit where the plan has none', async () => {
    await open()
    expect(form().textContent).not.toMatch(/of \d+ on the/)
    expect(document.body.querySelector('[data-testid="upsell"]')).toBeNull()
  })

  it('creates straight after the environments when there is nobody else to choose', async () => {
    mockQueries.GetOrganisationMembers = loaded({ organisationMembers: [ME] })
    mockQueries.GetServiceAccounts = loaded({ serviceAccounts: [] })
    await open()
    expect(document.body.textContent).not.toContain('Access')
    await name('payments')
    await click(
      envInputs()[0].closest('li')!.querySelector<HTMLButtonElement>('[data-testid="color"]')!
    )
    await submit()

    expect(sentOptions().name).toBe('payments')
    expect(sentOptions().environments).toEqual([
      { name: 'Development', envType: 'DEV', color: '#123456', isPrimary: false },
      { name: 'Staging', envType: 'STAGING', color: null, isPrimary: false },
      { name: 'Production', envType: 'PROD', color: null, isPrimary: true },
    ])
    expect(sentOptions().secrets).toEqual([])
    expect(sentOptions().teams).toEqual([])
    expect(sentOptions().access).toEqual([])
    expect(sentOptions().globalAccessUsers).toEqual([ME])
    expect(toast.success).toHaveBeenCalledWith('payments was created')
    expect(mockPush).toHaveBeenCalledWith('/acme/apps/app-9')
  })

  it('gives the accounts chosen the environments chosen, by their place in the list', async () => {
    await open()
    await name('payments')
    await submit()
    expect(document.body.querySelector('[data-testid="picker"]')).not.toBeNull()

    // The owner (who is also the creator) reaches everything; a member without keys can't be chosen
    expect([...mockPicker.everywhere]).toEqual([
      ['me', 'Your role gives access to every Environment'],
    ])
    expect([...mockPicker.unavailable.keys()]).toEqual(['pat'])

    const [dev, staging, prod] = mockPicker.environments.map((env: { key: string }) => env.key)
    await act(async () =>
      mockPicker.onChange(
        new Map([
          ['alice', new Set([prod, dev])],
          ['ci', new Set([staging])],
          // Ignored: fixed one way or the other
          ['me', new Set([dev])],
          ['pat', new Set([dev])],
        ])
      )
    )
    await submit()

    expect(sentOptions().access).toEqual([
      { account: ALICE, memberType: MemberType.User, environments: [0, 2] },
      { account: CI, memberType: MemberType.Service, environments: [1] },
    ])
    expect(mockPush).toHaveBeenCalledWith('/acme/apps/app-9')
  })

  it('drops access to an environment removed after it was chosen', async () => {
    await open()
    await name('payments')
    await submit()
    const [, staging, prod] = mockPicker.environments.map((env: { key: string }) => env.key)
    await act(async () =>
      mockPicker.onChange(
        new Map([
          ['alice', new Set([staging, prod])],
          ['ci', new Set([staging])],
        ])
      )
    )

    await click(button(/Back/)!)
    await click(button('Remove Staging')!)
    await submit()
    await submit()

    expect(sentOptions().environments.map((env: { name: string }) => env.name)).toEqual([
      'Development',
      'Production',
    ])
    expect(sentOptions().access).toEqual([
      { account: ALICE, memberType: MemberType.User, environments: [1] },
    ])
  })

  it('reports what could not be done and still opens the App', async () => {
    mockQueries.GetOrganisationMembers = loaded({ organisationMembers: [ME] })
    mockQueries.GetServiceAccounts = loaded({ serviceAccounts: [] })
    mockCreateApplication.mockResolvedValueOnce({
      id: 'app-9',
      environments: [{ id: 'env-1', name: 'Development' }, null, null],
      secretsImported: true,
      accessGiven: false,
      teamsGiven: true,
    })
    await open()
    await name('payments')
    await submit()

    expect(toast.warning).toHaveBeenCalledWith(
      "payments was created, but Staging and Production couldn't be created and the access you chose couldn't be given."
    )
    expect(mockPush).toHaveBeenCalledWith('/acme/apps/app-9')
  })

  it('stays open with the error when the App could not be created', async () => {
    mockQueries.GetOrganisationMembers = loaded({ organisationMembers: [ME] })
    mockQueries.GetServiceAccounts = loaded({ serviceAccounts: [] })
    mockCreateApplication.mockRejectedValueOnce(
      new Error("You don't have permission to create Apps")
    )
    await open()
    await name('payments')
    await submit()

    expect(form().textContent).toContain("You don't have permission to create Apps")
    expect(mockPush).not.toHaveBeenCalled()
  })

  describe('the primary environment', () => {
    beforeEach(() => {
      mockQueries.GetOrganisationMembers = loaded({ organisationMembers: [ME] })
      mockQueries.GetServiceAccounts = loaded({ serviceAccounts: [] })
    })

    it('is Production to begin with, and the one chosen after that', async () => {
      await open()
      expect(primaryRadios().map((radio) => radio.checked)).toEqual([false, false, true])

      await click(primaryRadios()[0])
      expect(primaryRadios().map((radio) => radio.checked)).toEqual([true, false, false])
      await name('payments')
      await submit()

      expect(primaryOf(sentOptions())).toEqual(['Development'])
    })

    it('can be an added environment', async () => {
      await open()
      await click(button(/Add Environment/)!)
      await type(envInputs()[3], 'Main')
      await click(primaryRadios()[3])
      await name('payments')
      await submit()

      expect(primaryOf(sentOptions())).toEqual(['Main'])
    })

    it('is none once it is removed, and Production put back is primary again', async () => {
      await open()
      await click(button('Remove Production')!)
      expect(primaryRadios().some((radio) => radio.checked)).toBe(false)

      await click(button(/^\s*Production$/)!)
      expect(primaryRadios().map((radio) => radio.checked)).toEqual([false, false, true])

      await click(button('Remove Production')!)
      await name('payments')
      await submit()
      expect(primaryOf(sentOptions())).toEqual([])
    })

    it('stays where it was moved when Production is put back', async () => {
      await open()
      await click(primaryRadios()[1])
      await click(button('Remove Production')!)
      await click(button(/^\s*Production$/)!)

      expect(primaryRadios().map((radio) => radio.checked)).toEqual([false, true, false])
    })
  })

  describe('importing secrets', () => {
    beforeEach(() => {
      mockQueries.GetOrganisationMembers = loaded({ organisationMembers: [ME] })
      mockQueries.GetServiceAccounts = loaded({ serviceAccounts: [] })
    })
    const importer = () => organisation({ role: IMPORTER_ROLE } as any)
    const switches = () =>
      Array.from(form().querySelectorAll<HTMLButtonElement>('table [role="switch"]'))

    it('is skipped when nothing is entered', async () => {
      mockQueries.GetOrganisationMembers = loaded({ organisationMembers: [ME, ALICE] })
      await open(importer())
      await name('payments')
      await submit()
      expect(form().querySelector('textarea')).not.toBeNull()

      await click(button(/Skip/)!)
      expect(document.body.querySelector('[data-testid="picker"]')).not.toBeNull()
      await submit()
      expect(sentOptions().secrets).toEqual([])
    })

    it('creates the App from it when there is nobody else to choose', async () => {
      await open(importer())
      await name('payments')
      await submit()
      expect(button(/Skip/)).toBeUndefined()

      await click(button('Create App')!)
      expect(sentOptions().secrets).toEqual([])
    })

    it('is a step only for those who may create secrets', async () => {
      await open()
      await name('payments')
      await submit()

      expect(form().querySelector('textarea')).toBeNull()
      expect(mockCreateApplication).toHaveBeenCalled()
    })

    it('puts values and comments in the first environment, and the keys alone in the others', async () => {
      await open(importer())
      await name('payments')
      await submit()
      await typeText('# Where payments go\nAPI_URL=https://api.example.test\nretries=3')
      await submit()

      expect(form().textContent).toContain('2 secrets found')
      expect(form().querySelectorAll('table tbody tr')).toHaveLength(3)
      await submit()

      const [dev, staging, prod] = sentOptions().secrets
      expect(sentOptions().secrets.map((s: { environment: number }) => s.environment)).toEqual([
        0, 1, 2,
      ])
      expect(dev.secrets.map(({ key, value, comment }: any) => [key, value, comment])).toEqual([
        ['API_URL', 'https://api.example.test', 'Where payments go'],
        ['RETRIES', '3', ''],
      ])
      for (const keysOnly of [staging, prod])
        expect(
          keysOnly.secrets.map(({ key, value, comment }: any) => [key, value, comment])
        ).toEqual([
          ['API_URL', '', ''],
          ['RETRIES', '', ''],
        ])
    })

    it('leaves out an environment switched off, and takes values where switched on', async () => {
      await open(importer())
      await name('payments')
      await submit()
      await typeText('API_URL=https://api.example.test')
      await submit()

      // Each row: the environment, its values, its comments
      await click(switches()[3])
      await click(switches()[7])
      await submit()

      expect(sentOptions().secrets.map((s: { environment: number }) => s.environment)).toEqual([
        0, 2,
      ])
      expect(sentOptions().secrets[1].secrets[0].value).toBe('https://api.example.test')
    })

    it('does not go on with a key that appears twice', async () => {
      await open(importer())
      await name('payments')
      await submit()
      await typeText('API_URL=one\napi_url=two\nPORT=1\nPORT=2')
      await submit()

      expect(form().textContent).toContain('API_URL and PORT are in here more than once')
      expect(form().querySelector('table')).toBeNull()
    })

    it('does not go on without a secret in what was entered', async () => {
      await open(importer())
      await name('payments')
      await submit()
      await typeText('just some words')
      await submit()

      expect(form().textContent).toContain('No secrets found')
      expect(form().querySelector('table')).toBeNull()
    })

    it('goes back to the secrets as they were entered', async () => {
      await open(importer())
      await name('payments')
      await submit()
      await typeText('API_URL=https://api.example.test')
      await submit()
      await click(button(/Back/)!)

      expect(form().querySelector('textarea')!.value).toBe('API_URL=https://api.example.test')
      expect(button(/Next/)).toBeDefined()
    })
  })

  describe('teams', () => {
    beforeEach(() => {
      mockQueries.GetTeams = loaded({ teams: [PLATFORM, MOBILE, WEB] })
    })
    const teamIds = () => mockPicker.teams.map((t: { id: string }) => t.id)
    const toAccess = async (role: object) => {
      await open(organisation({ role } as any))
      await name('payments')
      await submit()
    }

    it('offers an owner or admin every team', async () => {
      await toAccess(teamsRole(true, true))
      expect(teamIds()).toEqual(['platform', 'mobile', 'web'])
    })

    it("offers anyone else the teams they're in", async () => {
      await toAccess(teamsRole(false, true))
      expect(teamIds()).toEqual(['platform'])
    })

    it('offers only the teams they own without the role to add any team', async () => {
      mockQueries.GetTeams = loaded({ teams: [PLATFORM, team('ops', ['me'], 'me')] })
      await toAccess(teamsRole(false, false))
      expect(teamIds()).toEqual(['ops'])
    })

    it('offers no teams without the right to change the encryption mode', async () => {
      await toAccess({
        name: 'Manager',
        permissions: permissions(true, { org: { Teams: ['read', 'update'] } }),
      })
      expect(mockPicker.teams).toEqual([])
    })

    it('gives the teams chosen their environments, with server-side encryption', async () => {
      await toAccess(teamsRole(true, true))
      expect(document.body.textContent).toContain('End-to-End Encrypted')

      const [dev, , prod] = mockPicker.environments.map((env: { key: string }) => env.key)
      await act(async () => mockPicker.onChange(new Map([['platform', new Set([prod, dev])]])))
      expect(document.body.textContent).toContain('Server-side Encrypted')
      await submit()

      expect(sentOptions().teams).toEqual([{ teamId: 'platform', environments: [0, 2] }])
      expect(sentOptions().access).toEqual([])
    })

    it('says when the teams could not be given access', async () => {
      mockCreateApplication.mockResolvedValueOnce({
        id: 'app-9',
        environments: [
          { id: 'e1', name: 'Development' },
          { id: 'e2', name: 'Staging' },
          { id: 'e3', name: 'Production' },
        ],
        secretsImported: true,
        accessGiven: true,
        teamsGiven: false,
      })
      await toAccess(teamsRole(true, true))
      const [dev] = mockPicker.environments.map((env: { key: string }) => env.key)
      await act(async () => mockPicker.onChange(new Map([['platform', new Set([dev])]])))
      await submit()

      expect(toast.warning).toHaveBeenCalledWith(
        "payments was created, but the teams you chose couldn't be given access."
      )
    })
  })
})
