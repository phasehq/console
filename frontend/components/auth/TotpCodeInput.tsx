'use client'

import { forwardRef } from 'react'

/**
 * Large-type 6-digit authenticator-code input, shared by the login
 * challenge and the 2FA management dialogs.
 */
const TotpCodeInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (value: string) => void
    autoFocus?: boolean
  }
>(function TotpCodeInput({ value, onChange, autoFocus }, ref) {
  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      placeholder="000000"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      autoFocus={autoFocus}
      autoComplete="one-time-code"
      className="custom w-full max-w-[16rem] mx-auto block text-zinc-900 dark:text-zinc-100 font-mono text-3xl font-semibold bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus:ring-emerald-500 rounded-lg text-center tracking-[0.35em] py-3 placeholder:text-zinc-400/40 dark:placeholder:text-zinc-600/60 ph-no-capture"
    />
  )
})

export default TotpCodeInput
