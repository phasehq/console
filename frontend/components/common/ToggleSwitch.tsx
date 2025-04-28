import { Switch } from '@headlessui/react'

export const ToggleSwitch = (props: {
  value: boolean
  onToggle: () => void
  disabled?: boolean
  asBoolean?: boolean
}) => {
  const { value, onToggle, disabled, asBoolean = true } = props

  return (
    <Switch
      id="toggle-sync"
      checked={value}
      onChange={onToggle}
      disabled={disabled}
      className={`${
        value
          ? 'bg-emerald-400/20 dark:bg-emerald-400/10 ring-emerald-400/20'
          : asBoolean
            ? 'bg-neutral-500/40 ring-neutral-500/30'
            : 'bg-emerald-400/20 dark:bg-emerald-400/10 ring-emerald-400/20'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
    >
      <span className="sr-only">Active</span>
      <span
        className={`${
          value
            ? 'translate-x-6 bg-emerald-500 dark:bg-emerald-400'
            : asBoolean
              ? 'translate-x-1 bg-black'
              : 'translate-x-1 bg-emerald-500 dark:bg-emerald-400'
        } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
      ></span>
    </Switch>
  )
}
