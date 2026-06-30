'use client'

import { EnvironmentType, RotatingSecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import Link from 'next/link'
import { Fragment, ReactNode } from 'react'
import { FaArrowsRotate, FaChevronDown, FaPlus } from 'react-icons/fa6'

interface AppRotatingSecretGroupProps {
  /** Source rotating secrets in this group — one per env where it's set up. */
  groupRotatingSecrets: RotatingSecretType[]
  /** Every env in the app, in the order shown in the table header. */
  environments: EnvironmentType[]
  /** Number of body columns (key + each env) so the header row spans correctly. */
  colSpan: number
  team: string
  app: string
  /** May open the create-rotation dialog with prefill in the target env. */
  canSetUpIn: (envId: string) => boolean
  /** Child AppSecretRows that belong to this group. */
  children: ReactNode
}

/**
 * Header row that wraps every AppSecretRow belonging to the same rotating
 * secret. Shows the rotating name + provider and a "Set up in…" dropdown
 * listing every env where the rotating secret isn't set up yet — picking one
 * navigates to that env's secrets page with a query param the page reads to
 * prefill the Create-Rotating-Secret dialog.
 */
export const AppRotatingSecretGroup = ({
  groupRotatingSecrets,
  environments,
  colSpan,
  team,
  app,
  canSetUpIn,
  children,
}: AppRotatingSecretGroupProps) => {
  const presentByEnvId = new Map<string, RotatingSecretType>()
  for (const rs of groupRotatingSecrets) {
    if (rs.environment?.id) presentByEnvId.set(rs.environment.id, rs)
  }

  // Display name — every rotating secret in the group should share intent
  // (replicated config), so pick whichever we see first. The provider is
  // identical across the group by construction.
  const headRs = groupRotatingSecrets[0]
  const displayName = headRs?.name ?? 'Rotating secret'
  const providerId = headRs?.provider

  // Source for prefill — any present rotating secret's id will do.
  const sourceForSetUp = (targetEnvId: string): string | undefined => {
    const candidate = groupRotatingSecrets.find((rs) => rs.environment?.id !== targetEnvId)
    return candidate?.id
  }

  return (
    <>
      <tr className="bg-zinc-200/70 dark:bg-zinc-900/60 border-l-2 border-l-emerald-500/60">
        <td
          colSpan={colSpan}
          className="px-3 py-1.5"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <FaArrowsRotate className="text-emerald-500 text-[10px] shrink-0" />
              <span className="font-medium text-2xs whitespace-nowrap truncate max-w-[20rem] text-emerald-700 dark:text-emerald-300">
                {displayName}
              </span>
              {providerId && (
                <span
                  className="text-sm leading-none text-neutral-500"
                  title={providerId}
                >
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
                <Menu as="div" className="relative shrink-0">
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
                    <Menu.Items className="absolute right-0 z-20 mt-1 min-w-[10rem] origin-top-right rounded-md bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40 shadow-lg focus:outline-none">
                      <div className="py-1">
                        {setupEnvs.map(({ env, sourceId }) => (
                          <Menu.Item key={env.id}>
                            {({ active }) => (
                              <Link
                                href={`/${team}/apps/${app}/environments/${env.id}?createRotation=${sourceId}`}
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
      </tr>
      {children}
      <tr aria-hidden className={clsx('h-1')}>
        <td colSpan={colSpan} className="border-b border-neutral-500/20" />
      </tr>
    </>
  )
}
