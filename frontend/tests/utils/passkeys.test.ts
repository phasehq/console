jest.mock('@simplewebauthn/browser', () => {
  class WebAuthnError extends Error {
    code: string
    constructor({ message, code, name }: { message: string; code: string; name: string }) {
      super(message)
      this.code = code
      this.name = name
    }
  }
  return {
    WebAuthnError,
    browserSupportsWebAuthn: jest.fn(() => true),
    sendSignal: jest.fn(() => Promise.resolve()),
    WebAuthnAbortService: { cancelCeremony: jest.fn() },
    startRegistration: jest.fn(),
    startAuthentication: jest.fn(),
  }
})
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), info: jest.fn() } }))

import {
  browserSupportsWebAuthn,
  sendSignal,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
} from '@simplewebauthn/browser'
import { toast } from 'react-toastify'
import {
  cancellable,
  createPasskey,
  credentialIdOf,
  describePasskeyError,
  forgetPasskey,
  getPasskeyAssertion,
  notifyPasskeyFailure,
  rpIdOf,
} from '@/utils/passkeys'

const mocked = {
  supported: browserSupportsWebAuthn as jest.Mock,
  register: startRegistration as jest.Mock,
  authenticate: startAuthentication as jest.Mock,
  signal: sendSignal as jest.Mock,
}

const webAuthnError = (code: string, name = 'Error', message = code) =>
  new (WebAuthnError as unknown as new (args: object) => Error)({ message, code, name })

const domError = (name: string, message = 'browser said no') => {
  const error = new Error(message)
  error.name = name
  return error
}

afterEach(() => {
  jest.clearAllMocks()
  mocked.supported.mockReturnValue(true)
})

describe('passkey ceremonies', () => {
  it('parses JSONString options and serializes the response for the backend', async () => {
    mocked.register.mockResolvedValue({ id: 'cred', response: { transports: ['usb'] } })
    const result = await createPasskey('{"challenge":"abc","extensions":{"prf":{}}}')

    expect(mocked.register).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'abc', extensions: { prf: {} } },
    })
    expect(JSON.parse(result)).toEqual({ id: 'cred', response: { transports: ['usb'] } })
    expect(credentialIdOf(result)).toBe('cred')
  })

  it('passes already-parsed options through', async () => {
    mocked.authenticate.mockResolvedValue({ id: 'cred' })
    const options = { challenge: 'abc', allowCredentials: [] }
    expect(await getPasskeyAssertion(options)).toBe('{"id":"cred"}')
    expect(mocked.authenticate).toHaveBeenCalledWith({ optionsJSON: options })
  })

  it('reads the RP ID from creation and request options', () => {
    expect(rpIdOf('{"rp":{"id":"console.example.com"}}')).toBe('console.example.com')
    expect(rpIdOf({ rpId: 'console.example.com' })).toBe('console.example.com')
    expect(rpIdOf(null)).toBeNull()
    expect(credentialIdOf('not json')).toBeNull()
  })
})

describe('cancellable', () => {
  it('passes results and failures through', async () => {
    await expect(cancellable(() => Promise.resolve('cred')).result).resolves.toBe('cred')
    await expect(cancellable(() => Promise.reject(new Error('x'))).result).rejects.toThrow('x')
  })

  it('settles with null on cancel, never waiting on the provider', async () => {
    const prompt = cancellable(() => new Promise<string>(() => {}))
    prompt.cancel()
    await expect(prompt.result).resolves.toBeNull()
    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalled()
  })
})

describe('forgetPasskey', () => {
  it('signals the credential as unknown', async () => {
    await forgetPasskey('console.example.com', 'cred-1')
    expect(mocked.signal).toHaveBeenCalledWith({
      signalName: 'unknownCredential',
      rpID: 'console.example.com',
      credentialID: 'cred-1',
    })
  })

  it('never throws, and skips without an ID', async () => {
    mocked.signal.mockRejectedValueOnce(new Error('not supported'))
    await expect(forgetPasskey('console.example.com', 'cred-1')).resolves.toBeUndefined()
    await forgetPasskey('console.example.com', null)
    await forgetPasskey(null, 'cred-1')
    expect(mocked.signal).toHaveBeenCalledTimes(1)
  })
})

describe('describePasskeyError', () => {
  it('treats a dismissed, timed-out or aborted prompt as a cancellation', () => {
    for (const error of [
      domError('NotAllowedError'),
      domError('AbortError'),
      webAuthnError('ERROR_CEREMONY_ABORTED'),
      // A password manager relaying it as a plain Error (Bitwarden does)
      new Error('The operation either timed out or was not allowed.'),
    ]) {
      const failure = describePasskeyError(error, 'fallback')
      expect(failure.cancelled).toBe(true)
      expect(failure.message).toMatch(/cancelled or timed out/)
      // The browser's boilerplate stays out of it
      expect(failure.message).not.toMatch(/browser said no/)
    }
  })

  it('explains known failures', () => {
    const cases: [Error, RegExp][] = [
      [webAuthnError('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'), /already registered/],
      [domError('InvalidStateError'), /already registered/],
      [webAuthnError('ERROR_INVALID_RP_ID'), /can't be used at localhost/],
      [domError('SecurityError', 'TLS certificate errors'), /trusted certificate.*TLS certificate/],
      [domError('NotSupportedError'), /key types/],
      [webAuthnError('ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG'), /key types/],
      [domError('ConstraintError'), /requirements/],
      [webAuthnError('ERROR_AUTHENTICATOR_GENERAL_ERROR'), /reported an error/],
    ]
    for (const [error, expected] of cases) {
      const failure = describePasskeyError(error, 'fallback')
      expect(failure.cancelled).toBe(false)
      expect(failure.message).toMatch(expected)
    }
  })

  it('says when the browser has no passkey support at all', () => {
    mocked.supported.mockReturnValue(false)
    expect(describePasskeyError(new Error('x'), 'fallback').message).toMatch(
      /doesn't support passkeys/
    )
  })

  it('falls back, with the browser detail when short', () => {
    expect(describePasskeyError(domError('WeirdError', 'odd'), 'Failed.').message).toBe(
      'Failed. (odd)'
    )
    expect(describePasskeyError(domError('WeirdError', 'x'.repeat(300)), 'Failed.').message).toBe(
      'Failed.'
    )
    expect(describePasskeyError('not an error', 'Failed.').message).toBe('Failed.')
  })

  it('notifies cancellations gently and failures as errors', () => {
    notifyPasskeyFailure(domError('NotAllowedError'), 'fallback')
    expect(toast.info).toHaveBeenCalledTimes(1)
    notifyPasskeyFailure(domError('NotSupportedError'), 'fallback')
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
