import { ReactNode } from 'react'

export const EmptyState = (props: {
  children: ReactNode
  title: string
  subtitle: ReactNode
  graphic?: ReactNode
}) => {
  const { children, title, subtitle, graphic } = props

  return (
    <div className="p-10 flex flex-col gap-6 items-center justify-center">
      {graphic}
      <div className="text-center">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-lg">{title}</div>
        <div className="text-neutral-500 text-sm">{subtitle}</div>
      </div>
      {children}
    </div>
  )
}
