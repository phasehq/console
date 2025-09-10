import React, { useRef, useEffect } from 'react'
import clsx from 'clsx'

interface MaskedTextareaProps {
  value?: string
  onChange?: (value: string) => void
  onFocus?: () => void
  isRevealed: boolean
  expanded: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  rowsAutoGrow?: boolean
}

export const MaskedTextarea: React.FC<MaskedTextareaProps> = ({
  value = '',
  onChange,
  onFocus,
  isRevealed,
  expanded,
  placeholder,
  className,
  disabled,
  rowsAutoGrow = true,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const lineCount = value.split('\n').length
  const rows = expanded ? (rowsAutoGrow ? Math.min(Math.max(lineCount, 1), 40) : 1) : 1

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value)
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={onFocus}
      onChange={handleChange}
      rows={rows}
      className={clsx(
        `resize-none overflow-y-hidden focus:outline-none ${className || ''} ${
          rows === 1 ? 'whitespace-nowrap' : ''
        }`,

        isRevealed ? 'text-security-none' : 'text-security-disc',
        disabled && 'opacity-60 cursor-not-allowed'
      )}
    />
  )
}
