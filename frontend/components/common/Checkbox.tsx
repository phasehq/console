import clsx from 'clsx'
import { FaCheck, FaMinus } from 'react-icons/fa'

const sizeStyles = {
  sm: { box: 'h-4 w-4', icon: 'text-[8px]', offset: 'mt-[3px]' },
  md: { box: 'h-5 w-5', icon: 'text-[10px]', offset: 'mt-px' },
  lg: { box: 'h-6 w-6', icon: 'text-xs', offset: '' },
}

export const Checkbox = (props: {
  checked: boolean
  /** Some of what it stands for is checked: shown as a dash, and a click checks all of it */
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  label?: string
  /** Names the checkbox for assistive tech when it has no visible label */
  'aria-label'?: string
  title?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
}) => {
  const { checked, indeterminate = false, onChange, label, disabled, size = 'md' } = props
  const styles = sizeStyles[size]
  const mixed = indeterminate && !checked

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={props['aria-label']}
      title={props.title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={clsx('flex gap-3 group', label ? 'items-start' : 'items-center', disabled && 'opacity-50 cursor-not-allowed')}
    >
      <div
        className={clsx(
          'flex items-center justify-center shrink-0 rounded-full ring-1 ring-inset transition ease',
          styles.box,
          label && styles.offset,
          checked || mixed
            ? 'bg-emerald-500 ring-emerald-500 dark:bg-emerald-400/20 dark:ring-emerald-400/20'
            : 'bg-zinc-100 dark:bg-zinc-800 ring-neutral-500/40 group-hover:ring-neutral-500/60'
        )}
      >
        {checked && <FaCheck className={clsx('text-white dark:text-emerald-400', styles.icon)} />}
        {mixed && <FaMinus className={clsx('text-white dark:text-emerald-400', styles.icon)} />}
      </div>
      {label && <span className="text-xs text-neutral-500 text-left select-none">{label}</span>}
    </button>
  )
}
