import clsx from 'clsx'
import { ReactNode } from 'react'

export const Alert = (props: { children: ReactNode; variant: 'success' | 'warning' | 'info' }) => {
  const variants = {
    success: 'bg-emerald-200/60 dark:bg-emerald-400/10 ring-emerald-500 text-emerald-500',
    warning: 'bg-orange-800/20 dark:bg-orange-800/30 ring-orange-500 text-orange-500',
    info: 'bg-sky-800/30 ring-sky-500 text-sky-500',
  }

  return (
    <div className={clsx('rounded-lg ring-1 ring-inset p-4', variants[props.variant])}>
      {props.children}
    </div>
  )
}
