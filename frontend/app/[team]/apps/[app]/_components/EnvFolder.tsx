'use client'
import Link from 'next/link'
import { memo } from 'react'
import { FaFolder } from 'react-icons/fa'
import { EnvironmentType, SecretFolderType } from '@/apollo/graphql'

type EnvFolderProp = {
  envFolder: { env: Partial<EnvironmentType>; folder: SecretFolderType | null }
  pathname: string
}

const EnvFolderBase = ({ envFolder, pathname }: EnvFolderProp) => {
  const fullPath = `${envFolder.folder?.path}/${envFolder.folder?.name}`.replace(/^\/+/, '')
  return (
    <div className="py-2 px-4">
      {envFolder.folder === null ? (
        <span className="text-red-500 font-mono">missing</span>
      ) : (
        <Link
          className="flex items-center gap-2 group font-medium text-sm tracking-wider"
          href={`${pathname}/environments/${envFolder.env.id}${envFolder.folder ? `/${fullPath}` : ''}`}
          title={
            envFolder.folder
              ? `View this folder in ${envFolder.env.name}`
              : `Manage ${envFolder.env.name}`
          }
        >
          <div>
            <div className="text-gray-500">{envFolder.env.name}</div>
            <div className="text-emerald-500 group-hover:text-emerald-600 transition ease flex items-center gap-2">
              <FaFolder />
              {fullPath}
            </div>
          </div>
        </Link>
      )}
    </div>
  )
}

const areEnvFolderEqual = (prev: EnvFolderProp, next: EnvFolderProp) => {
  const pf = prev.envFolder
  const nf = next.envFolder
  const pFull = `${pf.folder?.path}/${pf.folder?.name}`
  const nFull = `${nf.folder?.path}/${nf.folder?.name}`
  return (
    prev.pathname === next.pathname &&
    pf.env.id === nf.env.id &&
    (pf.folder === null) === (nf.folder === null) &&
    pFull === nFull
  )
}

export const EnvFolder = memo(EnvFolderBase, areEnvFolderEqual)
