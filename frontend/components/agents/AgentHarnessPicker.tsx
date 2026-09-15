'use client'

import { RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
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
                'flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 transition focus:outline-none',
                checked
                  ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                  : 'border-neutral-500/20 bg-zinc-100 hover:border-neutral-500/40 dark:bg-zinc-800',
                active && !checked && 'ring-1 ring-neutral-500/40'
              )
            }
          >
            <harness.Icon aria-hidden="true" className={clsx('size-6', harness.iconClass)} />
            <RadioGroup.Label
              as="span"
              className="text-xs font-medium text-zinc-800 dark:text-zinc-200"
            >
              {harness.label}
            </RadioGroup.Label>
          </RadioGroup.Option>
        ))}
      </div>
    </RadioGroup>
  )
}
