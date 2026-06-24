import { ApiSecretTypeChoices } from '@/apollo/graphql'
import clsx from 'clsx'
import { FaKey, FaLock, FaCog } from 'react-icons/fa'
import { useRef, useEffect, useState } from 'react'

const SECRET_TYPES = [
  { value: ApiSecretTypeChoices.Config, label: 'Config', icon: FaCog },
  { value: ApiSecretTypeChoices.Secret, label: 'Secret', icon: FaKey },
  { value: ApiSecretTypeChoices.Sealed, label: 'Sealed', icon: FaLock },
] as const

export const TypeSelector = ({
  currentType,
  onChange,
  disabled,
}: {
  currentType: ApiSecretTypeChoices
  onChange: (type: ApiSecretTypeChoices) => void
  disabled?: boolean
}) => {
  const isLocked = currentType === ApiSecretTypeChoices.Sealed && disabled
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  useEffect(() => {
    const activeIndex = SECRET_TYPES.findIndex((t) => t.value === currentType)
    const btn = buttonRefs.current[activeIndex]
    const container = containerRef.current
    if (btn && container) {
      const containerRect = container.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      setIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      })
    }
  }, [currentType])

  const activeBgColor =
    currentType === ApiSecretTypeChoices.Sealed
      ? 'bg-red-500/20'
      : currentType === ApiSecretTypeChoices.Config
        ? 'bg-blue-500/20'
        : 'bg-zinc-300 dark:bg-zinc-600'

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 p-0.5 font-sans"
    >
      {indicator && (
        <div
          className={clsx('absolute rounded-full transition-all duration-200 ease-in-out', activeBgColor)}
          style={{
            left: indicator.left,
            width: indicator.width,
            top: 2,
            bottom: 2,
          }}
        />
      )}
      {SECRET_TYPES.map(({ value, label, icon: Icon }, index) => {
        const isActive = currentType === value
        const isDisabled = disabled || (isLocked && value !== ApiSecretTypeChoices.Sealed)

        return (
          <button
            key={value}
            ref={(el) => { buttonRefs.current[index] = el }}
            type="button"
            disabled={isDisabled}
            onClick={() => !isDisabled && onChange(value)}
            title={
              isLocked && value !== ApiSecretTypeChoices.Sealed
                ? 'Sealed secrets cannot be unsealed'
                : `Change secret type to ${label}`
            }
            className={clsx(
              'relative z-[1] flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium transition-colors duration-200',
              isActive
                ? value === ApiSecretTypeChoices.Sealed
                  ? 'text-red-600 dark:text-red-400'
                  : value === ApiSecretTypeChoices.Config
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-zinc-800 dark:text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300',
              isDisabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Icon className="text-3xs" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
