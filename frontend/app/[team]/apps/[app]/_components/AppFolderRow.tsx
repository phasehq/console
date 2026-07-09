'use client'
import { memo } from 'react'
import { useRouter } from 'next/navigation'
import clsx from 'clsx'
import { FaFolder, FaKey } from 'react-icons/fa'
import Link from 'next/link'
import { AppFolder } from '../types'
import { STATUS_CELL_STYLES } from './SecretInfoLegend'
import { SecretFolderType, EnvironmentType } from '@/apollo/graphql'

type AppFolderRowProps = { appFolder: AppFolder; href: string }

/**
 * A folder row in the cross-env table. Clicking it navigates deeper into the
 * folder within the cross-env view; the env columns show whether the folder
 * exists in each environment.
 */
const AppFolderRowBase = ({ appFolder, href }: AppFolderRowProps) => {
  const router = useRouter()

  const tooltipText = (env: { env: Partial<EnvironmentType>; folder: SecretFolderType | null }) =>
    env.folder === null ? `This folder is missing in ${env.env.name}` : 'This folder is present'

  // Aggregate counts across envs for at-a-glance info
  const totalSecrets = appFolder.envs.reduce((acc, env) => acc + (env.folder?.secretCount ?? 0), 0)
  const totalFolders = appFolder.envs.reduce((acc, env) => acc + (env.folder?.folderCount ?? 0), 0)

  return (
    <tr
      className={clsx(
        'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 group divide-x divide-neutral-500/40 border-x border-neutral-500/20 transition ease duration-100 cursor-pointer'
      )}
      onClick={() => router.push(href)}
      title={`Explore ${appFolder.name}`}
    >
      <td className="px-2 py-1.5 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 text-2xs 2xl:text-sm ph-no-capture font-medium">
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
              <FaFolder /> {totalFolders} folder{totalFolders !== 1 && 's'}
            </span>
            <span className="flex items-center gap-2">
              <FaKey /> {totalSecrets} secret{totalSecrets !== 1 && 's'}
            </span>
          </div>
        </Link>
      </td>
      {appFolder.envs.map((env) => (
        <td
          key={env.env.id}
          className={clsx(
            'px-6 py-1.5 whitespace-nowrap',
            STATUS_CELL_STYLES[env.folder !== null ? 'present' : 'missing']
          )}
          title={tooltipText(env)}
        />
      ))}
    </tr>
  )
}

const areAppFolderRowEqual = (prev: AppFolderRowProps, next: AppFolderRowProps) => {
  if (prev.href !== next.href) return false
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
