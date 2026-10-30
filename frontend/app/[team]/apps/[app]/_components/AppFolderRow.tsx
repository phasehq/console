'use client'
import { memo } from 'react'
import clsx from 'clsx'
import {
  FaArrowRight,
  FaChevronRight,
  FaFolder,
  FaFolderOpen,
  FaKey,
  FaPlus,
  FaTrashAlt,
} from 'react-icons/fa'
import { FaCircle } from 'react-icons/fa6'
import Link from 'next/link'
import { EnvironmentType } from '@/apollo/graphql'
import { AppFolder } from '../types'
import { MissingCell } from './MissingCell'
import {
  GRID_CELL_BASE,
  GRID_KEY_CELL,
  GRID_ROW_BG,
  GRID_TRAILING_CELL,
  NEW_ENV_CELL,
  GridColumn,
} from './gridColumns'
import { envColor } from '@/utils/environment'

const HOVER_BG = 'group-hover:bg-zinc-50 dark:group-hover:bg-zinc-700/80'

type AppFolderRowProps = {
  appFolder: AppFolder
  /** `<path>/<name>`: the path its contents live at */
  fullPath: string
  depth: number
  expanded: boolean
  onToggle: (fullPath: string) => void
  /** In-app link that opens the folder as the grid's root, carrying the env selection */
  href: string
  columns: GridColumn[]
  showEnv: (envId: string) => void
  /** Creates the folder in an env that's missing it; absent without permission */
  addFolderIn?: (folder: AppFolder, env: EnvironmentType) => void
  /** Adds a new secret inside the folder; absent without permission */
  addSecretIn?: (fullPath: string) => void
  /** Asks to delete the folder across envs; absent without permission */
  deleteFolder?: (folder: AppFolder, fullPath: string) => void
}

/**
 * A folder in the secrets tree. Clicking it expands its subfolders and secrets
 * in place; the arrow opens it as the grid's root instead. Each env column
 * shows that env's counts, or offers to create the folder where it's missing.
 */
