'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import axios, { AxiosResponse } from 'axios'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { FaCheck, FaRedo } from 'react-icons/fa'
import { GoPasskeyFill } from 'react-icons/go'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import Spinner from '../common/Spinner'
import TotpCodeInput from './TotpCodeInput'
import { RecoveryCodeInput } from './RecoveryCodeInput'
import { FACTOR_METHOD_ORDER, FACTOR_METHODS, FactorMethod } from './FactorMethods'
import { UrlUtils } from '@/utils/auth'
import { getCsrfToken, refreshCsrfToken } from '@/apollo/client'
import { cancellable, getPasskeyAssertion, notifyPasskeyFailure } from '@/utils/passkeys'

export type MfaVerifySuccess = {
  userId: string
  email: string
  fullName: string
  avatarUrl: string | null
  authMethod: string
  returnTo: string | null
}

type Method = FactorMethod

type Payload = { code?: string; recoveryCode?: string; passkeyCredential?: string }

// Passkey challenges live 5 minutes server-side: renew before then, so a
// user who comes back to the page isn't met with an expired request.
const OPTIONS_REFRESH_MS = 4 * 60 * 1000

// Passkeys first: one tap, and phishing-resistant.
const preferredMethod = (available: Method[]): Method =>
  available.includes('passkey') ? 'passkey' : available.includes('totp') ? 'totp' : 'recovery'

const mfaUrl = (endpoint: 'options' | 'verify') =>
  UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'mfa', endpoint)

