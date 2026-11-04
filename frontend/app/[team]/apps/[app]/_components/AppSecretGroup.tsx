'use client'

import { EnvironmentType } from '@/apollo/graphql'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import clsx from 'clsx'
import { ReactNode, useCallback, useMemo } from 'react'
import { IconType } from 'react-icons'
import { GroupSetUp, GroupSetUpContext, SetUpCell } from './GroupSetUp'
import {
  GRID_CELL_BASE,
  GRID_KEY_CELL,
  GRID_TRAILING_CELL,
  GROUP_ACCENT,
  GridColumn,
  NEW_ENV_CELL,
} from './gridColumns'

const GROUP_HEADER_BG = 'bg-zinc-200 dark:bg-zinc-900'

export type GroupKind = 'rotation' | 'dynamic'

/** What the grid needs to open a prefilled set-up dialog for a group in another env */
export type GroupSetUpRequest = {
  kind: GroupKind
  /** Any env's instance of the group; its config prefills the dialog */
  sourceId: string
  path: string
  envId: string
}

const SET_UP_LABEL: Record<GroupKind, string> = {
  rotation: 'Set up rotation',
  dynamic: 'Set up dynamic secret',
}

interface AppSecretGroupProps {
  kind: GroupKind
  groupId: string
  icon: IconType
  displayName: string
  providerId?: string | null
  path: string
  columns: GridColumn[]
  environments: EnvironmentType[]
  /** The group's instance id in each env it's set up in */
  sourceByEnvId: ReadonlyMap<string, string>
  depth: number
  canSetUp: boolean
  /** Stable across renders: the set-up context reaches every row in the group */
  onSetUp: (request: GroupSetUpRequest) => void
  /** Header cell content for an env the group is set up in */
  renderPresent?: (envId: string) => ReactNode
  children: ReactNode
}

/**
 * Header row and set-up context for the rows of one rotating or dynamic secret
 * across envs. Each env column shows the group's state there; in an env it's
 * missing from, any of the group's cells in that column (slim columns included)
 * opens its set-up dialog, prefilled from an env it's already set up in.
 */
export const AppSecretGroup = ({
  kind,
  groupId,
  icon: Icon,
  displayName,
  providerId,
  path,
  columns,
  environments,
  sourceByEnvId,
  depth,
  canSetUp,
  onSetUp,
  renderPresent,
  children,
}: AppSecretGroupProps) => {
  const sourceId = sourceByEnvId.values().next().value as string | undefined
  const missingEnvIds = environments
    .filter((env) => !sourceByEnvId.has(env.id))
    .map((env) => env.id)
  const missingKey = canSetUp && sourceId ? missingEnvIds.join(',') : ''

  const setUpIn = useCallback(
    (envId: string) => {
      if (sourceId) onSetUp({ kind, sourceId, path, envId })
    },
    [onSetUp, kind, sourceId, path]
  )
  const setUp = useMemo<GroupSetUp>(
    () => ({
      groupId,
      label: SET_UP_LABEL[kind],
      envIds: new Set(missingKey ? missingKey.split(',') : []),
      setUp: setUpIn,
    }),
    [groupId, kind, missingKey, setUpIn]
  )

  return (
    <>
      <tr className={GROUP_HEADER_BG}>
        {/* Sticky like the member rows' key cells, so the accent lines up while scrolling */}
        <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, GROUP_ACCENT, GROUP_HEADER_BG)}>
          <div
            className="flex min-w-0 items-center gap-2 px-3 py-1.5"
            style={depth ? { paddingLeft: `calc(0.75rem + ${depth}rem)` } : undefined}
          >
            <Icon className="shrink-0 text-[10px] text-emerald-500" />
            <span
              className="truncate whitespace-nowrap text-2xs font-medium text-emerald-700 dark:text-emerald-300"
              title={displayName}
            >
              {displayName}
            </span>
            {providerId && (
              <span className="shrink-0 text-sm leading-none text-neutral-500" title={providerId}>
                <ProviderIcon providerId={providerId} />
              </span>
            )}
          </div>
        </td>
        {columns.map(({ env, checked }) => (
          <td key={env.id} className={clsx(GRID_CELL_BASE, 'align-middle')}>
            {sourceByEnvId.has(env.id) ? (
              checked && renderPresent?.(env.id)
            ) : setUp.envIds.has(env.id) ? (
              <SetUpCell setUp={setUp} envId={env.id} envName={env.name} header slim={!checked} />
            ) : null}
          </td>
        ))}
        <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, GROUP_HEADER_BG)} {...NEW_ENV_CELL} />
      </tr>
      <GroupSetUpContext.Provider value={setUp}>{children}</GroupSetUpContext.Provider>
    </>
  )
}
