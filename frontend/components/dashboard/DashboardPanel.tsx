import clsx from 'clsx'
import Link from 'next/link'
import { ReactNode } from 'react'
import { FaArrowRight } from 'react-icons/fa'

export const DashboardPanel = (props: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  className?: string
  children: ReactNode
}) => {
  const { title, description, actions, footer, className, children } = props

  return (
    <section
      className={clsx(
        'flex min-w-0 flex-col rounded-lg bg-zinc-100 ring-1 ring-inset ring-neutral-500/20 dark:bg-zinc-800/40',
        className
      )}
    >
      <div className="flex flex-col gap-3 px-3 pt-3 sm:flex-row sm:items-start sm:justify-between sm:px-4 sm:pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {description && <p className="text-2xs text-neutral-500">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="min-h-0 flex-1 pt-3">{children}</div>
      {footer && (
        <div className="flex items-center justify-between gap-2 border-t border-neutral-500/20 px-3 py-2 sm:px-4">
          {footer}
        </div>
      )}
    </section>
  )
}

export const PanelLink = (props: { href: string; children: ReactNode }) => (
  <Link
    href={props.href}
    className="group inline-flex items-center gap-1.5 text-2xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300"
  >
    {props.children}
    <FaArrowRight className="text-3xs transition-transform group-hover:translate-x-0.5" />
  </Link>
)

export const PanelSkeleton = (props: { rows?: number }) => (
  <div className="space-y-2 px-3 pb-3 sm:px-4" aria-hidden>
    {Array.from({ length: props.rows ?? 5 }).map((_, i) => (
      <div key={i} className="h-9 animate-pulse rounded-md bg-neutral-500/10" />
    ))}
  </div>
)

export const PanelEmpty = (props: { title: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{props.title}</div>
    {props.children}
  </div>
)
