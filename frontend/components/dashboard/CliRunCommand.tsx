import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { FaCopy } from 'react-icons/fa'

function CopyButton(props: { code: string }) {
  const { code } = props

  const [copyCount, setCopyCount] = useState(0)
  const copied = copyCount > 0

  useEffect(() => {
    if (copyCount > 0) {
      const timeout = setTimeout(() => setCopyCount(0), 1000)
      return () => {
        clearTimeout(timeout)
      }
    }
    return undefined
  }, [copyCount])

  return (
    <button
      type="button"
      className={clsx(
        'absolute right-4 top-3.5 overflow-hidden rounded-full py-1 pl-2 pr-3 text-2xs font-medium opacity-0 backdrop-blur transition focus:opacity-100 group-hover:opacity-100',
        copied
          ? 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20'
          : 'bg-zinc-800 dark:hover:bg-zinc-700'
      )}
      onClick={() => {
        window.navigator.clipboard.writeText(code).then(() => {
          setCopyCount((count) => count + 1)
        })
      }}
    >
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
    </button>
  )
}

export const CliRunCommand = () => {
  const command = 'phase run'

  return (
    <div className="group relative overflow-x-auto rounded-lg border border-neutral-500/40 bg-zinc-900/50 p-4 text-left text-sm text-zinc-100">
      <pre>
        <span className="text-violet-300">phase</span> run <span className="text-[#FF8700]">{"YOUR_APPLICATION_START_COMMAND"}</span>
      </pre>
      <CopyButton code={command} />
    </div>
  )
}
