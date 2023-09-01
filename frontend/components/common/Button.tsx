import Link from 'next/link'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import Spinner from './Spinner'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant: string
  classString?: string
  children: ReactNode
  arrow?: 'left' | 'right'
  isLoading?: boolean
}

interface ComponentProps {
  props: ButtonProps
  className: string
}

function ArrowIcon(props: { className: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m11.5 6.5 3 3.5m0 0-3 3.5m3-3.5h-9"
      />
    </svg>
  )
}

const variantStyles: Record<string, string> = {
  primary:
    'rounded-full bg-zinc-900 py-1 px-3 text-white hover:bg-zinc-700 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300 dark:hover:ring-emerald-300',
  warning:
    'rounded-full bg-amber-700 py-1 px-3 text-white hover:bg-amber-600 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-1 dark:ring-inset dark:ring-amber-400/20 dark:hover:bg-amber-400/10 dark:hover:text-amber-300 dark:hover:ring-amber-300',
  danger:
    'rounded-full bg-red-700 py-1 px-3 text-white hover:bg-red-600 dark:bg-red-400/10 dark:text-red-400 dark:ring-1 dark:ring-inset dark:ring-red-400/20 dark:hover:bg-red-400/10 dark:hover:text-red-300 dark:hover:ring-red-300',
  secondary:
    'rounded-full bg-zinc-100 py-1 px-3 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:ring-1 dark:ring-inset dark:ring-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
  filled:
    'rounded-full bg-zinc-900 py-1 px-3 text-white hover:bg-zinc-700 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-400',
  outline:
    'rounded-full py-1 px-3 text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-900/2.5 hover:text-zinc-900 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-white',
  text: 'text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-500',
}

export function Button(buttonProps: ButtonProps) {
  let { variant, classString, children, arrow, isLoading } = buttonProps
  const Component = 'button'

  const computedClassName = clsx(
    'inline-flex gap-1 justify-center items-center overflow-hidden text-sm font-medium transition-all ease-in-out',
    variantStyles[variant],
    classString,
    (buttonProps.disabled || isLoading) && 'opacity-60 pointer-events-none'
  )

  let arrowIcon = (
    <ArrowIcon
      className={clsx(
        'mt-0.5 h-5 w-5',
        variant === 'text' && 'relative top-px',
        arrow === 'left' && '-ml-1 rotate-180',
        arrow === 'right' && '-mr-1'
      )}
    />
  )

  return (
    <button
      {...buttonProps}
      className={computedClassName}
      disabled={buttonProps.disabled || isLoading}
    >
      {!isLoading && arrow === 'left' && arrowIcon}
      {isLoading && <Spinner size={'sm'} />}
      {children}
      {!isLoading && arrow === 'right' && arrowIcon}
    </button>
  )
}
