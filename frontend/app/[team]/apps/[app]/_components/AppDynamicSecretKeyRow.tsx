'use client'

import { DynamicSecretType, EnvironmentType } from '@/apollo/graphql'
import clsx from 'clsx'
import { memo, useContext } from 'react'
import { FaCircle } from 'react-icons/fa6'
import { MissingCell } from './MissingCell'
import { GroupSetUpContext, SetUpCell } from './GroupSetUp'
import {
  GRID_CELL_BASE,
  GRID_KEY_CELL,
  GRID_KEY_ROW_HOVER,
  GRID_ROW_BG,
  GRID_TRAILING_CELL,
  NEW_ENV_CELL,
  GROUP_ACCENT,
  ROW_GUTTER_WIDTH,
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
 * there's nothing to edit — each env column shows whether a lease there
 * returns this key: the dynamic secret is set up in it, and maps the key.
 */
const AppDynamicSecretKeyRowBase = ({
  index,
  depth,
  keyName,
  envs,
  columns,
  showEnv,
}: AppDynamicSecretKeyRowProps) => {
  const groupSetUp = useContext(GroupSetUpContext)
  // Each env maps its own keys: set up there isn't enough for this one to be among them
  const stateByEnv = new Map(
    envs.map(({ env, dynamicSecret }) => [
      env.id,
      !dynamicSecret
        ? ('none' as const)
        : dynamicSecret.keyMap?.some((key) => key?.keyName === keyName)
          ? ('mapped' as const)
          : ('unmapped' as const),
    ])
  )

  return (
    <tr className="group bg-zinc-100 dark:bg-zinc-800">
      <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, GRID_ROW_BG, GRID_KEY_ROW_HOVER, GROUP_ACCENT)}>
        <div className="flex h-full items-center gap-2 px-2 py-2 font-mono text-zinc-900 ph-no-capture dark:text-zinc-100">
          <span
            className={clsx(
              'shrink-0 text-center font-mono text-2xs text-neutral-500',
              ROW_GUTTER_WIDTH
            )}
            style={depth ? { marginLeft: `${depth}rem` } : undefined}
          >
            {index + 1}
          </span>
          {/* Matches the key input typography in AppSecretRow */}
          <div className="min-w-0 flex-1 truncate pl-2 text-2xs font-medium tracking-wide 2xl:text-xs">
            {keyName}
          </div>
        </div>
      </td>
      {columns.map((column) => {
        const { env } = column
        const state = stateByEnv.get(env.id) ?? 'none'
        const present = state === 'mapped'

        if (!column.checked) {
          if (state === 'none' && groupSetUp?.envIds.has(env.id))
            return (
              <td key={env.id} className={clsx(GRID_CELL_BASE, 'align-middle')}>
                <SetUpCell setUp={groupSetUp} envId={env.id} envName={env.name} slim />
              </td>
            )
          const status = present
            ? `Set up in ${env.name}`
            : state === 'unmapped'
              ? `Not among ${env.name}'s keys`
              : `Missing in ${env.name}`
          return (
            <td key={env.id} className={clsx(GRID_CELL_BASE, 'text-center align-middle')}>
              <button
                type="button"
                onClick={() => showEnv(env.id)}
                title={`${status} — click to show ${env.name}`}
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

        if (state === 'none') {
          return (
            <td key={env.id} className={GRID_CELL_BASE}>
              {groupSetUp?.envIds.has(env.id) ? (
                <SetUpCell setUp={groupSetUp} envId={env.id} envName={env.name} />
              ) : (
                <MissingCell title={`This dynamic secret isn't set up in ${env.name}`} />
              )}
            </td>
          )
        }

        if (state === 'unmapped') {
          return (
            <td key={env.id} className={GRID_CELL_BASE}>
              <MissingCell title={`A lease in ${env.name} doesn't return ${keyName}`} />
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
