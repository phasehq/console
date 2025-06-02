import clsx from 'clsx'
import { ReactNode } from 'react'
import { FaCheck, FaExclamationTriangle, FaInfoCircle } from 'react-icons/fa'

export const Alert = (props: {
  children: ReactNode
  variant: 'success' | 'warning' | 'info' | 'danger'
  icon?: boolean
  size?: 'sm' | 'md'
}) => {
  const variantStyles = {
    success: 'bg-emerald-200/60 dark:bg-emerald-400/10 ring-emerald-500 text-emerald-500',
    warning:
      'bg-amber-300/40 dark:bg-amber-400/10 ring-amber-500/40 text-black dark:text-amber-400',
    info: 'bg-cyan-300/40 dark:bg-cyan-800/30 ring-cyan-400/10 text-black dark:text-cyan-400',
    danger: 'bg-red-300/40 dark:bg-red-400/10 ring-red-500/40 text-black dark:text-red-400',
  }

  const sizeStyles = {
    sm: 'px-2 py-1 text-sm gap-2',
    md: 'p-4 text-base gap-4',
  }

  const variantIcons = {
    success: <FaCheck className="shrink-0" />,
    warning: <FaExclamationTriangle className="shrink-0" />,
    danger: <FaExclamationTriangle className="shrink-0" />,
    info: <FaInfoCircle className="shrink-0" />,
  }

  return (
    <div
      className={clsx(
        'rounded-lg ring-1 ring-inset p-4 flex items-center gap-4',
        variantStyles[props.variant],
        props.size ? sizeStyles[props.size] : sizeStyles['md']
      )}
    >
      {props.icon && variantIcons[props.variant]}
      {props.children}
    </div>
  )
}
