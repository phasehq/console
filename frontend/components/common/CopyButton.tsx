import React, { ReactNode, useEffect, useState } from 'react'
import clsx from 'clsx'
import { FaCopy } from 'react-icons/fa'
import { Button } from './Button'

type CopyButtonProps = {
  value: string
  defaultHidden?: boolean
  children?: ReactNode
}

const CopyButton: React.FC<CopyButtonProps> = ({ value, children }) => {
  const [copyCount, setCopyCount] = useState(0)
  const copied = copyCount > 0

  useEffect(() => {
    if (copyCount > 0) {
      const timeout = setTimeout(() => setCopyCount(0), 1000)
      return () => {
        clearTimeout(timeout)
      }
    }
  }, [copyCount])

  return (
    <Button
      variant="outline"
      title="Copy to clipboard"
      onClick={() => {
        window.navigator.clipboard.writeText(value).then(() => {
          setCopyCount((count) => count + 1)
        })
      }}
    >
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden={copied}
          className={clsx(
            'pointer-events-none  transition duration-300',
            copied && '-translate-y-1.5 opacity-0'
          )}
        >
          {children || (
            <div className="flex items-center gap-0.5">
              <FaCopy className="h-4 w-4 transition-colors" />
              <span>Copy</span>
            </div>
          )}
        </div>
        <span
          aria-hidden={!copied}
          className={clsx(
            'pointer-events-none absolute inset-0 flex items-center justify-center text-emerald-400 transition duration-300',
            !copied && 'translate-y-1.5 opacity-0'
          )}
        >
          Copied!
        </span>
      </div>
    </Button>
  )
}

export default CopyButton
