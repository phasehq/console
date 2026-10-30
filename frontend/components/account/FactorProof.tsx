'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { GoPasskeyFill } from 'react-icons/go'
import { BeginPasskeyVerificationOp } from '@/graphql/mutations/account/beginPasskeyVerification.gql'
import { isReauthError } from '@/utils/accountErrors'
import { cancellable, getPasskeyAssertion, notifyPasskeyFailure } from '@/utils/passkeys'
import Spinner from '../common/Spinner'
import TotpCodeInput from '../auth/TotpCodeInput'
import { RecoveryCodeInput } from '../auth/RecoveryCodeInput'
import {
  FACTOR_METHOD_ORDER,
  FACTOR_METHODS,
  FactorMethod,
  FactorMethodTabs,
} from '../auth/FactorMethods'

export type FactorProofMethod = FactorMethod

// Proof of a current second factor, in the shape the 2FA mutations take it.
export type FactorProofPayload = {
  code?: string
  recoveryCode?: string
  passkeyCredential?: string
}

// Passkey challenges live 5 minutes server-side: renew an idle one first.
const OPTIONS_REFRESH_MS = 4 * 60 * 1000

/**
 * State for proving a current factor before a 2FA change. Passkey request
 * options are fetched as soon as the passkey method shows, so the submit
 * click opens the browser prompt directly — Safari only allows it from a
 * user gesture.
 */
export const useFactorProof = ({
  active,
  totp,
  passkey,
}: {
  // The dialog step asking for proof is showing.
  active: boolean
  totp: boolean
  passkey: boolean
}) => {
  const initialMethod: FactorProofMethod = passkey ? 'passkey' : totp ? 'totp' : 'recovery'
  const [method, setMethodState] = useState<FactorProofMethod>(initialMethod)
  const [code, setCode] = useState('')
  const [options, setOptions] = useState<unknown>(null)
  // The challenge is in use (prompt open, or its proof submitted and not yet
  // settled by retry/reset): replacing it would invalidate that proof.
  const busyRef = useRef(false)
  // Cancels the open prompt (browser or password manager), settling it at
  // once.
  const cancelPromptRef = useRef<(() => void) | null>(null)
  const [beginVerification] = useMutation(BeginPasskeyVerificationOp, {
    context: { suppressGlobalErrorToast: true },
  })

  useEffect(() => {
    if (!active || method !== 'passkey' || options) return
    let cancelled = false
    beginVerification()
      .then(({ data }) => {
        if (!cancelled) setOptions(data.beginPasskeyVerification.options)
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : ''
        // The Apollo errorLink redirects on the reauth gate.
        if (!cancelled && !isReauthError(message))
          toast.error(message || 'Could not start passkey verification.', { autoClose: 5000 })
      })
    return () => {
      cancelled = true
    }
  }, [active, method, options, beginVerification])

  useEffect(() => {
    if (!active || method !== 'passkey' || !options) return
    const timer = setTimeout(() => {
      if (!busyRef.current) setOptions(null)
    }, OPTIONS_REFRESH_MS)
    return () => clearTimeout(timer)
  }, [active, method, options])

  // Abort an open prompt (some password managers never answer once their
  // window is closed); its collect() then resolves to null quietly.
  const cancel = () => cancelPromptRef.current?.()

  const setMethod = (next: FactorProofMethod) => {
    cancel()
    setMethodState(next)
    setCode('')
  }

  const reset = useCallback(() => {
    busyRef.current = false
    setMethodState(initialMethod)
    setCode('')
    setOptions(null)
  }, [initialMethod])

  // After the server rejected a proof: codes are re-entered, and a passkey
  // challenge is single-use, so fetch a fresh one. Not done on success — a
  // new challenge racing the request in flight would replace its own.
  const retry = () => {
    busyRef.current = false
    setCode('')
    if (method === 'passkey') setOptions(null)
  }

  const ready =
    method === 'passkey'
      ? options !== null
      : method === 'totp'
        ? /^\d{6}$/.test(code)
        : code.trim() !== ''

  // Resolve the proof at submit; null when the passkey prompt was dismissed
  // or failed (already toasted).
  const collect = async (): Promise<FactorProofPayload | null> => {
    if (method === 'totp') return { code }
    if (method === 'recovery') return { recoveryCode: code.trim() }
    busyRef.current = true
    const prompt = cancellable(() => getPasskeyAssertion(options))
    cancelPromptRef.current = prompt.cancel
    try {
      const passkeyCredential = await prompt.result
      // null: cancelled by a method switch or a closing dialog
      if (passkeyCredential === null) busyRef.current = false
      return passkeyCredential === null ? null : { passkeyCredential }
    } catch (e) {
      // Nothing was signed: the challenge stays usable.
      busyRef.current = false
      notifyPasskeyFailure(e, 'Passkey verification failed. Please try again.')
      return null
    } finally {
      cancelPromptRef.current = null
    }
  }

  return {
    method,
    setMethod,
    code,
    setCode,
    ready,
    collect,
    reset,
    retry,
    cancel,
    available: { totp, passkey },
  }
}

export type FactorProof = ReturnType<typeof useFactorProof>

export const FactorProofFields = ({ proof }: { proof: FactorProof }) => {
  const methods = FACTOR_METHOD_ORDER.filter((m) => m === 'recovery' || proof.available[m])

  return (
    <div className="space-y-4">
      {methods.length > 1 && (
        <FactorMethodTabs methods={methods} value={proof.method} onChange={proof.setMethod} />
      )}
      {/* One height for every method: switching never resizes the dialog. */}
      <div className="flex min-h-[6.25rem] flex-col justify-center gap-2">
        <p className="text-xs text-neutral-500 text-center">{FACTOR_METHODS[proof.method].hint}</p>
        {proof.method === 'passkey' ? (
          // Sized like the code input it stands in for.
          <div className="flex h-[3.75rem] w-full max-w-[16rem] mx-auto items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40">
            {proof.ready ? (
              <GoPasskeyFill className="size-6 text-emerald-500" />
            ) : (
              <Spinner size="sm" />
            )}
          </div>
        ) : proof.method === 'totp' ? (
          <TotpCodeInput value={proof.code} onChange={proof.setCode} autoFocus />
        ) : (
          <RecoveryCodeInput value={proof.code} onChange={proof.setCode} autoFocus />
        )}
      </div>
    </div>
  )
}
