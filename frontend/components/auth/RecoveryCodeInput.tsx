import { forwardRef } from 'react'

// Single-use recovery code input (xxxxx-xxxxx). Used at sign-in
// (TotpVerifyForm) and in account 2FA management (TwoFactorSection).
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
    autoFocus={autoFocus}
    className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md text-center tracking-widest ph-no-capture"
  />
))

RecoveryCodeInput.displayName = 'RecoveryCodeInput'
