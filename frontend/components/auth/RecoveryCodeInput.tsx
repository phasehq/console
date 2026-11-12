import { forwardRef } from 'react'

// Single-use recovery code input (xxxxx-xxxxx). Used at sign-in
// (MfaVerifyForm) and in account 2FA management (FactorProof). Styled like
// TotpCodeInput, same 60px height (smaller type, leading-9), wider for 11
// characters.
export const RecoveryCodeInput = forwardRef<
  HTMLInputElement,
  { value: string; onChange: (value: string) => void; autoFocus?: boolean }
>(({ value, onChange, autoFocus }, ref) => (
  <input
    ref={ref}
    type="text"
    maxLength={11}
    placeholder="xxxxx-xxxxx"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    autoComplete="off"
    autoCapitalize="none"
    spellCheck={false}
    autoFocus={autoFocus}
    className="custom w-full max-w-[20rem] mx-auto block text-zinc-900 dark:text-zinc-100 font-mono text-2xl leading-9 font-semibold bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus:ring-emerald-500 rounded-lg text-center tracking-[0.25em] py-3 placeholder:text-zinc-400/40 dark:placeholder:text-zinc-600/60 ph-no-capture"
  />
))

RecoveryCodeInput.displayName = 'RecoveryCodeInput'