const AppFolderRowBase = ({
  appFolder,
  fullPath,
  depth,
  expanded,
  onToggle,
  href,
  columns,
  showEnv,
  addFolderIn,
  addSecretIn,
  deleteFolder,
}: AppFolderRowProps) => {
  const folderByEnv = new Map(appFolder.envs.map((entry) => [entry.env.id!, entry.folder]))
  const toggle = () => onToggle(fullPath)

  return (
    <tr className={clsx('group transition ease', GRID_ROW_BG, 'hover:bg-zinc-50 dark:hover:bg-zinc-700/80')}>
      <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, GRID_ROW_BG, HOVER_BG)}>
        <div className="group/folder relative flex h-full items-center px-2 py-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            title={expanded ? `Collapse ${appFolder.name}` : `Expand ${appFolder.name}`}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-2xs font-medium text-zinc-800 ph-no-capture dark:text-zinc-300 2xl:text-xs"
            style={depth ? { paddingLeft: `${depth}rem` } : undefined}
          >
            <FaChevronRight
              className={clsx(
                'shrink-0 text-[9px] text-neutral-500 transition-transform ease',
                expanded && 'rotate-90'
              )}
            />
            {expanded ? (
              <FaFolderOpen className="shrink-0 text-amber-500" />
            ) : (
              <FaFolder className="shrink-0 text-amber-500" />
            )}
            <span className="truncate">{appFolder.name}</span>
          </button>

          {/* Overlays the end of the name rather than taking room from it */}
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-zinc-200 p-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100 dark:bg-zinc-700">
            {addSecretIn && (
              <button
                type="button"
                onClick={() => addSecretIn(fullPath)}
                title={`New secret in ${appFolder.name}`}
                className="rounded p-1 text-neutral-500 hover:bg-zinc-300 hover:text-zinc-900 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
              >
                <FaPlus className="text-[9px]" />
              </button>
            )}
            <Link
              href={href}
              title={`Open ${appFolder.name}`}
              className="rounded p-1 text-neutral-500 hover:bg-zinc-300 hover:text-zinc-900 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
            >
              <FaArrowRight className="text-[9px]" />
            </Link>
            {deleteFolder && (
              <button
                type="button"
                onClick={() => deleteFolder(appFolder, fullPath)}
                title={`Delete ${appFolder.name}`}
                className="rounded p-1 text-neutral-500 hover:bg-red-400/20 hover:text-red-600 dark:hover:text-red-400"
              >
                <FaTrashAlt className="text-[9px]" />
              </button>
            )}
          </div>
        </div>
      </td>

      {columns.map((column) => {
        const { env } = column
        const folder = folderByEnv.get(env.id) ?? null

        if (!column.checked) {
          return (
            <td key={env.id} className={clsx(GRID_CELL_BASE, 'text-center align-middle')}>
              <button
                type="button"
                onClick={() => showEnv(env.id)}
                title={`${folder ? 'In' : 'Missing in'} ${env.name} — click to show ${env.name}`}
                className="flex h-full min-h-8 w-full items-center justify-center"
              >
                {folder ? (
                  <FaCircle className="text-[7px]" style={{ color: envColor(env) }} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full ring-1 ring-inset ring-neutral-500/60" />
                )}
              </button>
            </td>
          )
        }

        if (!folder) {
          return (
            <td key={env.id} className={GRID_CELL_BASE}>
              <MissingCell
                actionLabel="Add folder"
                onAction={addFolderIn ? () => addFolderIn(appFolder, env) : undefined}
                title={`${appFolder.name} is missing in ${env.name}`}
              />
            </td>
          )
        }

        return (
          <td key={env.id} className={clsx(GRID_CELL_BASE, 'text-center')}>
            <button
              type="button"
              onClick={toggle}
              title={expanded ? `Collapse ${appFolder.name}` : `Expand ${appFolder.name}`}
              className="flex h-full w-full items-center justify-center gap-3 px-3 py-1.5 text-3xs text-neutral-500"
            >
              <span
                className="flex items-center gap-1"
                title={`${folder.folderCount} folder${folder.folderCount === 1 ? '' : 's'}`}
              >
                <FaFolder className="shrink-0 text-[9px]" /> {folder.folderCount}
              </span>
              <span
                className="flex items-center gap-1"
                title={`${folder.secretCount} secret${folder.secretCount === 1 ? '' : 's'}`}
              >
                <FaKey className="shrink-0 text-[9px]" /> {folder.secretCount}
              </span>
            </button>
          </td>
        )
      })}

      <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, GRID_ROW_BG, HOVER_BG)} {...NEW_ENV_CELL} />
    </tr>
  )
}

const areAppFolderRowsEqual = (prev: AppFolderRowProps, next: AppFolderRowProps) => {
  if (
    prev.fullPath !== next.fullPath ||
    prev.depth !== next.depth ||
    prev.expanded !== next.expanded ||
    prev.onToggle !== next.onToggle ||
    prev.href !== next.href ||
    prev.columns !== next.columns ||
    prev.showEnv !== next.showEnv ||
    prev.addFolderIn !== next.addFolderIn ||
    prev.addSecretIn !== next.addSecretIn ||
    prev.deleteFolder !== next.deleteFolder
  )
    return false
  const pe = prev.appFolder.envs
  const ne = next.appFolder.envs
  if (pe.length !== ne.length) return false
  for (let i = 0; i < pe.length; i++) {
    if (pe[i].env.id !== ne[i].env.id) return false
    const pF = pe[i].folder
    const nF = ne[i].folder
    if ((pF === null) !== (nF === null)) return false
    if (pF && nF) {
      if (pF.secretCount !== nF.secretCount || pF.folderCount !== nF.folderCount) return false
    }
  }
  return true
}

export const AppFolderRow = memo(AppFolderRowBase, areAppFolderRowsEqual)
