import React, { act, useEffect } from 'react'
import { createRoot, Root } from 'react-dom/client'

const beginVerification = jest.fn()

jest.mock(
  '@/graphql/mutations/account/beginPasskeyVerification.gql',
  () => ({ BeginPasskeyVerificationOp: {} }),
  { virtual: true }
)
jest.mock('@apollo/client', () => ({
  useMutation: () => [beginVerification],
}))
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), info: jest.fn() } }))
jest.mock('@simplewebauthn/browser', () => ({
  WebAuthnError: class extends Error {},
  WebAuthnAbortService: { cancelCeremony: jest.fn() },
  browserSupportsWebAuthn: () => true,
  startRegistration: jest.fn(),
  startAuthentication: jest.fn(),
}))

import { FactorProof, FactorProofFields, useFactorProof } from '@/components/account/FactorProof'
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser'
import { toast } from 'react-toastify'

const mockedAuthenticate = startAuthentication as jest.Mock

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let proof: FactorProof
const captureProof = (current: FactorProof) => {
  proof = current
}

const Harness = (props: { active: boolean; totp: boolean; passkey: boolean }) => {
  const current = useFactorProof(props)
  useEffect(() => captureProof(current))
  return <FactorProofFields proof={current} />
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

// The method tabs, the selected one marked
const tabs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="tab"]')).map(
    (tab) => `${tab.textContent}${tab.getAttribute('aria-selected') === 'true' ? ' *' : ''}`
  )

describe('useFactorProof', () => {
  let container: HTMLDivElement
  let root: Root
  let challenge: number

  const render = async (props: { active: boolean; totp: boolean; passkey: boolean }) => {
    await act(async () => root.render(<Harness {...props} />))
    await flush()
  }

  beforeEach(() => {
    challenge = 0
    beginVerification.mockImplementation(() =>
      Promise.resolve({
        data: { beginPasskeyVerification: { options: `{"challenge":"c${++challenge}"}` } },
      })
    )
    container = document.createElement('div')
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    jest.clearAllMocks()
  })

  it('fetches a passkey challenge only once the proof step is showing', async () => {
    await render({ active: false, totp: true, passkey: true })
    expect(beginVerification).not.toHaveBeenCalled()
    expect(proof.method).toBe('passkey')
    expect(proof.ready).toBe(false)

    await render({ active: true, totp: true, passkey: true })
    expect(beginVerification).toHaveBeenCalledTimes(1)
    expect(proof.ready).toBe(true)
    expect(tabs(container)).toEqual(['Passkey *', 'Authenticator app', 'Recovery code'])
  })

  it('collects an assertion without fetching a racing challenge', async () => {
    mockedAuthenticate.mockResolvedValue({ id: 'k1' })
    await render({ active: true, totp: false, passkey: true })

    let payload: unknown
    await act(async () => {
      payload = await proof.collect()
    })
    await flush()

    expect(mockedAuthenticate).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c1' } })
    expect(payload).toEqual({ passkeyCredential: '{"id":"k1"}' })
    // A new challenge now would replace the one the request in flight uses
    expect(beginVerification).toHaveBeenCalledTimes(1)
  })

  it('renews an idle challenge, but not one in use', async () => {
    jest.useFakeTimers()
    try {
      await render({ active: true, totp: false, passkey: true })
      expect(beginVerification).toHaveBeenCalledTimes(1)
      await act(async () => {
        jest.advanceTimersByTime(4 * 60 * 1000)
      })
      await flush()
      expect(beginVerification).toHaveBeenCalledTimes(2)

      // Prompt open (or proof submitted): the timer must not replace it
      mockedAuthenticate.mockReturnValue(new Promise(() => {}))
      act(() => {
        proof.collect()
      })
      await act(async () => {
        jest.advanceTimersByTime(4 * 60 * 1000)
      })
      await flush()
      expect(beginVerification).toHaveBeenCalledTimes(2)
    } finally {
      jest.useRealTimers()
    }
  })

  it('fetches a fresh challenge after the server rejects a proof', async () => {
    await render({ active: true, totp: false, passkey: true })
    await act(async () => proof.retry())
    await flush()
    expect(beginVerification).toHaveBeenCalledTimes(2)
  })

  it('a dismissed prompt yields no proof', async () => {
    const dismissed = new Error('not allowed')
    dismissed.name = 'NotAllowedError'
    mockedAuthenticate.mockRejectedValue(dismissed)
    await render({ active: true, totp: false, passkey: true })

    let payload: unknown = 'unset'
    await act(async () => {
      payload = await proof.collect()
    })
    expect(payload).toBeNull()
  })

  it('switching method mid-prompt aborts it quietly', async () => {
    let abort: (e: Error) => void = () => {}
    mockedAuthenticate.mockImplementation(() => new Promise((_, reject) => (abort = reject)))
    ;(WebAuthnAbortService.cancelCeremony as jest.Mock).mockImplementation(() => {
      const aborted = new Error('aborted')
      aborted.name = 'AbortError'
      abort(aborted)
    })
    await render({ active: true, totp: true, passkey: true })

    let payload: unknown = 'unset'
    await act(async () => {
      const pending = proof.collect().then((p) => (payload = p))
      proof.setMethod('totp')
      await pending
    })
    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled()
    expect(payload).toBeNull()
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('cancel() settles collect() even if the provider ignores the abort', async () => {
    mockedAuthenticate.mockImplementation(() => new Promise(() => {}))
    ;(WebAuthnAbortService.cancelCeremony as jest.Mock).mockImplementation(() => {})
    await render({ active: true, totp: false, passkey: true })

    let payload: unknown = 'unset'
    await act(async () => {
      const pending = proof.collect().then((p) => (payload = p))
      proof.cancel()
      await pending
    })
    expect(payload).toBeNull()
  })

  it('cancel() is a no-op without an open prompt', async () => {
    await render({ active: true, totp: false, passkey: true })
    act(() => proof.cancel())
    expect(WebAuthnAbortService.cancelCeremony).not.toHaveBeenCalled()
  })

  it('codes are ready only when complete', async () => {
    await render({ active: true, totp: true, passkey: false })
    expect(proof.method).toBe('totp')
    expect(beginVerification).not.toHaveBeenCalled()
    expect(tabs(container)).toEqual(['Authenticator app *', 'Recovery code'])

    await act(async () => proof.setCode('12345'))
    expect(proof.ready).toBe(false)
    await act(async () => proof.setCode('123456'))
    expect(proof.ready).toBe(true)
    expect(await proof.collect()).toEqual({ code: '123456' })

    await act(async () => proof.setMethod('recovery'))
    expect(tabs(container)).toEqual(['Authenticator app', 'Recovery code *'])
    expect(proof.ready).toBe(false)
    await act(async () => proof.setCode(' abcde-fghij '))
    expect(await proof.collect()).toEqual({ recoveryCode: 'abcde-fghij' })
  })
})
