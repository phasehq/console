'use client'

import clsx from 'clsx'
import { FaArrowRight, FaTimes } from 'react-icons/fa'
import type { RememberedLogin } from '@/utils/lastLogin'
import { LastUsedBadge } from './LastUsedBadge'
import { loginMethodIcon, loginMethodName } from './providerMeta'

/**
 * Accounts that signed in on this browser, most recent first — one click
 * continues with the method each one used last.
 */
export function RememberedAccountList({
  logins,
  onSelect,
  onForget,
  disabled = false,
}: {
  logins: RememberedLogin[]
  onSelect: (login: RememberedLogin) => void
  onForget: (email: string) => void
  disabled?: boolean
}) {
  return (
    <ul className="flex w-full max-w-sm flex-col gap-3" aria-label="Accounts on this device">
      {logins.map((login, index) => {
        const Icon = loginMethodIcon(login.method)
        const methodName = loginMethodName(login.method)
        const lastUsed = index === 0

        return (
          <li key={login.email} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(login)}
              disabled={disabled}
              title={`Continue with ${methodName}`}
              aria-label={`Continue as ${login.email} with ${methodName}${lastUsed ? ' (last used)' : ''}`}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg py-3 pl-3.5 pr-3 text-left transition ease',
                'bg-zinc-100/70 ring-1 ring-inset ring-neutral-500/20 hover:bg-zinc-100 hover:ring-neutral-500/40',
                'dark:bg-zinc-800/50 dark:hover:bg-zinc-800',
                'focus-visible:outline-none focus-visible:ring-emerald-500',
                'disabled:pointer-events-none disabled:opacity-60'
              )}
            >
              <Icon className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100 ph-no-capture">
                {login.email}
              </span>
              {lastUsed && <LastUsedBadge />}
              <FaArrowRight className="size-3 shrink-0 text-neutral-500 transition-transform group-hover:translate-x-0.5" />
            </button>

            {/* Revealed on hover/focus so the resting list stays clean.
                Left out on touch-only screens, where it would be an
                invisible tap target on every row. */}
            <button
              type="button"
              onClick={() => onForget(login.email)}
              disabled={disabled}
              title="Remove from this device"
              aria-label={`Remove ${login.email} from this device`}
              className={clsx(
                'absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full transition',
                'bg-zinc-200 text-neutral-500 ring-1 ring-inset ring-neutral-500/30 hover:text-zinc-900',
                'dark:bg-zinc-700 dark:hover:text-white',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:hidden',
                'disabled:pointer-events-none'
              )}
            >
              <FaTimes className="size-2.5" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
