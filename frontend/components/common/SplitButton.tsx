import Link from 'next/link'
import clsx from 'clsx'
import { Fragment, type ReactNode } from 'react'
import Spinner from './Spinner'
import { FaChevronDown } from 'react-icons/fa'
import { Menu, Transition, _internal_ComponentMenuItem } from '@headlessui/react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant: string
  classString?: string
  children: ReactNode
  arrow?: 'left' | 'right'
  isLoading?: boolean
  menuContent: ReactNode
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
    'bg-zinc-900 py-1 px-3 text-white hover:bg-zinc-700 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300 dark:hover:ring-emerald-300',
  warning:
    'bg-amber-700 py-1 px-3 text-white hover:bg-amber-600 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-1 dark:ring-inset dark:ring-amber-400/20 dark:hover:bg-amber-400/10 dark:hover:text-amber-300 dark:hover:ring-amber-300',
  danger:
    'bg-red-700 py-1 px-3 text-white hover:bg-red-600 dark:bg-red-400/10 dark:text-red-400 dark:ring-1 dark:ring-inset dark:ring-red-400/20 dark:hover:bg-red-400/10 dark:hover:text-red-300 dark:hover:ring-red-300',
  secondary:
    'bg-zinc-100 py-1 px-3 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800/40 dark:text-zinc-400 dark:ring-1 dark:ring-inset dark:ring-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-300',
  filled:
    'bg-zinc-900 py-1 px-3 text-white hover:bg-zinc-700 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-400',
  outline:
    'py-1 px-3 text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-900/2.5 hover:text-zinc-900 dark:text-zinc-400 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-white',
  text: 'text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-500',
}

export function SplitButton(buttonProps: ButtonProps) {
  let { variant, classString, children, arrow, isLoading, menuContent } = buttonProps
  const Component = 'button'

  const computedLeftButtonClassName = clsx(
    'inline-flex gap-1 justify-center items-center overflow-hidden text-sm font-medium transition-all ease-in-out rounded-l-full',
    variantStyles[variant],
    classString,
    (buttonProps.disabled || isLoading) && 'opacity-60 cursor-not-allowed'
  )

  const computedRightButtonClassName = clsx(
    'inline-flex gap-1 justify-center items-center overflow-hidden text-sm font-medium transition-all ease-in-out rounded-r-full',
    variantStyles[variant],
    classString,
    (buttonProps.disabled || isLoading) && 'opacity-60 cursor-not-allowed'
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

  const spinnerColor = variant === 'danger' ? 'red' : 'emerald'

  return (
    <div className="flex">
      <button
        {...buttonProps}
        className={computedLeftButtonClassName}
        disabled={buttonProps.disabled || isLoading}
      >
        {!isLoading && arrow === 'left' && arrowIcon}
        {isLoading && <Spinner size={'sm'} color={spinnerColor} />}
        {children}
        {!isLoading && arrow === 'right' && arrowIcon}
      </button>
      <Menu as="div" className="flex relative">
        {({ open }) => (
          <>
            <Menu.Button as={Fragment}>
              <button
                className={computedRightButtonClassName}
                disabled={buttonProps.disabled || isLoading}
              >
                <FaChevronDown />
              </button>
            </Menu.Button>
            <Transition
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
              as="div"
              className="absolute z-20 right-0 origin-bottom-right top-10"
            >
              <Menu.Items as={Fragment}>
                <div className="p-2 ring-1 ring-inset ring-neutral-500/40 bg-zinc-200 dark:bg-zinc-800 rounded-md z-20 shadow-xl">
                  {menuContent}
                </div>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    </div>
  )
}
