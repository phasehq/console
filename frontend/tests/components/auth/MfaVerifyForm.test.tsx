import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import axios from 'axios'

jest.mock('axios')
jest.mock('react-toastify', () => ({
  toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() },
}))
jest.mock('@/apollo/client', () => ({
  getCsrfToken: jest.fn(() => Promise.resolve('csrf-token')),
  refreshCsrfToken: jest.fn(() => Promise.resolve('fresh-token')),
}))
jest.mock('@simplewebauthn/browser', () => ({
  WebAuthnError: class extends Error {},
  WebAuthnAbortService: { cancelCeremony: jest.fn() },
  browserSupportsWebAuthn: () => true,
  startRegistration: jest.fn(),
  startAuthentication: jest.fn(),
}))

import MfaVerifyForm from '@/components/auth/MfaVerifyForm'
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser'
import { toast } from 'react-toastify'

const mockedAxios = axios as jest.Mocked<typeof axios>
const mockedAuthenticate = startAuthentication as jest.Mock
const mockedToastError = toast.error as jest.Mock
const mockedToastInfo = toast.info as jest.Mock

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const PASSKEY_OPTIONS = { challenge: 'c1', allowCredentials: [{ id: 'k1', type: 'public-key' }] }
const SUCCESS = {
  userId: 'u1',
  email: 'alice@example.com',
  fullName: 'Alice',
  avatarUrl: null,
  authMethod: 'password',
  returnTo: '/acme',
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text))

const methodCards = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="radio"]'))
const methodLabel = (card: Element) => card.querySelector('.font-medium')?.textContent

// The method cards in order, the chosen one marked
const methods = (container: HTMLElement) =>
  methodCards(container).map(
    (card) => `${methodLabel(card)}${card.getAttribute('aria-checked') === 'true' ? ' *' : ''}`
  )

const methodCard = (container: HTMLElement, label: string) =>
  methodCards(container).find((card) => methodLabel(card) === label) as
    | HTMLButtonElement
    | undefined

const postsTo = (endpoint: string) =>
  mockedAxios.post.mock.calls.filter(([url]) => String(url).endsWith(`/auth/mfa/${endpoint}/`))

