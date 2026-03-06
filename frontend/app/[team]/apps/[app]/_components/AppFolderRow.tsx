'use client'
import { memo } from 'react'
import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaChevronRight, FaFolder } from 'react-icons/fa'
import { AppFolder } from '../types'
import { EnvFolder } from './EnvFolder'
import { PresentIndicator, MissingIndicator } from './SecretInfoLegend'
import { SecretFolderType, EnvironmentType } from '@/apollo/graphql'

type AppFolderRowProps = { appFolder: AppFolder; pathname: string }

const AppFolderRowBase = ({ appFolder, pathname }: AppFolderRowProps) => {
  const fullPath = `${appFolder.path}/${appFolder.name}`.replace(/^\/+/, '')

  const tooltipText = (env: { env: Partial<EnvironmentType>; folder: SecretFolderType | null }) =>
    env.folder === null ? `This folder is missing in ${env.env.name}` : 'This folder is present'

  return (
    <Disclosure>
      {({ open }) => (
        <>
          <Disclosure.Button
            as="tr"
            className={clsx(
              'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 group divide-x divide-neutral-500/40 border-x transition ease duration-100 cursor-pointer',
              open ? '!border-l-emerald-500 !border-r-neutral-500/20' : 'border-neutral-500/20'
            )}
          >
            <td
              className={clsx(
                'px-6 py-3 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 flex items-center gap-2 ph-no-capture',
                open ? 'font-bold' : 'font-medium'
              )}
            >
              <FaFolder className="text-emerald-500" />
              {fullPath}
              <FaChevronRight
                className={clsx(
                  'transform transition ease font-light',
                  open ? 'opacity-100 rotate-90' : 'opacity-0 group-hover:opacity-100 rotate-0'
                )}
              />
            </td>
            {appFolder.envs.map((env) => (
              <td key={env.env.id} className="px-6 py-3 whitespace-nowrap">
                <div className="flex items-center justify-center" title={tooltipText(env)}>
                  {env.folder !== null ? <PresentIndicator /> : <MissingIndicator />}
                </div>
              </td>
            ))}
          </Disclosure.Button>
          <Transition
            as="tr"
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
            className={clsx(
              'border-x',
              open
                ? '!border-l-emerald-500 !border-r-neutral-500/40 shadow-xl'
                : 'border-neutral-500/40'
            )}
          >
            <td
              colSpan={appFolder.envs.length + 1}
              className="p-2 space-y-6 bg-zinc-100 dark:bg-zinc-800"
            >
              <Disclosure.Panel>
                <div className="grid gap-2 divide-y divide-neutral-500/20">
                  {appFolder.envs.map((envFolder) => (
                    <EnvFolder key={envFolder.env.id} envFolder={envFolder} pathname={pathname} />
                  ))}
                </div>
              </Disclosure.Panel>
            </td>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}

const areAppFolderRowEqual = (prev: AppFolderRowProps, next: AppFolderRowProps) => {
  if (prev.pathname !== next.pathname) return false
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
    if (pF && nF && (pF.path !== nF.path || pF.name !== nF.name)) return false
  }
  return true
}

export const AppFolderRow = memo(AppFolderRowBase, areAppFolderRowEqual)