export default function MfaVerifyForm({
  onSuccess,
}: {
  onSuccess: (data: MfaVerifySuccess) => void
}) {
  // The user's factors, from the options endpoint (null while loading).
  // Recovery codes are always offered.
  const [methods, setMethods] = useState<Method[] | null>(null)
  const [passkeyOptions, setPasskeyOptions] = useState<unknown>(null)
  const [method, setMethod] = useState<Method>('totp')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [pending, setPending] = useState(false)
  // The browser's passkey prompt (or a password manager's window) is open.
  const [prompting, setPrompting] = useState(false)
  const [lockedOut, setLockedOut] = useState(false)
  // Too many wrong codes: codes are locked, the passkey still works.
  const [codesLocked, setCodesLocked] = useState(false)
  // The options request failed: codes still work, passkeys need a retry.
  const [loadFailed, setLoadFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const passkeyButtonRef = useRef<HTMLButtonElement>(null)
  // A ceremony or verify request is in flight: don't replace its challenge.
  const pendingRef = useRef(false)
  pendingRef.current = pending
  // Cancels the open prompt, settling it at once.
  const cancelPromptRef = useRef<(() => void) | null>(null)
  const submittedRef = useRef(false)
  // Only the latest options response counts — each one replaces the
  // server's passkey challenge.
  const optionsRequestRef = useRef(0)

  const post = async (
    endpoint: 'options' | 'verify',
    payload: Payload,
    isRetry = false
  ): Promise<AxiosResponse> => {
    const csrfToken = await getCsrfToken()
    try {
      return await axios.post(mfaUrl(endpoint), payload, {
        withCredentials: true,
        headers: csrfToken ? { 'X-CSRFToken': csrfToken } : {},
      })
    } catch (err) {
      if (
        !isRetry &&
        axios.isAxiosError(err) &&
        err.response?.status === 403 &&
        err.response.data?.code === 'csrf_failed'
      ) {
        // Stale token (rotated by a login in another tab) — retry once
        await refreshCsrfToken()
        return post(endpoint, payload, true)
      }
      throw err
    }
  }

  // Responses that end the challenge. True when handled.
  const handleFatalError = (err: unknown) => {
    if (!axios.isAxiosError(err) || !err.response) return false
    if (err.response.status === 429 && err.response.data?.code === 'locked_out') {
      // Locked out with no passkey to fall back on: the form is replaced
      // by an alert — stay disabled. (A plain rate limit isn't fatal.)
      setLockedOut(true)
      return true
    }
    if (err.response.status === 410 || err.response.data?.code === 'no_pending') {
      toast.error('Sign-in expired. Please log in again.', { autoClose: 8000 })
      // Preserve callbackUrl/email so the password flow keeps its deep
      // link; a no-op on /login/mfa (its return_to was server-side).
      // Replace, not push: /login/mfa opened directly or reached with Back
      // (nothing pending) mustn't stay in the history. Navigating away —
      // stay disabled.
      window.location.replace('/login' + window.location.search)
      return true
    }
    return false
  }

  const loadOptions = async () => {
    const requestId = ++optionsRequestRef.current
    try {
      const { data } = await post('options', {})
      if (requestId !== optionsRequestRef.current) return null
      const available = (data.methods as string[]).filter(
        (m): m is Method => m === 'passkey' || m === 'totp'
      )
      setPasskeyOptions(data.passkeyOptions)
      setMethods(available)
      setCodesLocked(!!data.codesLocked)
      setLoadFailed(false)
      // A retry after a failed load may show the fallback guess was wrong.
      setMethod((current) =>
        current === 'recovery' || available.includes(current) ? current : preferredMethod(available)
      )
      return available
    } catch (err) {
      if (requestId !== optionsRequestRef.current || handleFatalError(err)) return null
      // Codes are checked without the options; offer them while passkeys
      // wait for a retry.
      setPasskeyOptions(null)
      setLoadFailed(true)
      setMethods((current) => current ?? ['totp'])
      setMethod((current) => (current === 'passkey' ? 'recovery' : current))
      return null
    }
  }

  useEffect(() => {
    loadOptions().then((available) => {
      if (available) setMethod(preferredMethod(available))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Focus the passkey button once it's usable: Enter then starts the
  // prompt, and it closes a password manager's menu left over from the
  // password field (removing a focused input fires no blur, so Bitwarden's
  // "Save to Bitwarden" menu otherwise stays on top of this button).
  useEffect(() => {
    if (method === 'passkey' && passkeyOptions) passkeyButtonRef.current?.focus()
  }, [method, passkeyOptions])

  const hasPasskeys = !!methods?.includes('passkey')
  useEffect(() => {
    if (!hasPasskeys) return
    const timer = setInterval(() => {
      if (!pendingRef.current) loadOptions()
    }, OPTIONS_REFRESH_MS)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPasskeys])

  const submit = async (payload: Payload): Promise<void> => {
    setPending(true)
    try {
      const { data } = await post('verify', payload)
      // Success: leave the button disabled for good — the redirect is in
      // flight, and re-enabling invites a duplicate submit of a code the
      // replay guard has already consumed.
      onSuccess(data)
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const lockedOutNow =
        status === 429 && axios.isAxiosError(err) && err.response?.data?.code === 'locked_out'
      if (
        lockedOutNow &&
        !payload.passkeyCredential &&
        methods?.includes('passkey') &&
        !loadFailed
      ) {
        // Codes are locked, but the passkey can't be guessed: offer it.
        setCodesLocked(true)
        switchTo('passkey')
        setPending(false)
        submittedRef.current = false
        return
      }
      if (handleFatalError(err)) return
      if (status === 429) {
        toast.error('Too many requests. Wait a moment and try again.', { autoClose: 5000 })
      } else if (payload.passkeyCredential) {
        // The server's reason (expired, not this account's passkey, ...)
        // is written for the user.
        const reason = axios.isAxiosError(err) ? err.response?.data?.error : null
        toast.error(reason || 'Passkey verification failed. Please try again.', {
          autoClose: 8000,
        })
        // The challenge is single-use: fetch a fresh one for the retry, and
        // keep the button busy until it lands.
        setPasskeyOptions(null)
        loadOptions()
      } else if (axios.isAxiosError(err) && err.response) {
        toast.error(err.response.data?.error || 'Invalid code.', { autoClose: 5000 })
      } else {
        toast.error('Something went wrong. Please try again.', { autoClose: 5000 })
      }
      // Retryable failure — re-arm the form.
      setCode('')
      setPending(false)
      submittedRef.current = false
      inputRef.current?.focus()
    }
  }

  // Auto-submit as soon as 6 digits are in
  useEffect(() => {
    if (method === 'totp' && /^\d{6}$/.test(code) && !submittedRef.current) {
      submittedRef.current = true
      submit({ code })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, method])

  const handlePasskey = async () => {
    if (pending || !passkeyOptions) return
    setPending(true)
    setPrompting(true)
    const prompt = cancellable(() => getPasskeyAssertion(passkeyOptions))
    cancelPromptRef.current = prompt.cancel
    let passkeyCredential: string | null
    try {
      passkeyCredential = await prompt.result
    } catch (e) {
      // The challenge is unused, so the same options serve a retry.
      notifyPasskeyFailure(e, 'Passkey sign-in failed. Please try again.')
      passkeyCredential = null
    } finally {
      cancelPromptRef.current = null
      setPrompting(false)
    }
    // null: failed (reported above) or the user switched method mid-prompt
    if (passkeyCredential === null) {
      setPending(false)
      return
    }
    await submit({ passkeyCredential })
  }

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (submittedRef.current || pending) return
    if (method === 'passkey') {
      handlePasskey()
    } else if (method === 'recovery' && recoveryCode.trim()) {
      submittedRef.current = true
      submit({ recoveryCode: recoveryCode.trim() })
    } else if (method === 'totp' && /^\d{6}$/.test(code)) {
      submittedRef.current = true
      submit({ code })
    }
  }

  const switchTo = (next: Method) => {
    // Never trap the user in a prompt: some password managers don't answer
    // once their window is closed.
    cancelPromptRef.current?.()
    setMethod(next)
    setCode('')
    setRecoveryCode('')
  }

  if (lockedOut)
    return (
      <Alert variant="danger" icon>
        Too many incorrect attempts. Please wait a few minutes and log in again.
      </Alert>
    )

  if (methods === null)
    return (
      <div className="flex justify-center py-6">
        <Spinner size="md" />
      </div>
    )

  // After a failed options load the factors are unknown: offer both codes,
  // and passkeys only once a retry brings a challenge. Locked codes leave
  // the passkey alone.
  const offered = (m: Method) =>
    m === 'passkey'
      ? !loadFailed && methods.includes(m)
      : !codesLocked && (m === 'recovery' || loadFailed || methods.includes(m))

  const actions: Record<Method, ReactNode> = {
    passkey: (
      <>
        <p className="text-xs text-neutral-500 text-center">{FACTOR_METHODS.passkey.hint}</p>
        <Button
          ref={passkeyButtonRef}
          type="button"
          variant="primary"
          icon={GoPasskeyFill}
          isLoading={pending || !passkeyOptions}
          disabled={pending || !passkeyOptions}
          onClick={handlePasskey}
          classString="self-center"
        >
          Use passkey
        </Button>
      </>
    ),
    totp: (
      <>
        <TotpCodeInput ref={inputRef} value={code} onChange={setCode} autoFocus />
        <Button
          type="submit"
          variant="primary"
          icon={FaCheck}
          isLoading={pending}
          disabled={pending}
          classString="self-center"
        >
          Verify
        </Button>
      </>
    ),
    recovery: (
      <>
        <RecoveryCodeInput
          ref={inputRef}
          value={recoveryCode}
          onChange={setRecoveryCode}
          autoFocus
        />
        <Button
          type="submit"
          variant="primary"
          icon={FaCheck}
          isLoading={pending}
          disabled={pending}
          classString="self-center"
        >
          Verify
        </Button>
      </>
    ),
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 w-full">
      {loadFailed && (
        <Alert variant="warning" size="sm" icon>
          <div className="space-y-2">
            <div>Couldn&apos;t load your passkey sign-in. You can still use a code.</div>
            <Button
              type="button"
              variant="outline"
              icon={FaRedo}
              onClick={() => loadOptions()}
              disabled={pending}
            >
              Try again
            </Button>
          </div>
        </Alert>
      )}

      {codesLocked && (
        <Alert variant="warning" size="sm" icon>
          Too many incorrect codes. Use your passkey, or wait 15 minutes to use a code.
        </Alert>
      )}

      <div role="radiogroup" aria-label="Verification method" className="flex flex-col gap-2">
        {FACTOR_METHOD_ORDER.filter(offered).map((m) => {
          const { label, description, icon: Icon } = FACTOR_METHODS[m]
          const selected = m === method
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              // Open while a passkey prompt waits; not while a code is checked.
              disabled={!selected && pending && !prompting}
              onClick={() => !selected && switchTo(m)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg p-3 text-left ring-1 ring-inset transition ease',
                selected
                  ? 'ring-emerald-500/40 bg-emerald-400/5 cursor-default'
                  : 'ring-neutral-500/20 hover:ring-neutral-500/40 cursor-pointer'
              )}
            >
              <span
                className={clsx(
                  'flex size-9 shrink-0 items-center justify-center rounded-md',
                  selected
                    ? 'bg-emerald-400/10 text-emerald-500'
                    : 'bg-zinc-200/60 dark:bg-zinc-800 text-neutral-500'
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {label}
                </span>
                <span className="block text-xs text-neutral-500">{description}</span>
              </span>
              {/* Same marks as the Checkbox component */}
              <span
                className={clsx(
                  'flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ring-inset',
                  selected
                    ? 'bg-emerald-500 ring-emerald-500 dark:bg-emerald-400/20 dark:ring-emerald-400/20'
                    : 'ring-neutral-500/40'
                )}
              >
                {selected && <FaCheck className="text-[8px] text-white dark:text-emerald-400" />}
              </span>
            </button>
          )
        })}
      </div>

      {/* One height for every method: choosing another moves nothing. */}
      <div className="flex min-h-[7rem] flex-col items-center justify-center gap-3">
        {actions[method]}
      </div>
    </form>
  )
}
