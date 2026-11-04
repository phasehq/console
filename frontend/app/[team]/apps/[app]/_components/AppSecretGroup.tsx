'use client'

import { EnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, ReactNode, useCallback, useMemo } from 'react'
import { IconType } from 'react-icons'
import { FaChevronDown, FaPlus } from 'react-icons/fa6'
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
 * missing from, any of the group's cells in that column opens its set-up dialog,
 * prefilled from an env it's already set up in.
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

  // Hidden envs have no set-up cell to click, so the menu lists them
  const hiddenSetUpEnvs = environments.filter(
    (env) => setUp.envIds.has(env.id) && !columns.find((c) => c.env.id === env.id)?.checked
  )

  return (
    <>
      <tr className={GROUP_HEADER_BG}>
        {/* Sticky like the member rows' key cells, so the accent lines up while scrolling */}
        <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, GROUP_ACCENT, GROUP_HEADER_BG)}>
          <div
            className="flex min-w-0 items-center gap-3 px-3 py-1.5"
            style={depth ? { paddingLeft: `calc(0.75rem + ${depth}rem)` } : undefined}
          >
            <div className="flex min-w-0 items-center gap-2">
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
            {hiddenSetUpEnvs.length > 0 && (
              <Menu as="div" className="ml-auto shrink-0">
                <Menu.Button as={Fragment}>
                  <Button variant="secondary" icon={FaPlus} title="Set up in a hidden environment">
                    <span className="text-2xs">Set up in…</span>
                    <FaChevronDown className="text-[8px] opacity-70" />
                  </Button>
                </Menu.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  {/* Anchored into a portal so the grid's scroll container can't clip it */}
                  <Menu.Items
                    anchor={{ to: 'bottom start', gap: 4 }}
                    className="z-50 min-w-[10rem] rounded-md bg-zinc-100 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-zinc-800"
                  >
                    <div className="py-1">
                      {hiddenSetUpEnvs.map((env) => (
                        <Menu.Item key={env.id}>
                          {({ active }) => (
                            <button
                              type="button"
                              onClick={() => setUpIn(env.id)}
                              className={clsx(
                                'flex w-full items-center gap-2 px-3 py-1.5 text-2xs',
                                active
                                  ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100'
                                  : 'text-zinc-700 dark:text-zinc-300'
                              )}
                            >
                              <FaPlus className="text-[8px] text-emerald-500" />
                              <span className="truncate">{env.name}</span>
                            </button>
                          )}
                        </Menu.Item>
                      ))}
                    </div>
                  </Menu.Items>
                </Transition>
              </Menu>
            )}
          </div>
        </td>
        {columns.map(({ env, checked }) => (
          <td key={env.id} className={clsx(GRID_CELL_BASE, 'align-middle')}>
            {!checked ? null : sourceByEnvId.has(env.id) ? (
              renderPresent?.(env.id)
            ) : setUp.envIds.has(env.id) ? (
              <SetUpCell setUp={setUp} envId={env.id} envName={env.name} header />
            ) : null}
          </td>
        ))}
        <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, GROUP_HEADER_BG)} {...NEW_ENV_CELL} />
      </tr>
      <GroupSetUpContext.Provider value={setUp}>{children}</GroupSetUpContext.Provider>
    </>
  )
}
