import { Switch } from '@headlessui/react'

export const ToggleSwitch = (props: { value: boolean; onToggle: () => void }) => {
  const { value, onToggle } = props

  return (
    <Switch
      id="toggle-sync"
      checked={value}
      onChange={onToggle}
      className={`${
        value ? 'bg-emerald-400/10 ring-emerald-400/20' : 'bg-neutral-500/40 ring-neutral-500/30'
      } relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset`}
    >
      <span className="sr-only">Active</span>
      <span
        className={`${
          value ? 'translate-x-6 bg-emerald-400' : 'translate-x-1 bg-black'
        } flex items-center justify-center h-4 w-4 transform rounded-full transition`}
      ></span>
    </Switch>
  )
}
