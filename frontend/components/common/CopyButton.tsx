import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { FaCopy } from 'react-icons/fa'
import { Button } from './Button'

type CopyButtonProps = {
  value: string
  defaultHidden?: boolean
}

const CopyButton: React.FC<CopyButtonProps> = ({ value, defaultHidden }) => {
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
      variant="secondary"
      onClick={() => {
        window.navigator.clipboard.writeText(value).then(() => {
          setCopyCount((count) => count + 1)
        })
      }}
    >
      <div className="relative flex items-center justify-center">
        <span
          aria-hidden={copied}
          className={clsx(
            'pointer-events-none flex items-center gap-0.5 text-zinc-400 transition duration-300',
            copied && '-translate-y-1.5 opacity-0'
          )}
        >
          <FaCopy className="h-4 w-4 transition-colors" />
          Copy
        </span>
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
