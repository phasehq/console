import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { FaCircle } from 'react-icons/fa'
import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { duplicateKeysExist, processEnvFile } from '@/utils/secrets'

/** What an environment takes from the file: keys always, values and comments if chosen */
export type ImportConfig = { withValues: boolean; withComments: boolean }
export type ImportConfigs = Record<string, ImportConfig>

/** The first environment takes values and comments, the others the keys alone */
const defaultConfigs = (envIds: string[]): ImportConfigs =>
  Object.fromEntries(
    envIds.map((id, index) => [id, { withValues: index === 0, withComments: index === 0 }])
  )

/** Which environments a file goes into, and what each takes from it. Starts over when the list of environments changes */
export const useImportChoices = (envIds: string[]) => {
  const key = envIds.join(',')
  const [selectedIds, setSelectedIds] = useState<string[]>(envIds)
  const [configs, setConfigs] = useState<ImportConfigs>(() => defaultConfigs(envIds))

  const reset = useCallback(() => {
    const ids = key ? key.split(',') : []
    setSelectedIds(ids)
    setConfigs(defaultConfigs(ids))
  }, [key])

  // Not when a refresh hands over new objects for the same environments
  useEffect(() => reset(), [reset])

  const toggleEnv = (id: string) => {
    if (!selectedIds.includes(id)) {
      setSelectedIds((selected) => [...selected, id])
      return
    }
    setSelectedIds((selected) => selected.filter((other) => other !== id))
    // An environment taken out takes nothing when it's put back
    setConfigs((current) => ({ ...current, [id]: { withValues: false, withComments: false } }))
  }

  const setConfig = (id: string, change: Partial<ImportConfig>) =>
    setConfigs((current) => ({ ...current, [id]: { ...current[id], ...change } }))

  return { selectedIds, configs, toggleEnv, setConfig, reset }
}

/**
 * The file's secrets for each chosen environment, in the order given: each with the values and
 * comments it takes. Throws when the file holds a key twice.
 */
export const secretsForEnvs = <E extends Pick<EnvironmentType, 'id'>>(
  envFile: string,
  environments: E[],
  selectedIds: ReadonlyArray<string>,
  configs: ImportConfigs,
  path = '/'
): { env: E; secrets: SecretType[] }[] =>
  environments
    .filter((env) => selectedIds.includes(env.id))
    .map((env) => {
      const config = configs[env.id] ?? { withValues: false, withComments: false }
      const secrets = processEnvFile(
        envFile,
        env as unknown as EnvironmentType,
        path,
        config.withValues,
        config.withComments
      )
      if (duplicateKeysExist(secrets)) throw new Error('File contains duplicate keys!')
      return { env, secrets }
    })

/** Each environment, with a switch for whether it takes the file and two for what it takes */
export const EnvImportOptions = ({
  environments,
  selectedIds,
  configs,
  onToggleEnv,
  onChangeConfig,
}: {
  environments: { id: string; name: string; color: string }[]
  selectedIds: ReadonlyArray<string>
  configs: ImportConfigs
  onToggleEnv: (id: string) => void
  onChangeConfig: (id: string, change: Partial<ImportConfig>) => void
}) => (
  <table className="table-auto min-w-full divide-y divide-zinc-500/40 text-sm">
    <thead>
      <tr className="bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
        <th className="border-b border-neutral-500/20 p-2 text-left">Environment</th>
        <th className="border-b border-neutral-500/20 p-2 text-center">Import Values</th>
        <th className="border-b border-neutral-500/20 p-2 text-center">Import Comments</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-zinc-500/40">
      {environments.map((env) => {
        const selected = selectedIds.includes(env.id)
        const config = configs[env.id] ?? { withValues: false, withComments: false }
        return (
          <tr key={env.id}>
            <td>
              <div
                className="flex p-2 items-center justify-between gap-3 border-r border-neutral-500/20"
                title={
                  selected
                    ? "Don't import secrets into this environment"
                    : 'Import secrets into this environment'
                }
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FaCircle
                    className={clsx('shrink-0 text-[8px]', !selected && 'opacity-50')}
                    style={{ color: env.color }}
                  />
                  <span
                    className={clsx(
                      'truncate',
                      selected
                        ? 'text-neutral-800 dark:text-neutral-200 font-medium'
                        : 'text-neutral-500'
                    )}
                  >
                    {env.name}
                  </span>
                </span>

                <ToggleSwitch value={selected} onToggle={() => onToggleEnv(env.id)} />
              </div>
            </td>

            <td>
              <div className="flex p-2 items-center justify-center">
                <ToggleSwitch
                  value={config.withValues}
                  disabled={!selected}
                  onToggle={() => onChangeConfig(env.id, { withValues: !config.withValues })}
                />
              </div>
            </td>

            <td>
              <div className="flex p-2 items-center justify-center">
                <ToggleSwitch
                  value={config.withComments}
                  disabled={!selected}
                  onToggle={() => onChangeConfig(env.id, { withComments: !config.withComments })}
                />
              </div>
            </td>
          </tr>
        )
      })}
    </tbody>
  </table>
)
