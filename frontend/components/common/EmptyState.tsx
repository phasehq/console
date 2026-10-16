import clsx from 'clsx'
import { ReactNode } from 'react'

export const EmptyState = (props: {
  children?: ReactNode
  title: string
  subtitle: ReactNode
  graphic?: ReactNode
  icon?: ReactNode
  size?: 'md' | 'sm'
}) => {
  const { children, title, subtitle, graphic, icon, size = 'md' } = props
  const small = size === 'sm'

  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center',
        small ? 'gap-3 px-4 py-8' : 'gap-3 p-4 sm:gap-4 sm:p-6 lg:p-8'
      )}
    >
      {graphic}
      {icon && (
        <div
          className={clsx(
            'text-neutral-300 dark:text-neutral-700',
            small ? 'text-4xl' : 'text-7xl'
          )}
        >
          {icon}
        </div>
      )}
      <div className="text-center">
        <div
          className={clsx(
            'font-semibold text-zinc-900 dark:text-zinc-100',
            small ? 'text-xs' : 'text-base'
          )}
        >
          {title}
        </div>
        <div className={clsx('text-neutral-500', small ? 'text-2xs' : 'text-sm')}>{subtitle}</div>
      </div>
      {children}
    </div>
  )
}
