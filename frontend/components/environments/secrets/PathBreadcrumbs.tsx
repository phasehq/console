import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FaCheck, FaRegCopy } from 'react-icons/fa'
import { MdKeyboardReturn } from 'react-icons/md'
import { SyncPathOption } from '@/utils/syncing/paths'
import { PathMenu, PathText } from './PathMenu'

const CONTROL =
  'rounded px-1.5 py-1 text-neutral-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'

const CopyPath = ({ path }: { path: string }) => {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timeout)
  }, [copied])

  return (
    <button
      type="button"
      title={copied ? 'Copied' : `Copy ${path}`}
      aria-label={`Copy the path ${path}`}
      onClick={() => {
        // Unavailable outside a secure context: nothing to copy to
        window.navigator.clipboard?.writeText(path).then(() => setCopied(true))
      }}
      className={CONTROL}
    >
      {copied ? (
        <FaCheck className="text-xs text-emerald-500" />
      ) : (
        <FaRegCopy className="text-xs" />
      )}
    </button>
  )
}

/** `basePath` is the route for the root folder; `buildHref` can decorate each link (e.g. to keep query params) */
export const PathBreadcrumbs = ({
  basePath,
  path,
  buildHref = (href) => href,
  folders,
  onNavigate,
}: {
  basePath: string
  path?: string[]
  buildHref?: (href: string) => string
  /** The root and every folder: with any besides the root, the path opens a list of them to jump to */
  folders?: SyncPathOption[]
  onNavigate?: (path: string) => void
}) => {
  const segments = path ?? []
  const current = `/${segments.join('/')}`
  const hasFolders = Boolean(onNavigate) && (folders?.length ?? 0) > 1

  return (
    <nav aria-label="Folder path" className="flex min-w-0 items-center gap-0.5 text-sm">
      {hasFolders ? (
        <PathMenu options={folders!} path={current} onNavigate={onNavigate!} />
      ) : (
        <span className="flex min-w-0 px-1 py-0.5">
          <PathText path={current} />
        </span>
      )}
      {segments.length > 0 && (
        <>
          <CopyPath path={current} />
          <Link
            href={buildHref(`${basePath}/${segments.slice(0, segments.length - 1).join('/')}`)}
            title="Go up one level"
            className="ml-1.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-neutral-500 ring-1 ring-inset ring-neutral-500/30 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <MdKeyboardReturn className="shrink-0" />
            <span className="hidden sm:inline">Go Back</span>
          </Link>
        </>
      )}
    </nav>
  )
}
