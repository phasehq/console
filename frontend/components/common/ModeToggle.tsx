'use client'

import { ThemeContext } from '@/contexts/themeContext'
import { useContext } from 'react'
import { Switch } from '@headlessui/react'
import { FaMoon, FaSun } from 'react-icons/fa'

export function ModeToggle() {
  const { theme, setTheme } = useContext(ThemeContext)

  const isDark = theme === 'dark'

  const toggleTheme = (checked: boolean) => {
    setTheme(checked ? 'dark' : 'light')
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={isDark}
        onChange={toggleTheme}
        className={`${
          isDark ? 'bg-emerald-400/10 ring-emerald-400/20' : 'bg-neutral-500/40 ring-neutral-500/30'
        } relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
      >
        <span className="sr-only">Enable dark theme</span>
        <span
          className={`${
            isDark ? 'translate-x-6 bg-emerald-400' : 'translate-x-1 bg-black'
          } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
        ></span>
      </Switch>
    </div>
  )
}
