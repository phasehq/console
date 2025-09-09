import React, { useState, useRef, useEffect } from 'react'

interface MaskedTextareaProps {
  value?: string
  onChange?: (value: string) => void
  onFocus?: () => void
  isRevealed: boolean
  expanded: boolean
  revealDurationMs?: number // default: 1000ms
  placeholder?: string
  className?: string
  disabled?: boolean
}

export const MaskedTextarea: React.FC<MaskedTextareaProps> = ({
  value = '',
  onChange,
  onFocus,
  isRevealed,
  expanded,
  revealDurationMs = 1000,
  placeholder,
  className,
  disabled,
}) => {
  const [realValue, setRealValue] = useState(value)

  const [lastVisibleIndex, setLastVisibleIndex] = useState<number | null>(null)

  const textAreaRef = useRef(null)
  const revealTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const rows = value.split('\n').length ?? 1

  useEffect(() => {
    setRealValue(value)
  }, [value])

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current)
      }
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value

    if (isRevealed) {
      setRealValue(newValue)
      onChange?.(newValue)
      return
    }

    // Detect newly typed character
    const diffIndex = findDiffIndex(realValue, newValue.replace(/•/g, ''))
    if (diffIndex !== null) {
      setLastVisibleIndex(diffIndex)
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current)
      }
      revealTimeoutRef.current = setTimeout(() => {
        setLastVisibleIndex(null)
      }, revealDurationMs)
    }

    const cleanedValue = newValue.replace(/•/g, '')
    setRealValue(cleanedValue)
    onChange?.(cleanedValue)
  }

  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    e.clipboardData.setData('text/plain', '')
  }

  const maskedValue = () => {
    if (isRevealed) return realValue
    return realValue
      .split('')
      .map((char, idx) => {
        if (char === '\n') return '\n' // keep line breaks intact
        return idx === lastVisibleIndex ? char : '•'
      })
      .join('')
  }

  return (
    <div className="relative w-full flex items-start">
      <textarea
        ref={textAreaRef}
        className={`resize-none overflow-hidden focus:outline-none ${className || ''} ${
          rows === 1 ? 'whitespace-nowrap' : ''
        }`}
        value={maskedValue()}
        onChange={handleChange}
        //onCopy={handleCopy}
        onFocus={onFocus}
        placeholder={placeholder}
        rows={expanded ? rows : 1}
        disabled={disabled}
      />
    </div>
  )
}

// Utility: find index where strings differ
function findDiffIndex(a: string, b: string): number | null {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i
  }
  return null
}
