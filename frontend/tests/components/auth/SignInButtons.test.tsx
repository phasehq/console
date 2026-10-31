import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

let mockSearch = ''
const mockPost = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))
jest.mock('next/link', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: ({ href, children }: { href: string; children: React.ReactNode }) =>
      React.createElement('a', { href }, children),
  }
})
jest.mock('@/contexts/userContext', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))
jest.mock('@apollo/client', () => ({ useQuery: () => ({ data: undefined }) }))
jest.mock(
  '@/graphql/queries/account/getAccountIdentities.gql',
  () => ({ GetAccountIdentities: {} }),
  { virtual: true }
)
jest.mock('@/utils/crypto', () => ({
  decodeb64string: jest.fn(),
  deviceVaultKey: jest.fn(),
  passwordAuthHash: jest.fn(),
}))
jest.mock('@/utils/auth', () => ({
  UrlUtils: { makeUrl: (...parts: string[]) => `${parts.join('/')}/` },
  isSafeRedirectPath: () => true,
}))
jest.mock('@/components/auth/TotpVerifyForm', () => ({ __esModule: true, default: () => null }))
jest.mock('react-toastify', () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}))
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args), isAxiosError: () => false },
}))

import SignInButtons from '@/components/auth/SignInButtons'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const API = 'https://api.test'
const okta = {
  kind: 'org-sso',
  id: 'cfg-1',
  provider: 'okta',
  providerName: 'Okta',
  organisationName: 'Acme',
}
const oktaMethod = {
  id: 'cfg-1',
  providerType: 'oidc',
  provider: 'okta',
  providerName: 'Okta',
  organisationName: 'Acme',
  enforced: false,
}

const remember = (logins: { email: string; method: object }[]) =>
  localStorage.setItem(
    'phase-last-login',
    JSON.stringify({
      v: 1,
      logins: logins.map((l, i) => ({ ...l, lastUsedAt: Date.now() - (i + 1) * 1000 })),
    })
  )

describe('SignInButtons — last used sign-in', () => {
  let container: HTMLDivElement
  let root: Root
  let originalLocation: Location

  const render = async (props: Partial<React.ComponentProps<typeof SignInButtons>> = {}) => {
    await act(async () => {
      root.render(<SignInButtons providers={['google', 'github']} passwordAuthEnabled {...props} />)
    })
  }
  const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)))
  const buttons = () => Array.from(container.querySelectorAll('button'))
  const button = (text: string | RegExp) =>
    buttons().find((b) =>
      typeof text === 'string'
        ? b.textContent === text || b.getAttribute('aria-label') === text
        : text.test(b.textContent ?? '') || text.test(b.getAttribute('aria-label') ?? '')
    )
  const click = (el: Element | undefined) =>
    act(async () => {
      if (!el) throw new Error('element not found')
      ;(el as HTMLElement).click()
    })

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_API_BASE = API
    mockSearch = ''
    mockPost.mockReset()
    localStorage.clear()
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/login' },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  test('without history, shows the full form with no hints', async () => {
    await render()
    expect(button(/Continue with Google/)).toBeDefined()
    expect(container.textContent).not.toContain('Last used')
    expect(container.querySelector('ul[aria-label="Accounts on this device"]')).toBeNull()
  })

  test('offers remembered accounts first, most recent marked', async () => {
    remember([
      { email: 'ada@acme.test', method: { kind: 'instance-sso', slug: 'google' } },
      { email: 'bob@acme.test', method: { kind: 'password' } },
    ])
    await render()

    const rows = container.querySelectorAll('ul[aria-label="Accounts on this device"] > li')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('ada@acme.test')
    expect(rows[0].textContent).toContain('Last used')
    expect(rows[1].textContent).not.toContain('Last used')
    expect(button(/Continue with Google/)).toBeUndefined()
  })

  test('"Use another account" shows the full form with the last method marked', async () => {
    remember([{ email: 'ada@acme.test', method: { kind: 'instance-sso', slug: 'github' } }])
    await render()
    await click(button('Use another account'))

    expect(button(/Continue with GitHub/)?.textContent).toContain('Last used')
    expect(button(/Continue with Google/)?.textContent).not.toContain('Last used')

    // and back again
    await click(button('Back'))
    expect(button('Use another account')).toBeDefined()
  })

  test('a remembered instance SSO account goes straight to its provider', async () => {
    remember([{ email: 'ada@acme.test', method: { kind: 'instance-sso', slug: 'google' } }])
    await render()
    await click(button(/Continue as ada@acme.test/))

    expect(window.location.href).toBe(`${API}/auth/sso/google/authorize/`)
    expect(JSON.parse(localStorage.getItem('phase-pending-login')!).method).toEqual({
      kind: 'instance-sso',
      slug: 'google',
    })
    expect(mockPost).not.toHaveBeenCalled()
  })

  test('a remembered org SSO account goes to its IdP when still offered', async () => {
    remember([{ email: 'ops@acme.test', method: okta }])
    mockPost.mockResolvedValue({ data: { authMethods: { password: true, sso: [oktaMethod] } } })
    await render()
    await click(button(/Continue as ops@acme.test/))
    await flush()

    expect(mockPost.mock.calls[0][1]).toEqual({ email: 'ops@acme.test' })
    expect(window.location.href).toBe(`${API}/auth/sso/org/cfg-1/authorize/`)
  })

  test('a remembered org SSO account that is gone falls back to the next step', async () => {
    remember([{ email: 'ops@acme.test', method: okta }])
    mockPost.mockResolvedValue({ data: { authMethods: { password: true, sso: [] } } })
    await render()
    await click(button(/Continue as ops@acme.test/))
    await flush()

    expect(window.location.href).toBe('http://localhost/login')
    expect(container.querySelector('input[type=password]')).not.toBeNull()
    // Back returns to the chooser, not the blank form
    await click(button('ops@acme.test'))
    expect(button('Use another account')).toBeDefined()
  })

  test('marks the method this account used after the email check', async () => {
    remember([{ email: 'ops@acme.test', method: okta }])
    mockPost.mockResolvedValue({ data: { authMethods: { password: true, sso: [oktaMethod] } } })
    mockSearch = 'email=ops@acme.test'
    await render()

    // ?email= pins the account: no chooser, Continue marked for its org SSO
    expect(button('Use another account')).toBeUndefined()
    const continueButton = container.querySelector('form button[type=submit]')!
    expect(continueButton.textContent).toContain('Last used')

    await act(async () => {
      continueButton.closest('form')!.requestSubmit()
    })
    await flush()
    expect(button(/Sign in with Okta/)?.textContent).toContain('Last used')
    expect(button(/^Log in/)?.textContent).not.toContain('Last used')
  })

  test('forgetting the only account returns to the full form', async () => {
    remember([{ email: 'ada@acme.test', method: { kind: 'password' } }])
    await render()
    await click(button('Remove ada@acme.test from this device'))

    expect(localStorage.getItem('phase-last-login')).toBeNull()
    expect(button(/Continue with Google/)).toBeDefined()
    expect(button('Back')).toBeUndefined()
  })

  test('corrupt storage is ignored', async () => {
    localStorage.setItem('phase-last-login', '{not json')
    await render()
    expect(button(/Continue with Google/)).toBeDefined()
  })
})
