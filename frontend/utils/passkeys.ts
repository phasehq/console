import {
  browserSupportsWebAuthn,
  sendSignal,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
} from '@simplewebauthn/browser'
import { toast } from 'react-toastify'

// Ceremony options come from the backend as JSON (GraphQL JSONString fields
// arrive through Apollo as strings).
const parseOptions = (options: unknown) =>
  typeof options === 'string' ? JSON.parse(options) : options

export const passkeysSupported = () => browserSupportsWebAuthn()

// Both resolve to the browser's response serialized for the backend, which
// takes it as a JSON string.
export const createPasskey = async (options: unknown): Promise<string> =>
  JSON.stringify(await startRegistration({ optionsJSON: parseOptions(options) }))

export const getPasskeyAssertion = async (options: unknown): Promise<string> =>
  JSON.stringify(await startAuthentication({ optionsJSON: parseOptions(options) }))

/** Abort the browser prompt or password-manager window in progress, if
 * any: its promise rejects with an AbortError. Some providers (Bitwarden)
 * never answer once their window is closed, so the UI must not wait on
 * them to let the user move on. */
export const cancelPasskeyCeremony = () => WebAuthnAbortService.cancelCeremony()

/**
 * Run a ceremony the UI can walk away from: resolves to null as soon as the
 * returned `cancel` is called, whether or not the provider honours the
 * abort (some never settle once their window is closed).
 */
export const cancellable = <T>(ceremony: () => Promise<T>) => {
  let cancel = () => {}
  const result = new Promise<T | null>((resolve, reject) => {
    cancel = () => {
      resolve(null)
      cancelPasskeyCeremony()
    }
    ceremony().then(resolve, reject)
  })
  return { result, cancel: () => cancel() }
}

/** The RP ID a set of ceremony options is bound to. */
export const rpIdOf = (options: unknown): string | null => {
  const parsed = parseOptions(options) as { rp?: { id?: string }; rpId?: string } | null
  return parsed?.rp?.id ?? parsed?.rpId ?? null
}

/** The credential ID in a serialized ceremony response. */
export const credentialIdOf = (response: string): string | null => {
  try {
    return JSON.parse(response).id ?? null
  } catch {
    return null
  }
}

/**
 * Best effort: tell the passkey provider (password manager, platform or
 * browser) that a credential isn't registered here, so it stops offering
 * it — after a registration that failed or was abandoned, or a removal.
 * Only for credentials the server definitely doesn't hold: the provider may
 * delete it. Never throws.
 */
export const forgetPasskey = async (rpId: string | null, credentialId: string | null) => {
  if (!rpId || !credentialId) return
  try {
    await sendSignal({ signalName: 'unknownCredential', rpID: rpId, credentialID: credentialId })
  } catch {
    // Browser or provider without the Signal API: nothing more to do.
  }
}

export type PasskeyFailure = {
  // The user dismissed the prompt or it timed out: not an error as such.
  cancelled: boolean
  message: string
}

// The spec's wording for a dismissed or timed-out prompt. Password-manager
// extensions relay it across their own messaging, losing the error's name
// (Bitwarden throws a plain Error), so match the text too.
const DISMISSED = /timed out or was not allowed/i

// Browser messages carry no secrets and help with the unexpected cases.
const withDetail = (message: string, error: Error) =>
  error.message && error.message.length < 200 ? `${message} (${error.message})` : message

/** What to tell the user about a failed ceremony. */
export const describePasskeyError = (error: unknown, fallback: string): PasskeyFailure => {
  if (!(error instanceof Error)) return { cancelled: false, message: fallback }
  const code = error instanceof WebAuthnError ? error.code : undefined
  const failure = (message: string) => ({ cancelled: false, message })

  if (!browserSupportsWebAuthn())
    return failure("This browser doesn't support passkeys. Use another method or browser.")
  // Browsers deliberately report cancel, timeout and "no matching passkey on
  // this device" alike; some report a dismissed prompt as an abort.
  if (
    error.name === 'NotAllowedError' ||
    error.name === 'AbortError' ||
    code === 'ERROR_CEREMONY_ABORTED' ||
    DISMISSED.test(error.message)
  )
    return {
      cancelled: true,
      message:
        'The passkey request was cancelled or timed out. If your passkey is on another device or hardware security key, try again and choose it.',
    }
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || error.name === 'InvalidStateError')
    return failure('This passkey or hardware security key is already registered to your account.')
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID')
    return failure(
      `Passkeys can't be used at ${window.location.hostname}. Open Phase Console at its usual address, or ask your administrator to check its passkey settings.`
    )
  if (error.name === 'SecurityError')
    return failure(
      withDetail(
        'Your browser blocked passkeys on this site. They need a secure connection with a trusted certificate.',
        error
      )
    )
  if (
    code === 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG' ||
    error.name === 'NotSupportedError'
  )
    return failure(
      "This passkey provider or hardware security key doesn't support the key types Phase Console accepts. Try another one."
    )
  if (code?.startsWith('ERROR_AUTHENTICATOR_MISSING') || error.name === 'ConstraintError')
    return failure(
      "This passkey provider or hardware security key can't meet the request's requirements. Try another one."
    )
  if (code === 'ERROR_AUTHENTICATOR_GENERAL_ERROR' || error.name === 'UnknownError')
    return failure(
      withDetail(
        'Your passkey provider or hardware security key reported an error. Try again, or use another one.',
        error
      )
    )
  return failure(withDetail(fallback, error))
}

/** Toast a failed ceremony: gently when the user just dismissed the prompt. */
export const notifyPasskeyFailure = (error: unknown, fallback: string) => {
  const failure = describePasskeyError(error, fallback)
  if (failure.cancelled) toast.info(failure.message, { autoClose: 6000 })
  else toast.error(failure.message, { autoClose: 8000 })
}
