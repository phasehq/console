import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { SecretReferenceContext } from '@/contexts/secretReferenceContext'
import {
  ReferenceContext,
  ReferenceSuggestion,
  getActiveReferenceToken,
  computeSuggestions,
  buildInsertionText,
  getSuggestionUrl,
} from '@/utils/secretReferences'

interface UseSecretReferenceAutocompleteOptions {
  value: string
  isRevealed: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  onChange: (newValue: string) => void
  currentSecretKey?: string
}

export function useSecretReferenceAutocomplete({
  value,
  isRevealed,
  textareaRef,
  onChange,
  currentSecretKey,
}: UseSecretReferenceAutocompleteOptions) {
  const context = useContext(SecretReferenceContext)
  const [isOpen, setIsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<ReferenceSuggestion[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const isFocusedRef = useRef(false)

  // Store pending cursor position to set after React renders the new value
  const pendingCursorPos = useRef<number | null>(null)

  // Use a ref for context so the rAF callback always reads the latest
  const contextRef = useRef<ReferenceContext>(context)
  contextRef.current = context

  const updateSuggestions = useCallback(() => {
    if (!isRevealed || !isFocusedRef.current) {
      setIsOpen(false)
      return
    }

    const textarea = textareaRef.current
    if (!textarea) {
      setIsOpen(false)
      return
    }

    const cursorPos = textarea.selectionStart
    const token = getActiveReferenceToken(value, cursorPos)

    if (!token) {
      setIsOpen(false)
      return
    }

    const newSuggestions = computeSuggestions(token, contextRef.current, currentSecretKey)

    if (newSuggestions.length === 0) {
      setIsOpen(false)
      return
    }

    setSuggestions(newSuggestions)
    setActiveIndex(0)
    setIsOpen(true)
  }, [value, isRevealed, textareaRef, currentSecretKey])

  // Re-compute suggestions when context data changes (e.g., orgApps loads asynchronously)
  useEffect(() => {
    if (isOpen) {
      updateSuggestions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context])

  const acceptSuggestion = useCallback(
    (index: number) => {
      const suggestion = suggestions[index]
      if (!suggestion) return

      const textarea = textareaRef.current
      if (!textarea) return

      const cursorPos = textarea.selectionStart
      const token = getActiveReferenceToken(value, cursorPos)
      if (!token) return

      const { newValue, newCursorPos } = buildInsertionText(suggestion, token, value)
      onChange(newValue)
      pendingCursorPos.current = newCursorPos

      // If the suggestion doesn't close the reference, keep dropdown open
      // after a tick so the new value/cursor are reflected
      if (!suggestion.closesReference) {
        // Suggestions will be recalculated via the effect below
      } else {
        setIsOpen(false)
      }
    },
    [suggestions, textareaRef, value, onChange]
  )

  // Set cursor position after value updates
  useEffect(() => {
    if (pendingCursorPos.current !== null) {
      const pos = pendingCursorPos.current
      pendingCursorPos.current = null

      requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.selectionStart = pos
          textarea.selectionEnd = pos
          textarea.focus()
        }
      })
    }
  }, [value, textareaRef])

  const navigateToSuggestion = useCallback(
    (index: number) => {
      const suggestion = suggestions[index]
      if (!suggestion) return

      const textarea = textareaRef.current
      if (!textarea) return

      const cursorPos = textarea.selectionStart
      const token = getActiveReferenceToken(value, cursorPos)
      if (!token) return

      const url = getSuggestionUrl(suggestion, token, contextRef.current)
      if (url) {
        window.open(url, '_blank')
      }
    },
    [suggestions, textareaRef, value]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((prev) => (prev + 1) % suggestions.length)
          break

        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length)
          break

        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            navigateToSuggestion(activeIndex)
          } else {
            acceptSuggestion(activeIndex)
          }
          break

        case 'Escape':
          setIsOpen(false)
          break
      }
    },
    [isOpen, suggestions.length, activeIndex, acceptSuggestion, navigateToSuggestion]
  )

  // Called when cursor position changes (click, arrow keys when dropdown is closed)
  const handleSelect = useCallback(() => {
    updateSuggestions()
  }, [updateSuggestions])

  // Called after value changes
  const handleChange = useCallback(() => {
    // Use a microtask to let the DOM update first
    requestAnimationFrame(() => {
      updateSuggestions()
    })
  }, [updateSuggestions])

  const handleBlur = useCallback(() => {
    isFocusedRef.current = false
    setIsOpen(false)
  }, [])

  const handleFocus = useCallback(() => {
    isFocusedRef.current = true
    // Re-evaluate suggestions when textarea regains focus
    requestAnimationFrame(() => {
      updateSuggestions()
    })
  }, [updateSuggestions])

  const close = useCallback(() => {
    setIsOpen(false)
  }, [])

  return {
    isOpen,
    suggestions,
    activeIndex,
    handleKeyDown,
    handleSelect,
    handleChange,
    handleBlur,
    handleFocus,
    acceptSuggestion,
    navigateToSuggestion,
    close,
  }
}
