'use client'

import { DynamicSecretType, EnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { Fragment, ReactNode } from 'react'
import { GRID_CELL_BASE, GRID_KEY_CELL, GRID_TRAILING_CELL, NEW_ENV_CELL, GROUP_ACCENT } from './gridColumns'

const GROUP_HEADER_BG = 'bg-zinc-200 dark:bg-zinc-900'
import { FaBolt, FaChevronDown, FaPlus } from 'react-icons/fa6'

interface AppDynamicSecretGroupProps {
  /** Every env in the app; "Set up in…" lists the ones missing this secret. */
  environments: EnvironmentType[]
  /** Per-env source dynamic secret (null = not set up there). */
  perEnvDynamicSecrets: Array<{
    env: EnvironmentType
    dynamicSecret: DynamicSecretType | null
  }>
  /** Display name + provider icon for the header. */
  displayName: string
  providerId?: string | null
  /** Number of grid columns (key + every env + trailing) so the header row spans correctly. */
  colSpan: number
  /** Folder depth below the grid's root, for the tree indent */
  depth: number
  team: string
  app: string
  /** May open the create-dynamic dialog with prefill in the target env. */
  canSetUpIn: (envId: string) => boolean
  /** Per-key child rows (AppDynamicSecretKeyRow) for the dynamic secret's key_map. */
  children: ReactNode
}

/**
 * Header row that wraps the per-key rows of one dynamic-secret config. Shows
 * the dynamic-secret name + provider and a "Set up in…" dropdown listing
 * every env where the dynamic secret isn't set up yet — picking one navigates
 * to that env's secrets page with a query param the page reads to prefill
 * the Create-Dynamic-Secret dialog.
 */
export const AppDynamicSecretGroup = ({
  environments,
  perEnvDynamicSecrets,
  displayName,
  providerId,
  colSpan,
  depth,
  team,
  app,
  canSetUpIn,
  children,
}: AppDynamicSecretGroupProps) => {
  const presentByEnvId = new Map<string, DynamicSecretType>()
  for (const e of perEnvDynamicSecrets) {
    if (e.dynamicSecret && e.env?.id) presentByEnvId.set(e.env.id, e.dynamicSecret)
  }

  // Source for prefill — any present dynamic secret's id will do.
  const sourceForSetUp = (targetEnvId: string): string | undefined => {
    const candidate = perEnvDynamicSecrets.find(
      (e) => e.dynamicSecret && e.env?.id !== targetEnvId
    )
    return candidate?.dynamicSecret?.id
  }

  return (
    <>
      <tr className="bg-zinc-200 dark:bg-zinc-900">
        {/* A sticky key cell like the member rows', so the accent lines up and stays put
            while scrolling; the label may overhang into the empty cells beside it */}
        <td className={clsx(GRID_CELL_BASE, GRID_KEY_CELL, GROUP_ACCENT, GROUP_HEADER_BG)}>
          <div
            className="flex w-max items-center gap-3 whitespace-nowrap px-3 py-1.5"
            style={depth ? { paddingLeft: `calc(0.75rem + ${depth}rem)` } : undefined}
          >
            <div className="flex items-center gap-2 min-w-0">
              <FaBolt className="text-emerald-500 text-[10px] shrink-0" />
              <span className="font-medium text-2xs whitespace-nowrap truncate max-w-[20rem] text-emerald-700 dark:text-emerald-300">
                {displayName}
              </span>
              {providerId && (
                <span className="text-sm leading-none text-neutral-500" title={providerId}>
                  <ProviderIcon providerId={providerId} />
                </span>
              )}
            </div>
            {(() => {
              const setupEnvs = environments
                .filter((env) => !presentByEnvId.has(env.id))
                .map((env) => ({ env, sourceId: sourceForSetUp(env.id) }))
                .filter(
                  (e): e is { env: EnvironmentType; sourceId: string } =>
                    !!e.sourceId && canSetUpIn(e.env.id)
                )
              if (setupEnvs.length === 0) return null
              return (
                <Menu as="div" className="shrink-0">
                  <Menu.Button as={Fragment}>
                    <Button variant="secondary" icon={FaPlus}>
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
                      className="z-50 min-w-[10rem] rounded-md bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 shadow-lg focus:outline-none"
                    >
                      <div className="py-1">
                        {setupEnvs.map(({ env, sourceId }) => (
                          <Menu.Item key={env.id}>
                            {({ active }) => (
                              <Link
                                href={`/${team}/apps/${app}/environments/${env.id}?createDynamic=${sourceId}`}
                                className={clsx(
                                  'flex items-center gap-2 px-3 py-1.5 text-2xs',
                                  active
                                    ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                                    : 'text-zinc-700 dark:text-zinc-300'
                                )}
                              >
                                <FaPlus className="text-[8px] text-emerald-500" />
                                <span className="truncate">{env.name}</span>
                              </Link>
                            )}
                          </Menu.Item>
                        ))}
                      </div>
                    </Menu.Items>
                  </Transition>
                </Menu>
              )
            })()}
          </div>
        </td>
        <td colSpan={colSpan - 2} className={GRID_CELL_BASE} />
        <td className={clsx(GRID_CELL_BASE, GRID_TRAILING_CELL, GROUP_HEADER_BG)} {...NEW_ENV_CELL} />
      </tr>
      {children}
    </>
  )
}
