'use client'

import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { FaCheck } from 'react-icons/fa'
import { Button } from '../common/Button'
import { Alert } from '../common/Alert'
import TotpCodeInput from './TotpCodeInput'
import { RecoveryCodeInput } from './RecoveryCodeInput'
import { UrlUtils } from '@/utils/auth'
import { getCsrfToken, refreshCsrfToken } from '@/apollo/client'

export type TotpVerifySuccess = {
  userId: string
  email: string
  fullName: string
  avatarUrl: string | null
  authMethod: string
  returnTo: string | null
}

export default function TotpVerifyForm({
  onSuccess,
}: {
  onSuccess: (data: TotpVerifySuccess) => void
}) {
  const [code, setCode] = useState('')
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [pending, setPending] = useState(false)
  const [lockedOut, setLockedOut] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)

  const submit = async (
    payload: { code?: string; recoveryCode?: string },
    isRetry = false
  ): Promise<void> => {
    setPending(true)
    try {
      const csrfToken = await getCsrfToken()
      const { data } = await axios.post(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'mfa', 'verify'),
        payload,
        { withCredentials: true, headers: csrfToken ? { 'X-CSRFToken': csrfToken } : {} }
      )
      // Success: leave the button disabled for good — the redirect is in
      // flight, and re-enabling invites a duplicate submit of a code the
      // replay guard has already consumed.
      onSuccess(data)
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        const status = err.response.status
        if (status === 403 && err.response.data?.code === 'csrf_failed' && !isRetry) {
          // Stale token (rotated by a login in another tab) — retry once
          await refreshCsrfToken()
          return submit(payload, true)
        }
        if (status === 429) {
          // Locked out: the form is replaced by an alert — stay disabled.
          setLockedOut(true)
          return
        }
        if (status === 410 || err.response.data?.code === 'no_pending') {
          toast.error('Sign-in expired. Please log in again.', { autoClose: 8000 })
          // Preserve callbackUrl/email so the password flow keeps its deep
          // link; a no-op on /login/mfa (its return_to was server-side).
          // Navigating away — stay disabled.
          window.location.href = '/login' + window.location.search
          return
        }
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
    if (!recoveryMode && /^\d{6}$/.test(code) && !submittedRef.current) {
      submittedRef.current = true
      submit({ code })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, recoveryMode])

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (submittedRef.current || pending) return
    if (recoveryMode && recoveryCode.trim()) {
      submittedRef.current = true
      submit({ recoveryCode: recoveryCode.trim() })
    } else if (/^\d{6}$/.test(code)) {
      submittedRef.current = true
      submit({ code })
    }
  }

  if (lockedOut)
    return (
      <Alert variant="danger" icon>
        Too many incorrect attempts. Please wait a few minutes and log in again.
      </Alert>
    )

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {recoveryMode ? (
        <RecoveryCodeInput
          ref={inputRef}
          value={recoveryCode}
          onChange={setRecoveryCode}
          autoFocus
        />
      ) : (
        <TotpCodeInput ref={inputRef} value={code} onChange={setCode} autoFocus />
      )}

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

      <button
        type="button"
        onClick={() => {
          setRecoveryMode(!recoveryMode)
          setCode('')
          setRecoveryCode('')
        }}
        className="text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition ease"
      >
        {recoveryMode ? 'Use your authenticator app instead' : 'Use a recovery code instead'}
      </button>
    </form>
  )
}
