import clsx from 'clsx'
import { ReactNode } from 'react'

export const Alert = (props: { children: ReactNode; variant: 'success' | 'warning' | 'info' }) => {
  const variants = {
    success: 'bg-emerald-200/60 dark:bg-emerald-400/10 ring-emerald-500 text-emerald-500',
    warning: 'bg-amber-800/20 dark:bg-amber-800/30 ring-amber-500 text-amber-500',
    info: 'bg-cyan-800/30 ring-cyan-400/10 text-cyan-500',
  }

  return (
    <div className={clsx('rounded-lg ring-1 ring-inset p-4', variants[props.variant])}>
      {props.children}
    </div>
  )
}
