import React, { useRef, useState, useMemo } from 'react'
import clsx from 'clsx'

interface MaskedTextareaProps {
  value?: string
  onChange?: (value: string) => void
  onFocus?: () => void
  onBlur?: () => void
  isRevealed: boolean
  expanded: boolean
  placeholder?: string
  className?: string
  disabled?: boolean
  rowsAutoGrow?: boolean
}

const MIDDLE_DOT = '\u00B7'

export const MaskedTextarea: React.FC<MaskedTextareaProps> = ({
  value = '',
  onChange,
  onFocus,
  onBlur,
  isRevealed,
  expanded,
  placeholder,
  className,
  disabled,
  rowsAutoGrow = true,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const lineCount = value.split('\n').length
  const rows = expanded ? (rowsAutoGrow ? Math.min(Math.max(lineCount, 1), 40) : 1) : 1

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value)
  }

  const handleFocus = () => {
    setIsFocused(true)
    onFocus?.()
  }

  const handleBlur = () => {
    setIsFocused(false)
    onBlur?.()
  }

  const whitespaceInfo = useMemo(() => {
    if (!value || value.length === 0) return null

    const lines = value.split('\n')
    const firstLine = lines[0]
    const lastLine = lines[lines.length - 1]

    const leadingSpaces = firstLine.length - firstLine.trimStart().length
    const trailingSpaces = lastLine.length - lastLine.trimEnd().length

    if (leadingSpaces === 0 && trailingSpaces === 0) return null

    return { leadingSpaces, trailingSpaces, lines }
  }, [value])

  const showOverlay = isRevealed && !isFocused && whitespaceInfo !== null

  const overlayContent = useMemo(() => {
    if (!whitespaceInfo) return null

    const { leadingSpaces, trailingSpaces, lines } = whitespaceInfo
    const isCollapsed = rows === 1

    // Build overlay lines: middle dots for leading/trailing spaces, regular spaces elsewhere
    return lines
      .map((line, i) => {
        // For collapsed view, only show first line
        if (isCollapsed && i > 0) return null

        const chars = line.split('')

        const overlayChars = chars.map((ch, j) => {
          // Leading spaces on first line
          if (i === 0 && j < leadingSpaces && ch === ' ') return MIDDLE_DOT
          // Trailing spaces on last line (or first line if single line)
          if (i === lines.length - 1 && j >= line.length - trailingSpaces && ch === ' ')
            return MIDDLE_DOT
          // Use a regular space to maintain alignment
          return ch === '\t' ? '\t' : ' '
        })

        return overlayChars.join('')
      })
      .filter((line): line is string => line !== null)
  }, [whitespaceInfo, rows])

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        rows={rows}
        className={clsx(
          `resize-none overflow-auto scrollbar-hide focus:outline-none ${className || ''} ${
            rows === 1 ? 'whitespace-nowrap' : ''
          }`,

          isRevealed ? 'text-security-none' : 'text-security-disc',
          disabled && 'opacity-60 cursor-not-allowed'
        )}
      />
      {showOverlay && overlayContent && (
        <div
          aria-hidden
          className={clsx(
            className,
            'absolute inset-0 pointer-events-none overflow-hidden',
            '!bg-transparent !text-zinc-400 dark:!text-zinc-500 !opacity-100',
            rows === 1 ? 'whitespace-nowrap' : 'whitespace-pre-wrap'
          )}
        >
          {overlayContent.join('\n')}
        </div>
      )}
    </div>
  )
}
