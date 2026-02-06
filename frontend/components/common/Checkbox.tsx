import clsx from 'clsx'
import { FaCheck } from 'react-icons/fa'

const sizeStyles = {
  sm: { box: 'h-4 w-4', icon: 'text-[8px]', offset: 'mt-[3px]' },
  md: { box: 'h-5 w-5', icon: 'text-[10px]', offset: 'mt-px' },
  lg: { box: 'h-6 w-6', icon: 'text-xs', offset: '' },
}

export const Checkbox = (props: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
}) => {
  const { checked, onChange, label, disabled, size = 'md' } = props
  const styles = sizeStyles[size]

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx('flex items-start gap-3 group', disabled && 'opacity-50 cursor-not-allowed')}
    >
      <div
        className={clsx(
          'flex items-center justify-center shrink-0 rounded ring-1 ring-inset transition ease',
          styles.box,
          styles.offset,
          checked
            ? 'bg-emerald-600 ring-emerald-600'
            : 'bg-zinc-100 dark:bg-zinc-800 ring-neutral-500/40 group-hover:ring-neutral-500/60'
        )}
      >
        {checked && <FaCheck className={clsx('text-white', styles.icon)} />}
      </div>
      {label && (
        <span className="text-sm text-neutral-500 text-left select-none">{label}</span>
      )}
    </button>
  )
}
