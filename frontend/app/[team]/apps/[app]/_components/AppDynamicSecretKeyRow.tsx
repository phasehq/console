'use client'

import { DynamicSecretType, EnvironmentType } from '@/apollo/graphql'
import clsx from 'clsx'
import { MissingIndicator, PresentIndicator } from './SecretInfoLegend'

interface AppDynamicSecretKeyRowProps {
  index: number
  keyName: string
  /** Per-env presence of the parent dynamic secret. */
  envs: Array<{ env: EnvironmentType; dynamicSecret: DynamicSecretType | null }>
}

/**
 * One key from a dynamic-secret's key_map rendered as a table row, matching
 * the visual shape of AppSecretRow's collapsed view. There's nothing to edit
 * per env — the actual values are minted on lease — so cells show only
 * present/missing relative to the parent dynamic-secret config.
 */
export const AppDynamicSecretKeyRow = ({
  index,
  keyName,
  envs,
}: AppDynamicSecretKeyRowProps) => {
  const tooltipText = (env: { env: EnvironmentType; dynamicSecret: DynamicSecretType | null }) =>
    env.dynamicSecret
      ? `Generated on lease in ${env.env.name}`
      : `This dynamic secret is missing in ${env.env.name}`

  return (
    <tr
      className={clsx(
        'group divide-x divide-neutral-500/20 border-l border-r border-neutral-500/20 bg-zinc-100 dark:bg-zinc-800'
      )}
    >
      <td className="px-2 py-2 whitespace-nowrap font-mono text-zinc-900 dark:text-zinc-100 flex items-center gap-2 ph-no-capture">
        <span className="font-mono text-xs text-neutral-500 w-4 text-center">{index + 1}</span>
        <div className="flex-1 min-w-60 md:min-w-80 pl-1 text-2xs 2xl:text-sm font-medium">
          {keyName}
        </div>
      </td>
      {envs.map((env) => (
        <td key={env.env.id} className="px-6 whitespace-nowrap">
          <div className="flex items-center justify-center" title={tooltipText(env)}>
            {env.dynamicSecret ? <PresentIndicator /> : <MissingIndicator />}
          </div>
        </td>
      ))}
    </tr>
  )
}
