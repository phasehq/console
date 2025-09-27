import { Switch } from '@headlessui/react'

export const ToggleSwitch = (props: {
  value: boolean
  onToggle: () => void
  disabled?: boolean
  asBoolean?: boolean
  theme?: 'emerald' | 'red'
}) => {
  const { value, onToggle, disabled, asBoolean = true, theme = 'emerald' } = props

  const getThemeColors = (isActive: boolean) => {
    if (theme === 'red') {
      return {
        background: isActive
          ? 'bg-red-400/20 dark:bg-red-400/10 ring-red-400/20'
          : asBoolean
            ? 'bg-neutral-500/40 ring-neutral-500/30'
            : 'bg-red-400/20 dark:bg-red-400/10 ring-red-400/20',
        toggle: isActive
          ? 'translate-x-6 bg-red-500 dark:bg-red-400'
          : asBoolean
            ? 'translate-x-1 bg-black'
            : 'translate-x-1 bg-red-500 dark:bg-red-400',
      }
    }

    // Default emerald theme
    return {
      background: isActive
        ? 'bg-emerald-400/20 dark:bg-emerald-400/10 ring-emerald-400/20'
        : asBoolean
          ? 'bg-neutral-500/40 ring-neutral-500/30'
          : 'bg-emerald-400/20 dark:bg-emerald-400/10 ring-emerald-400/20',
      toggle: isActive
        ? 'translate-x-6 bg-emerald-500 dark:bg-emerald-400'
        : asBoolean
          ? 'translate-x-1 bg-black'
          : 'translate-x-1 bg-emerald-500 dark:bg-emerald-400',
    }
  }

  const themeColors = getThemeColors(value)

  return (
    <Switch
      id="toggle-sync"
      checked={value}
      onChange={onToggle}
      disabled={disabled}
      className={`${themeColors.background} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
    >
      <span className="sr-only">Active</span>
      <span
        className={`${themeColors.toggle} flex items-center justify-center h-4 w-4 transform rounded-full transition`}
      ></span>
    </Switch>
  )
}
