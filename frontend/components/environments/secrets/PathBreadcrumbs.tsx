import Link from 'next/link'
import clsx from 'clsx'
import { FaHome } from 'react-icons/fa'
import { MdKeyboardReturn } from 'react-icons/md'
import { Button } from '@/components/common/Button'

/**
 * Folder path breadcrumbs shared by the single-env and cross-env secret
 * editors. `basePath` is the route prefix that represents the root path "/"
 * for the current view; `path` is the list of folder segments after it.
 */
export const PathBreadcrumbs = ({ basePath, path }: { basePath: string; path?: string[] }) => {
  if (!path || path.length === 0) {
    return (
      <div className="flex flex-wrap">
        <Link href={basePath} className="p-2 flex items-center gap-2 font-light">
          <FaHome className="group-hover:text-white" />
          <span className="text-xl text-neutral-500 ">~/</span>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center">
      <Link
        href={basePath}
        className="p-2 flex items-center gap-2 font-light text-neutral-500 group"
      >
        <FaHome className="group-hover:text-white" />
        <span className="text-xl group-hover:text-white">~/</span>
      </Link>
      {path.map((segment, index) => {
        const href = `${basePath}/${path.slice(0, index + 1).join('/')}`

        return (
          <div
            key={index}
            className={clsx(
              'flex items-center gap-1',
              index === path.length - 1 ? 'font-semibold' : 'font-light'
            )}
          >
            <Link href={href}>
              <span className="px-1 py-0.5 text-black dark:text-white hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-md">
                {segment}
              </span>
            </Link>
            {index < path.length - 1 && <span className="text-neutral-500 p-1">/</span>}
          </div>
        )
      })}
      <div className="px-4">
        <Link
          href={`${basePath}/${path.slice(0, path.length - 1).join('/')}`}
          title="Go up one level"
        >
          <Button variant="secondary">
            <MdKeyboardReturn className="shrink-0" />
            <span className="ml-2">Go Back</span>
          </Button>
        </Link>
      </div>
    </div>
  )
}