describe('MfaVerifyForm', () => {
  let container: HTMLDivElement
  let root: Root
  let onSuccess: jest.Mock
  let originalLocation: Location

  const mockBackend = ({
    methods,
    verify = () => Promise.resolve({ data: SUCCESS }),
  }: {
    methods: string[]
    verify?: () => Promise<unknown>
  }) => {
    let challenge = 0
    mockedAxios.post.mockImplementation((url: string) => {
      if (url.endsWith('/auth/mfa/options/'))
        return Promise.resolve({
          data: {
            methods,
            passkeyOptions: methods.includes('passkey')
              ? { ...PASSKEY_OPTIONS, challenge: `c${++challenge}` }
              : null,
          },
        })
      return verify() as Promise<never>
    })
  }

  const render = async () => {
    await act(async () => {
      root.render(<MfaVerifyForm onSuccess={onSuccess} />)
    })
    await flush()
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BACKEND_API_BASE = 'https://console.example.com/service'
    mockedAxios.isAxiosError.mockImplementation(
      (e: unknown) => !!(e as { response?: unknown })?.response
    )
    onSuccess = jest.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'https://console.example.com/login/mfa',
        hostname: 'console.example.com',
        search: '',
        replace: jest.fn(),
      },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    jest.clearAllMocks()
  })

  it('offers the passkey first and signs in with it', async () => {
    mockBackend({ methods: ['totp', 'passkey'] })
    mockedAuthenticate.mockResolvedValue({ id: 'k1', response: { signature: 'sig' } })
    await render()

    expect(methods(container)).toEqual(['Passkey *', 'Authenticator app', 'Recovery code'])

    await act(async () => buttonByText(container, 'Use passkey')!.click())
    await flush()

    expect(mockedAuthenticate).toHaveBeenCalledWith({
      optionsJSON: { ...PASSKEY_OPTIONS, challenge: 'c1' },
    })
    const [, body, config] = postsTo('verify')[0]
    // The credential travels as a JSON string; CSRF header attached
    expect(body).toEqual({ passkeyCredential: '{"id":"k1","response":{"signature":"sig"}}' })
    expect(config).toMatchObject({ headers: { 'X-CSRFToken': 'csrf-token' } })
    expect(onSuccess).toHaveBeenCalledWith(SUCCESS)
  })

  it('shows only the authenticator code for a TOTP-only account', async () => {
    mockBackend({ methods: ['totp'] })
    await render()

    expect(container.textContent).toContain('6-digit code')
    expect(methods(container)).toEqual(['Authenticator app *', 'Recovery code'])
    expect(buttonByText(container, 'Use passkey')).toBeUndefined()
  })

  it('a passkey-only account can fall back to a recovery code', async () => {
    mockBackend({ methods: ['passkey'] })
    await render()

    expect(methods(container)).toEqual(['Passkey *', 'Recovery code'])
    await act(async () => methodCard(container, 'Recovery code')!.click())
    expect(container.querySelector('input[placeholder="xxxxx-xxxxx"]')).toBeTruthy()
    expect(methods(container)).toEqual(['Passkey', 'Recovery code *'])
  })

  it('a dismissed passkey prompt sends nothing and stays quiet', async () => {
    mockBackend({ methods: ['passkey'] })
    const dismissed = new Error('not allowed')
    dismissed.name = 'NotAllowedError'
    mockedAuthenticate.mockRejectedValue(dismissed)
    await render()

    await act(async () => buttonByText(container, 'Use passkey')!.click())
    await flush()

    expect(postsTo('verify')).toHaveLength(0)
    expect(mockedToastError).not.toHaveBeenCalled()
    // A gentle note, not an error: and the same challenge serves a retry
    expect(mockedToastInfo).toHaveBeenCalledWith(
      expect.stringMatching(/cancelled or timed out/),
      expect.anything()
    )
    expect(postsTo('options')).toHaveLength(1)
    expect((buttonByText(container, 'Use passkey') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a prompt that never answers can be left for a recovery code', async () => {
    // e.g. Bitwarden's window closed: its promise never settles on its own
    mockBackend({ methods: ['passkey'] })
    let abort: (e: Error) => void = () => {}
    mockedAuthenticate.mockImplementation(() => new Promise((_, reject) => (abort = reject)))
    ;(WebAuthnAbortService.cancelCeremony as jest.Mock).mockImplementation(() => {
      const aborted = new Error('aborted')
      aborted.name = 'AbortError'
      abort(aborted)
    })
    await render()

    await act(async () => buttonByText(container, 'Use passkey')!.click())
    const recovery = methodCard(container, 'Recovery code')!
    expect(recovery.disabled).toBe(false)
    await act(async () => recovery.click())
    await flush()

    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled()
    expect(container.querySelector('input[placeholder="xxxxx-xxxxx"]')).toBeTruthy()
    // We aborted it: no "cancelled" note
    expect(mockedToastInfo).not.toHaveBeenCalled()
    expect(mockedToastError).not.toHaveBeenCalled()
  })

  it('a provider that ignores the abort still lets the user switch and verify', async () => {
    mockBackend({ methods: ['passkey'] })
    mockedAuthenticate.mockImplementation(() => new Promise(() => {}))
    ;(WebAuthnAbortService.cancelCeremony as jest.Mock).mockImplementation(() => {})
    await render()

    await act(async () => buttonByText(container, 'Use passkey')!.click())
    await act(async () => methodCard(container, 'Recovery code')!.click())
    await flush()

    const verify = buttonByText(container, 'Verify') as HTMLButtonElement
    expect(verify.disabled).toBe(false)
  })

  it('a rejected passkey fetches a fresh challenge for the retry', async () => {
    mockBackend({
      methods: ['passkey'],
      verify: () =>
        Promise.reject({
          response: {
            status: 401,
            data: {
              error: "This passkey isn't registered to your account.",
              code: 'passkey_unknown_credential',
            },
          },
        }),
    })
    mockedAuthenticate.mockResolvedValue({ id: 'k1' })
    await render()

    await act(async () => buttonByText(container, 'Use passkey')!.click())
    await flush()

    // The server's reason, as written for the user
    expect(mockedToastError).toHaveBeenCalledWith(
      "This passkey isn't registered to your account.",
      expect.anything()
    )
    expect(postsTo('options')).toHaveLength(2)
    await act(async () => buttonByText(container, 'Use passkey')!.click())
    await flush()
    expect(mockedAuthenticate).toHaveBeenLastCalledWith({
      optionsJSON: { ...PASSKEY_OPTIONS, challenge: 'c2' },
    })
  })

  it('sends the user back to /login when no sign-in is pending', async () => {
    mockedAxios.post.mockRejectedValue({
      response: { status: 400, data: { code: 'no_pending' } },
    })
    await render()

    // Replaced, so Back doesn't return to a page with nothing to verify
    expect(window.location.replace).toHaveBeenCalledWith('/login')
    expect(container.querySelector('input')).toBeNull()
    expect(postsTo('verify')).toHaveLength(0)
  })

  it('keeps codes usable when the options fail to load, and retries', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('Network Error'))
    await render()

    expect(container.textContent).toContain("Couldn't load your passkey sign-in")
    expect(container.querySelector('input[placeholder="000000"]')).toBeTruthy()
    expect(methods(container)).toEqual(['Authenticator app *', 'Recovery code'])

    mockBackend({ methods: ['passkey'] })
    await act(async () => buttonByText(container, 'Try again')!.click())
    await flush()

    expect(container.textContent).not.toContain("Couldn't load")
    // A passkey-only account lands on the passkey, not the code guess
    expect(buttonByText(container, 'Use passkey')).toBeTruthy()
  })

  it('renews an idle passkey challenge before it expires', async () => {
    jest.useFakeTimers()
    try {
      mockBackend({ methods: ['passkey'] })
      await render()
      expect(postsTo('options')).toHaveLength(1)

      await act(async () => {
        jest.advanceTimersByTime(4 * 60 * 1000)
      })
      await flush()
      expect(postsTo('options')).toHaveLength(2)

      mockedAuthenticate.mockResolvedValue({ id: 'k1' })
      await act(async () => buttonByText(container, 'Use passkey')!.click())
      await flush()
      expect(mockedAuthenticate).toHaveBeenCalledWith({
        optionsJSON: { ...PASSKEY_OPTIONS, challenge: 'c2' },
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps the passkey when codes are locked', async () => {
    mockedAxios.post.mockImplementation((url: string) =>
      url.endsWith('/auth/mfa/options/')
        ? Promise.resolve({
            data: { methods: ['passkey'], passkeyOptions: PASSKEY_OPTIONS, codesLocked: true },
          })
        : (Promise.resolve({ data: SUCCESS }) as Promise<never>)
    )
    mockedAuthenticate.mockResolvedValue({ id: 'k1' })
    await render()

    expect(container.textContent).toContain('Too many incorrect codes')
    expect(methods(container)).toEqual(['Passkey *'])
    await act(async () => buttonByText(container, 'Use passkey')!.click())
    await flush()
    expect(onSuccess).toHaveBeenCalledWith(SUCCESS)
  })

  it('a code that hits the lockout switches a passkey user to their passkey', async () => {
    mockBackend({
      methods: ['totp', 'passkey'],
      verify: () => Promise.reject({ response: { status: 429, data: { code: 'locked_out' } } }),
    })
    await render()
    await act(async () => methodCard(container, 'Authenticator app')!.click())
    await act(async () => {
      const input = container.querySelector('input[placeholder="000000"]') as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setValue.call(input, '123456')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await flush()

    expect(postsTo('verify')).toHaveLength(1)
    expect(container.textContent).toContain('Too many incorrect codes')
    expect(methods(container)).toEqual(['Passkey *'])
    expect(container.textContent).not.toContain('Please wait a few minutes and log in again')
  })

  it('a plain rate limit on the options is not a lockout', async () => {
    mockedAxios.post.mockRejectedValueOnce({ response: { status: 429, data: {} } })
    await render()

    expect(container.textContent).not.toContain('Too many incorrect attempts')
    expect(container.textContent).toContain("Couldn't load your passkey sign-in")
    expect(container.querySelector('input[placeholder="000000"]')).toBeTruthy()
  })

  it('replaces the form when locked out', async () => {
    mockedAxios.post.mockRejectedValue({
      response: { status: 429, data: { code: 'locked_out' } },
    })
    await render()

    expect(container.textContent).toContain('Too many incorrect attempts')
  })
})
