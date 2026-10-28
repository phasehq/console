'use client'
import { memo, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { FaFolder, FaKey } from 'react-icons/fa'
import Link from 'next/link'
import { AppFolder } from '../types'
import { STATUS_CELL_STYLES, STATUS_CELL_HOVER_STYLES } from './SecretInfoLegend'
import { SecretFolderType, EnvironmentType } from '@/apollo/graphql'

type AppFolderRowProps = {
  appFolder: AppFolder
  /** Route prefix for the app (`/[team]/apps/[app]`) */
  basePath: string
  /** Current folder path suffix (`''` at root, `/backend` inside a folder) */
  pathSuffix: string
  /** Env column order shared with the table headers (includes any optimistic
   *  reorder) */
  envOrder: string[]
}

/**
 * A folder row in the cross-env table. Clicking it navigates deeper into the
 * folder within the cross-env view; the env columns show whether the folder
 * exists in each environment.
 */
const AppFolderRowBase = ({ appFolder, basePath, pathSuffix, envOrder }: AppFolderRowProps) => {
  const router = useRouter()

  // Key column stays in the cross-env editor; env cells open the folder in that env
  const href = `${basePath}${pathSuffix}/${appFolder.name}`
  const envHref = (envId: string) => `${basePath}/environments/${envId}${pathSuffix}/${appFolder.name}`

  const orderedEnvs = useMemo(() => {
    const pos = new Map(envOrder.map((id, i) => [id, i]))
    return [...appFolder.envs].sort(
      (a, b) =>
        (pos.get(a.env.id!) ?? Number.MAX_SAFE_INTEGER) -
        (pos.get(b.env.id!) ?? Number.MAX_SAFE_INTEGER)
    )
  }, [appFolder.envs, envOrder])

  const tooltipText = (env: { env: Partial<EnvironmentType>; folder: SecretFolderType | null }) =>
    env.folder === null
      ? `This folder is missing in ${env.env.name}`
      : `Open ${appFolder.name} in ${env.env.name}`

  // Largest env's counts — a cross-env sum overstates, and contents can't be deduped across envs
  const maxSecrets = Math.max(0, ...appFolder.envs.map((env) => env.folder?.secretCount ?? 0))
  const maxFolders = Math.max(0, ...appFolder.envs.map((env) => env.folder?.folderCount ?? 0))

  return (
    <tr
      className={clsx(
        'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 group divide-x divide-neutral-500/40 border-x border-neutral-500/20 transition ease duration-100 cursor-pointer'
      )}
      onClick={() => router.push(href)}
      title={`Explore ${appFolder.name}`}
    >
      <td className="px-2 py-1.5 whitespace-nowrap text-zinc-800 dark:text-zinc-300 text-2xs 2xl:text-xs ph-no-capture font-medium">
        <Link
          href={href}
          className="flex items-center justify-between gap-8 w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <FaFolder className="text-amber-500" />
            {appFolder.name}
          </div>
          <div className="grid grid-cols-2 gap-6 text-neutral-500 text-2xs w-56 opacity-0 group-hover:opacity-100 transition-opacity ease">
            <span className="flex items-center gap-2">
              <FaFolder /> {maxFolders} folder{maxFolders !== 1 && 's'}
            </span>
            <span className="flex items-center gap-2">
              <FaKey /> {maxSecrets} secret{maxSecrets !== 1 && 's'}
            </span>
          </div>
        </Link>
      </td>
      {orderedEnvs.map((env) => (
        <td
          key={env.env.id}
          className={clsx(
            'whitespace-nowrap text-center transition-colors ease',
            STATUS_CELL_STYLES[env.folder !== null ? 'present' : 'missing'],
            env.folder !== null && STATUS_CELL_HOVER_STYLES['present']
          )}
          title={tooltipText(env)}
        >
          {env.folder !== null ? (
            <Link
              href={envHref(env.env.id!)}
              onClick={(e) => e.stopPropagation()}
              className="block px-3 py-1.5 truncate"
            >
              <div className="flex items-center justify-center gap-2 text-3xs text-neutral-500">
                <span className="flex items-center gap-1" title={`${env.folder.folderCount} folder${env.folder.folderCount === 1 ? '' : 's'}`}>
                  <FaFolder className="text-[9px] shrink-0" /> {env.folder.folderCount}
                </span>
                <span className="flex items-center gap-1" title={`${env.folder.secretCount} secret${env.folder.secretCount === 1 ? '' : 's'}`}>
                  <FaKey className="text-[9px] shrink-0" /> {env.folder.secretCount}
                </span>
              </div>
            </Link>
          ) : (
            <div className="px-3 py-1.5 truncate">
              <span className="text-3xs uppercase tracking-wide text-red-500">missing</span>
            </div>
          )}
        </td>
      ))}
    </tr>
  )
}

const areAppFolderRowEqual = (prev: AppFolderRowProps, next: AppFolderRowProps) => {
  if (prev.basePath !== next.basePath || prev.pathSuffix !== next.pathSuffix) return false
  if (prev.envOrder !== next.envOrder) return false
  if (prev.appFolder.name !== next.appFolder.name) return false
  if (prev.appFolder.path !== next.appFolder.path) return false
  const pe = prev.appFolder.envs
  const ne = next.appFolder.envs
  if (pe.length !== ne.length) return false
  for (let i = 0; i < pe.length; i++) {
    if (pe[i].env.id !== ne[i].env.id) return false
    const pF = pe[i].folder
    const nF = ne[i].folder
    if ((pF === null) !== (nF === null)) return false
    if (pF && nF) {
      if (pF.path !== nF.path || pF.name !== nF.name) return false
      if (pF.secretCount !== nF.secretCount || pF.folderCount !== nF.folderCount) return false
    }
  }
  return true
}

export const AppFolderRow = memo(AppFolderRowBase, areAppFolderRowEqual)
