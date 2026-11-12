import { Fragment } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { FaHome } from 'react-icons/fa'
import { MdKeyboardReturn } from 'react-icons/md'
import { SyncPathOption } from '@/utils/syncing/paths'
import { PathMenu } from './PathMenu'

const CRUMB =
  'rounded px-1 py-0.5 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'

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
  /** The root and every folder: with any, the root crumb lists them to jump to instead of linking home */
  folders?: SyncPathOption[]
  onNavigate?: (path: string) => void
}) => {
  const segments = path ?? []
  const hasFolders = Boolean(onNavigate) && (folders?.length ?? 0) > 1

  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center text-sm">
      {hasFolders ? (
        <PathMenu
          options={folders!}
          path={segments.length > 0 ? `/${segments.join('/')}` : '/'}
          onNavigate={onNavigate!}
        />
      ) : (
        <Link
          href={buildHref(basePath)}
          title="Root folder"
          className={clsx(CRUMB, 'flex items-center gap-1.5 text-neutral-500')}
        >
          <FaHome className="shrink-0 text-xs" />
          <span>~/</span>
        </Link>
      )}
      {segments.map((segment, index) => {
        const href = `${basePath}/${segments.slice(0, index + 1).join('/')}`
        const isLast = index === segments.length - 1
        return (
          <Fragment key={index}>
            {index > 0 && <span className="px-0.5 text-neutral-500">/</span>}
            <Link
              href={buildHref(href)}
              aria-current={isLast ? 'page' : undefined}
              className={clsx(
                CRUMB,
                isLast ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-neutral-500'
              )}
            >
              {segment}
            </Link>
          </Fragment>
        )
      })}
      {segments.length > 0 && (
        <Link
          href={buildHref(`${basePath}/${segments.slice(0, segments.length - 1).join('/')}`)}
          title="Go up one level"
          className="ml-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-neutral-500 ring-1 ring-inset ring-neutral-500/30 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <MdKeyboardReturn className="shrink-0" />
          <span className="hidden sm:inline">Go Back</span>
        </Link>
      )}
    </nav>
  )
}
