'use client'

import clsx from 'clsx'
import type { IconType } from 'react-icons'
import { GoPasskeyFill } from 'react-icons/go'
import { TbPasswordMobilePhone, TbShieldLock } from 'react-icons/tb'

export type FactorMethod = 'passkey' | 'totp' | 'recovery'

export const FACTOR_METHOD_ORDER: FactorMethod[] = ['passkey', 'totp', 'recovery']

export const FACTOR_METHODS: Record<
  FactorMethod,
  // description: what the method is; hint: what to do now (one line).
  { label: string; description: string; hint: string; icon: IconType }
> = {
  passkey: {
    label: 'Passkey',
    description: "Use a hardware security key, your device's screen lock or a password manager.",
    hint: 'Your browser will ask for one of your passkeys.',
    icon: GoPasskeyFill,
  },
  totp: {
    label: 'Authenticator app',
    description: 'Enter the 6-digit code from your authenticator app.',
    hint: 'Enter the 6-digit code from your authenticator app.',
    icon: TbPasswordMobilePhone,
  },
  recovery: {
    label: 'Recovery code',
    description:
      'Use one of the recovery codes you saved when you set up two-factor authentication.',
    hint: 'Enter one of the recovery codes you saved.',
    icon: TbShieldLock,
  },
}

/** Tabs for choosing which second factor to prove, in the app's dialog tab
 * style. The weight never changes, so switching doesn't nudge the tabs. */
export const FactorMethodTabs = ({
  methods,
  value,
  onChange,
}: {
  methods: FactorMethod[]
  value: FactorMethod
  onChange: (method: FactorMethod) => void
}) => (
  <div
    role="tablist"
    aria-label="Verification method"
    className="flex gap-2 w-full border-b border-neutral-500/20"
  >
    {methods.map((m) => {
      const { label, icon: Icon } = FACTOR_METHODS[m]
      const selected = m === value
      return (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={selected}
          onClick={() => onChange(m)}
          className={clsx(
            '-mb-px flex items-center gap-1.5 p-2 text-xs font-medium border-b focus:outline-none transition ease',
            selected
              ? 'border-emerald-500 text-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
          )}
        >
          <Icon className={clsx('shrink-0 size-3.5', selected && 'text-emerald-500')} />
          {label}
        </button>
      )
    })}
  </div>
)
