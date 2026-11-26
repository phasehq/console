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

const permissions = (globalAccess: boolean) =>
  JSON.stringify({
    global_access: globalAccess,
    permissions: { Members: ['read'], ServiceAccounts: ['read'] },
    app_permissions: { Members: ['create'], ServiceAccounts: ['create'] },
  })
const OWNER_ROLE = { name: 'Owner', permissions: permissions(true) }
const DEV_ROLE = { name: 'Developer', permissions: permissions(false) }
const organisation = (overrides: Partial<OrganisationType> = {}) =>
  ({
    id: 'org-1',
    name: 'acme',
    plan: 'EN',
    planDetail: { maxEnvsPerApp: null },
    role: OWNER_ROLE,
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
    Array.from(form().querySelectorAll<HTMLInputElement>('ul[aria-label="Environments"] input'))
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
      accessGiven: true,
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
      { name: 'Development', envType: 'DEV', color: '#123456' },
      { name: 'Staging', envType: 'STAGING', color: null },
      { name: 'Production', envType: 'PROD', color: null },
    ])
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
      accessGiven: false,
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
})
