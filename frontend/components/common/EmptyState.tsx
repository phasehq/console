import { ReactNode } from 'react'

export const EmptyState = (props: {
  children: ReactNode
  title: string
  subtitle: ReactNode
  graphic?: ReactNode
}) => {
  const { children, title, subtitle, graphic } = props

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col gap-3 sm:gap-4 items-center justify-center">
      {graphic}
      <div className="text-center">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-base">{title}</div>
        <div className="text-neutral-500 text-sm">{subtitle}</div>
      </div>
      {children}
    </div>
  )
}
