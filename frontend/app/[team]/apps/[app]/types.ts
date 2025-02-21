import { EnvironmentType, SecretType, SecretFolderType } from '@/apollo/graphql'

export type EnvSecrets = {
  env: EnvironmentType
  secrets: SecretType[]
}

export type EnvFolders = {
  env: EnvironmentType
  folders: SecretFolderType[]
}

export type AppSecret = {
  id: string
  key: string
  isImported?: boolean
  envs: Array<{
    env: Partial<EnvironmentType>
    secret: SecretType | null
  }>
}

export type AppFolder = {
  name: string
  envs: Array<{
    env: Partial<EnvironmentType>
    folder: SecretFolderType | null
  }>
}
