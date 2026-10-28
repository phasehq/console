'use client'

import { ThemeContext } from '@/contexts/themeContext'
import { Theme } from '@/utils/theme'
import { useContext } from 'react'
import { RadioGroup } from '@headlessui/react'
import { IconType } from 'react-icons'
import { FaDesktop, FaMoon, FaSun } from 'react-icons/fa6'
import clsx from 'clsx'

export const THEME_OPTIONS: { value: Theme; label: string; icon: IconType }[] = [
  { value: 'light', label: 'Light', icon: FaSun },
  { value: 'system', label: 'System', icon: FaDesktop },
  { value: 'dark', label: 'Dark', icon: FaMoon },
]

export function ModeToggle() {
  const { theme, setTheme } = useContext(ThemeContext)

  return (
    <RadioGroup
      value={theme}
      onChange={setTheme}
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-full bg-neutral-500/10 p-0.5 ring-1 ring-inset ring-neutral-500/20"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <RadioGroup.Option
          key={value}
          value={value}
          aria-label={`${label} theme`}
          title={`${label} theme`}
          className={({ checked }) =>
            clsx(
              'flex size-6 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500',
              checked
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-neutral-700 dark:text-zinc-100'
                : 'text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            )
          }
        >
          <Icon className="size-3" />
        </RadioGroup.Option>
      ))}
    </RadioGroup>
  )
}
