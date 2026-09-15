import React, { ReactNode, useEffect, useState } from 'react'
import { FaCopy } from 'react-icons/fa'
import { Button, ButtonVariant } from './Button'

type CopyButtonProps = {
  value: string
  defaultHidden?: boolean
  children?: ReactNode
  buttonVariant?: ButtonVariant
  title?: string
}

const CopyButton: React.FC<CopyButtonProps> = ({ value, children, buttonVariant, title }) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copied = copyState === 'copied'
  const failed = copyState === 'failed'

  const variant = buttonVariant || 'outline'
  const accessibleTitle = title || 'Copy to clipboard'
  const defaultContent = (
    <span className="flex items-center gap-1">
      <FaCopy className="h-4 w-4 transition-colors" />
      <span>Copy</span>
    </span>
  )
  const visibleContent = copied ? (
    <span className="text-emerald-500 dark:text-emerald-400">Copied!</span>
  ) : failed ? (
    <span className="text-red-600 dark:text-red-400">Copy failed</span>
  ) : (
    children || defaultContent
  )

  useEffect(() => {
    if (copyState !== 'idle') {
      const timeout = setTimeout(() => setCopyState('idle'), 1600)
      return () => {
        clearTimeout(timeout)
      }
    }
  }, [copyState])

  return (
    <Button
      type="button"
      variant={variant}
      title={accessibleTitle}
      aria-label={
        copied
          ? `${accessibleTitle}: copied`
          : failed
            ? `${accessibleTitle}: copy failed`
            : accessibleTitle
      }
      onClick={async () => {
        try {
          await window.navigator.clipboard.writeText(value)
          setCopyState('copied')
        } catch {
          setCopyState('failed')
        }
      }}
    >
      {children ? (
        <div className="flex items-center justify-center" aria-hidden="true">
          {visibleContent}
        </div>
      ) : (
        <div className="grid place-items-center" aria-hidden="true">
          <span className="invisible col-start-1 row-start-1">{defaultContent}</span>
          <span className="invisible col-start-1 row-start-1">Copied!</span>
          <span className="col-start-1 row-start-1">{visibleContent}</span>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : failed ? 'Copy failed' : ''}
      </span>
    </Button>
  )
}

export default CopyButton
