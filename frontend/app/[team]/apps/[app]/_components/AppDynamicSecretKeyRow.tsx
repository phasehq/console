'use client'

import { DynamicSecretType, EnvironmentType } from '@/apollo/graphql'
import clsx from 'clsx'
import { memo, useMemo } from 'react'
import { STATUS_CELL_STYLES } from './SecretInfoLegend'

interface AppDynamicSecretKeyRowProps {
  index: number
  keyName: string
  /** Per-env presence of the parent dynamic secret. */
  envs: Array<{ env: EnvironmentType; dynamicSecret: DynamicSecretType | null }>
  /** Env column order shared with the table headers (includes any optimistic
   *  reorder) */
  envOrder: string[]
}

/**
 * One key from a dynamic-secret's key_map rendered as a table row, matching
 * the visual shape of AppSecretRow's collapsed view. There's nothing to edit
 * per env — the actual values are minted on lease — so cells show only
 * present/missing relative to the parent dynamic-secret config.
 */
const AppDynamicSecretKeyRowBase = ({
  index,
  keyName,
  envs,
  envOrder,
}: AppDynamicSecretKeyRowProps) => {
  const orderedEnvs = useMemo(() => {
    const pos = new Map(envOrder.map((id, i) => [id, i]))
    return [...envs].sort(
      (a, b) =>
        (pos.get(a.env.id) ?? Number.MAX_SAFE_INTEGER) -
        (pos.get(b.env.id) ?? Number.MAX_SAFE_INTEGER)
    )
  }, [envs, envOrder])

  const tooltipText = (env: { env: EnvironmentType; dynamicSecret: DynamicSecretType | null }) =>
    env.dynamicSecret
      ? `Generated on lease in ${env.env.name}`
      : `This dynamic secret is missing in ${env.env.name}`

  return (
    <tr
      className={clsx(
        // !important: the tbody's divide-color selector outspecifies row border colors
        'group divide-x divide-neutral-500/20 border-l-2 !border-l-emerald-500/60 border-r border-r-neutral-500/20 bg-zinc-100 dark:bg-zinc-800'
      )}
    >
      <td className="px-2 py-2 whitespace-nowrap font-mono text-zinc-900 dark:text-zinc-100 flex items-center gap-2 ph-no-capture">
        <span className="font-mono text-xs text-neutral-500 w-4 text-center">{index + 1}</span>
        {/* Matches the key input typography in AppSecretRow */}
        <div className="flex-1 min-w-60 md:min-w-80 pl-1 text-2xs 2xl:text-xs font-medium tracking-wide">
          {keyName}
        </div>
      </td>
      {orderedEnvs.map((env) => (
        <td
          key={env.env.id}
          className={clsx(
            'px-3 whitespace-nowrap text-center',
            STATUS_CELL_STYLES[env.dynamicSecret ? 'present' : 'missing']
          )}
          title={tooltipText(env)}
        >
          <div className="truncate">
            {env.dynamicSecret ? (
              // Values are minted on lease — the mask is a placeholder
              <span className="text-3xs tracking-widest text-neutral-500 select-none">••••••</span>
            ) : (
              <span className="text-3xs uppercase tracking-wide text-red-500">missing</span>
            )}
          </div>
        </td>
      ))}
    </tr>
  )
}

// envs/envOrder identities only change on a data publish or reorder
export const AppDynamicSecretKeyRow = memo(
  AppDynamicSecretKeyRowBase,
  (prev, next) =>
    prev.index === next.index &&
    prev.keyName === next.keyName &&
    prev.envs === next.envs &&
    prev.envOrder === next.envOrder
)
