import { EnvironmentType } from '@/apollo/graphql'
import {
  filterEnvSelection,
  loadedEnvSelection,
} from '@/app/[team]/apps/[app]/_components/EnvSelectionProvider'

const envs = [
  { id: 'dev', name: 'Development' },
  { id: 'staging', name: 'Staging' },
  { id: 'prod', name: 'Production' },
] as EnvironmentType[]

describe('filterEnvSelection', () => {
  it('shows every env when nothing is selected', () => {
    expect(filterEnvSelection(envs, null)).toEqual(envs)
  })

  it('keeps the grid order, not the selection order', () => {
    expect(filterEnvSelection(envs, ['prod', 'dev']).map((env) => env.id)).toEqual(['dev', 'prod'])
  })

  it('narrows to a single env, so its first env is the one in view', () => {
    expect(filterEnvSelection(envs, ['staging'])[0].id).toBe('staging')
  })

  it('falls back to every env when the selection only names unknown envs', () => {
    expect(filterEnvSelection(envs, ['deleted-env'])).toEqual(envs)
  })
})

describe('loadedEnvSelection', () => {
  const ids = (shown: EnvironmentType[]) => shown.map((env) => env.id)

  it('is the selection once every env is decrypted', () => {
    expect(ids(loadedEnvSelection(envs, ['dev', 'staging'], []))).toEqual(['dev', 'staging'])
    expect(loadedEnvSelection(envs, null, [])).toEqual(envs)
  })

  it('leaves out a selected env that is still decrypting', () => {
    expect(ids(loadedEnvSelection(envs, ['dev', 'staging'], ['staging', 'prod']))).toEqual(['dev'])
  })

  it('leaves it out of the whole-app view too', () => {
    expect(ids(loadedEnvSelection(envs, null, ['prod']))).toEqual(['dev', 'staging'])
  })

  it('shows the decrypted envs when the selection names only ones still decrypting', () => {
    expect(ids(loadedEnvSelection(envs, ['prod'], ['staging', 'prod']))).toEqual(['dev'])
  })
})
