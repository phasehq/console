'use client'

import { DynamicSecretType, EnvironmentType } from '@/apollo/graphql'
import clsx from 'clsx'
import { memo } from 'react'
import { FaCircle } from 'react-icons/fa6'
import { MissingCell } from './MissingCell'
import {
  GRID_CELL_BASE,
  GRID_KEY_CELL,
  GRID_KEY_ROW_HOVER,
  GRID_ROW_BG,
  GRID_TRAILING_CELL,
  NEW_ENV_CELL,
  GROUP_ACCENT,
  GridColumn,
} from './gridColumns'
import { envColor } from '@/utils/environment'

interface AppDynamicSecretKeyRowProps {
  index: number
  /** Folder depth below the grid's root, for the tree indent */
  depth: number
  keyName: string
  /** Per-env presence of the parent dynamic secret. */
  envs: Array<{ env: EnvironmentType; dynamicSecret: DynamicSecretType | null }>
  columns: GridColumn[]
  showEnv: (envId: string) => void
}

/**
 * One key from a dynamic secret's key_map. Values are minted on lease, so
 * there's nothing to edit — each env column shows whether the dynamic secret
 * is set up there.
 */
const AppDynamicSecretKeyRowBase = ({
  index,
  depth,
  keyName,
  envs,
  columns,
  showEnv,
}: AppDynamicSecretKeyRowProps) => {
  const presentByEnv = new Map(envs.map((entry) => [entry.env.id, Boolean(entry.dynamicSecret)]))

  return (
    <tr className="group bg-zinc-100 dark:bg-zinc-800">
      <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, GRID_ROW_BG, GRID_KEY_ROW_HOVER, GROUP_ACCENT)}>
        <div className="flex h-full items-center gap-2 px-2 py-2 font-mono text-zinc-900 ph-no-capture dark:text-zinc-100">
          <span className="w-6 shrink-0 text-right font-mono text-2xs text-neutral-500">
            {index + 1}
          </span>
          {/* Matches the key input typography in AppSecretRow */}
          <div
            className="min-w-0 flex-1 truncate pl-2 text-2xs font-medium tracking-wide 2xl:text-xs"
            style={depth ? { marginLeft: `${depth}rem` } : undefined}
          >
            {keyName}
          </div>
        </div>
      </td>
      {columns.map((column) => {
        const { env } = column
        const present = presentByEnv.get(env.id) ?? false

        if (!column.checked) {
          return (
            <td key={env.id} className={clsx(GRID_CELL_BASE, 'text-center align-middle')}>
              <button
                type="button"
                onClick={() => showEnv(env.id)}
                title={`${present ? 'Set up' : 'Missing'} in ${env.name} — click to show ${env.name}`}
                className="flex h-full min-h-8 w-full items-center justify-center"
              >
                {present ? (
                  <FaCircle className="text-[7px]" style={{ color: envColor(env) }} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full ring-1 ring-inset ring-neutral-500/60" />
                )}
              </button>
            </td>
          )
        }

        if (!present) {
          return (
            <td key={env.id} className={GRID_CELL_BASE}>
              <MissingCell title={`This dynamic secret isn't set up in ${env.name}`} />
            </td>
          )
        }

        return (
          <td
            key={env.id}
            className={clsx(GRID_CELL_BASE, 'whitespace-nowrap px-3 text-center')}
            title={`Generated on lease in ${env.name}`}
          >
            <div className="truncate">
              {/* Values are minted on lease — the mask is a placeholder */}
              <span className="select-none text-3xs tracking-widest text-neutral-500">••••••</span>
            </div>
          </td>
        )
      })}
      <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, GRID_ROW_BG)} {...NEW_ENV_CELL} />
    </tr>
  )
}

// envs/columns identities only change on a data publish or column change
export const AppDynamicSecretKeyRow = memo(
  AppDynamicSecretKeyRowBase,
  (prev, next) =>
    prev.index === next.index &&
    prev.depth === next.depth &&
    prev.keyName === next.keyName &&
    prev.envs === next.envs &&
    prev.columns === next.columns &&
    prev.showEnv === next.showEnv
)
