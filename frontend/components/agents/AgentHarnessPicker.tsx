'use client'

import { RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
import { FaCheckCircle } from 'react-icons/fa'
import { AGENT_HARNESS_META } from '@/components/agents/AgentBrandIcons'

/**
 * Visual harness selector for the Create/Edit Agent dialogs: a radio-card
 * grid with each harness's brand mark, replacing the plain select. Values are
 * the lowercase model values (`claude_code`, `codex`, ...).
 */
export function AgentHarnessPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <RadioGroup value={value.toLowerCase()} onChange={onChange}>
      <RadioGroup.Label className="sr-only">Harness</RadioGroup.Label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {AGENT_HARNESS_META.map((harness) => (
          <RadioGroup.Option
            key={harness.value}
            value={harness.value}
            className={({ checked, active }) =>
              clsx(
                'flex cursor-pointer items-center gap-2.5 rounded-xl border p-2 pr-3 transition focus:outline-none',
                checked
                  ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                  : 'border-neutral-500/20 bg-white/50 hover:border-neutral-500/40 hover:bg-white dark:bg-zinc-800/50 dark:hover:bg-zinc-800',
                active && !checked && 'ring-2 ring-emerald-500/30'
              )
            }
          >
            {({ checked }) => (
              <>
                {/* A fixed tile evens out the marks' different shapes */}
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-neutral-500/15 dark:bg-zinc-900 dark:ring-white/10">
                  <harness.Icon aria-hidden="true" className={clsx('size-5', harness.iconClass)} />
                </span>
                <RadioGroup.Label
                  as="span"
                  className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-zinc-900 dark:text-zinc-100"
                >
                  {harness.label}
                </RadioGroup.Label>
                {checked && (
                  <FaCheckCircle aria-hidden="true" className="size-4 shrink-0 text-emerald-500" />
                )}
              </>
            )}
          </RadioGroup.Option>
        ))}
      </div>
    </RadioGroup>
  )
}
