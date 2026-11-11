import { ApiSecretTypeChoices, SecretType } from '@/apollo/graphql'

export type FolderRef = { name: string; path: string }

/** What an environment holds as deployed */
export type EnvContents = { secrets: SecretType[]; folders: FolderRef[] }

const folderFullPath = ({ name, path }: FolderRef) => (path === '/' ? `/${name}` : `${path}/${name}`)

const isSealed = (secret: SecretType) => secret.type === ApiSecretTypeChoices.Sealed
const wanted = (secret: SecretType, only?: ReadonlySet<string>) => !only || only.has(secret.id)

/** The secrets a copy starts with, all of them or a chosen few: rotations keep theirs, and sealed ones can't come */
export const secretsToClone = (secrets: SecretType[], only?: ReadonlySet<string>): SecretType[] =>
  secrets.filter(
    (secret) => !secret.rotatingSecretId && !isSealed(secret) && wanted(secret, only)
  )

/** Folders no copied secret brings along, parents first: creating a secret creates the folders on its path */
export const emptyFoldersToCreate = (folders: FolderRef[], secretPaths: Iterable<string>) => {
  const covered = new Set<string>()
  for (const path of secretPaths)
    for (let p = path; p && p !== '/'; p = p.slice(0, p.lastIndexOf('/'))) covered.add(p)
  const depth = (folder: FolderRef) => folderFullPath(folder).split('/').length
  return folders
    .filter((folder) => !covered.has(folderFullPath(folder)))
    .sort((a, b) => depth(a) - depth(b))
}
