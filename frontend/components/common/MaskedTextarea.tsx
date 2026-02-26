import React, { useCallback, useRef, forwardRef } from 'react'
import clsx from 'clsx'

interface MaskedTextareaProps {
  value?: string
  onChange?: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSelect?: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void
  isRevealed: boolean
  expanded: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  rowsAutoGrow?: boolean
  highlightContent?: React.ReactNode
}

export const MaskedTextarea = forwardRef<HTMLTextAreaElement, MaskedTextareaProps>(
  (
    {
      value = '',
      onChange,
      onFocus,
      onBlur,
      onKeyDown,
      onSelect,
      isRevealed,
      expanded,
      placeholder,
      className,
      disabled,
      rowsAutoGrow = true,
      highlightContent,
    },
    ref
  ) => {
    const highlightRef = useRef<HTMLDivElement>(null)
    const lineCount = value.split('\n').length
    const rows = expanded ? (rowsAutoGrow ? Math.min(Math.max(lineCount, 1), 40) : 1) : 1
    const hasHighlight = isRevealed && highlightContent != null

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange?.(e.target.value)
      },
      [onChange]
    )

    const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
      if (highlightRef.current) {
        highlightRef.current.scrollTop = e.currentTarget.scrollTop
        highlightRef.current.scrollLeft = e.currentTarget.scrollLeft
      }
    }, [])

    const sharedClasses = clsx(
      className,
      'resize-none',
      rows === 1 ? 'whitespace-nowrap' : 'whitespace-pre-wrap break-all'
    )

    const textarea = (
      <textarea
        ref={ref}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onSelect={onSelect}
        onChange={handleChange}
        onScroll={hasHighlight ? handleScroll : undefined}
        rows={rows}
        className={clsx(
          sharedClasses,
          'overflow-auto scrollbar-hide focus:outline-none',
          isRevealed ? 'text-security-none' : 'text-security-disc',
          disabled && 'opacity-60 cursor-not-allowed',
          hasHighlight && '!text-transparent caret-zinc-900 dark:caret-zinc-100 !bg-transparent relative'
        )}
      />
    )

    return (
      <div className="relative w-full flex-1">
        {hasHighlight && (
          <div
            ref={highlightRef}
            aria-hidden="true"
            className={clsx(
              sharedClasses,
              'absolute inset-0 pointer-events-none overflow-hidden'
            )}
          >
            {highlightContent}
          </div>
        )}
        {textarea}
      </div>
    )
  }
)

MaskedTextarea.displayName = 'MaskedTextarea'
