'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { FaArrowRight, FaSearch, FaTimesCircle } from 'react-icons/fa'

export const DashboardPanel = (props: {
  title: ReactNode
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
      <div className="flex flex-col gap-3 px-3 pt-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:px-4 sm:pt-4">
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

/** Small outlined button for panel and section headers. */
export const PANEL_ACTION =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-2xs font-semibold text-zinc-700 ring-1 ring-inset ring-neutral-500/30 transition-colors hover:bg-neutral-500/10 hover:text-zinc-900 data-[open]:bg-neutral-500/10 dark:text-zinc-300 dark:hover:text-zinc-100'

export const PanelLink = (props: { href: string; children: ReactNode }) => (
  <Link
    href={props.href}
    className="group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-2xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300"
  >
    {props.children}
    <FaArrowRight className="text-3xs transition-transform group-hover:translate-x-0.5" />
  </Link>
)

export const PanelSearch = (props: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
}) => {
  const { value, onChange, placeholder, className } = props
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex items-center rounded-md bg-zinc-200 px-2 dark:bg-zinc-800">
      <FaSearch className="shrink-0 text-2xs text-neutral-500" />
      <input
        ref={inputRef}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && value && onChange('')}
        className={clsx('custom bg-transparent text-xs', className)}
      />
      <button
        type="button"
        title="Clear search"
        aria-label="Clear search"
        onClick={() => {
          onChange('')
          inputRef.current?.focus()
        }}
        className={clsx(
          'shrink-0 text-2xs text-neutral-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100',
          !value && 'invisible'
        )}
      >
        <FaTimesCircle />
      </button>
    </div>
  )
}

export const PanelSkeleton = (props: { rows?: number }) => (
  <div className="space-y-2 px-3 pb-3 sm:px-4" aria-hidden>
    {Array.from({ length: props.rows ?? 5 }).map((_, i) => (
      <div key={i} className="h-9 animate-pulse rounded-md bg-neutral-500/10" />
    ))}
  </div>
)

// Scrollbars appearing or disappearing shouldn't count as a new width.
const WIDTH_TOLERANCE = 24

// Keeps the tallest height seen at this width, so filtering doesn't move the page.
export const StableHeight = (props: {
  enabled?: boolean
  /** Start over when this changes, e.g. when the content's layout changes. */
  resetKey?: string
  empty?: ReactNode
  children: ReactNode
}) => {
  const { enabled = true, resetKey, empty, children } = props
  const ref = useRef<HTMLDivElement>(null)
  const lastResetKey = useRef(resetKey)
  const [floor, setFloor] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const reset = lastResetKey.current !== resetKey
    lastResetKey.current = resetKey
    const measure = (width: number, height: number, fresh = false) =>
      setFloor((prev) => {
        if (fresh || Math.abs(width - prev.width) > WIDTH_TOLERANCE) return { width, height }
        return height > prev.height ? { width: prev.width, height } : prev
      })
    const rect = el.getBoundingClientRect()
    measure(rect.width, rect.height, reset)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      measure(entry.contentRect.width, entry.contentRect.height)
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, resetKey])

  return (
    <div
      className="flex flex-col"
      style={enabled && floor.height ? { minHeight: floor.height } : undefined}
    >
      <div ref={ref}>{children}</div>
      {empty && <div className="flex flex-1 flex-col justify-center">{empty}</div>}
    </div>
  )
}
