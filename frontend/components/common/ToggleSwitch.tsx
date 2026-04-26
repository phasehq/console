import { Switch } from '@headlessui/react'

export const ToggleSwitch = (props: {
  value: boolean
  onToggle: () => void
  disabled?: boolean
  asBoolean?: boolean
  theme?: 'emerald' | 'red'
  size?: 'sm' | 'md'
}) => {
  const { value, onToggle, disabled, asBoolean = true, theme = 'emerald', size = 'md' } = props

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
        ? `${size === 'sm' ? 'translate-x-4' : 'translate-x-6'} bg-emerald-500 dark:bg-emerald-400`
        : asBoolean
          ? `${size === 'sm' ? 'translate-x-0.5' : 'translate-x-1'} bg-black`
          : `${size === 'sm' ? 'translate-x-0.5' : 'translate-x-1'} bg-emerald-500 dark:bg-emerald-400`,
    }
  }

  const themeColors = getThemeColors(value)

  const sizeClasses =
    size === 'sm' ? 'h-4 w-8' : 'h-6 w-11'

  const toggleSizeClasses =
    size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'

  return (
    <Switch
      checked={value}
      onChange={onToggle}
      disabled={disabled}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      className={`${themeColors.background} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} relative inline-flex ${sizeClasses} items-center rounded-full ring-1 ring-inset`}
    >
      <span className="sr-only">Active</span>
      <span
        className={`${themeColors.toggle} flex items-center justify-center ${toggleSizeClasses} transform rounded-full transition`}
      ></span>
    </Switch>
  )
}
