'use client'

import clsx from 'clsx'
import { createContext, useContext } from 'react'
import { FaPlus } from 'react-icons/fa'
import { MISSING_CHECKERBOARD } from './SecretInfoLegend'

/**
 * Provided by a rotating or dynamic group to its rows: every cell in an env the group
 * isn't set up in opens that env's set-up dialog. Cached row elements still pick up
 * changes, since context reaches past memoized parents.
 */
export type GroupSetUp = {
  groupId: string
  /** e.g. "Set up rotation" */
  label: string
  /** Envs the group is missing from and the user may set it up in */
  envIds: ReadonlySet<string>
  setUp: (envId: string) => void
}

export const GroupSetUpContext = createContext<GroupSetUp | null>(null)

export const useGroupSetUp = (envId: string | undefined) => {
  const setUp = useContext(GroupSetUpContext)
  return setUp && envId && setUp.envIds.has(envId) ? setUp : null
}

// Lights up every cell of one env in one group together, without re-rendering the rows
const markHot = (cell: HTMLElement, hot: boolean) => {
  const { setupGroup, setupEnv } = cell.dataset
  const scope = cell.closest('table') ?? document
  scope
    .querySelectorAll<HTMLElement>(
      `[data-setup-group="${CSS.escape(setupGroup!)}"][data-setup-env="${CSS.escape(setupEnv!)}"]`
    )
    .forEach((el) => {
      if (hot) el.dataset.hot = ''
      else delete el.dataset.hot
    })
}

/**
 * A missing cell that's part of a group's set-up target. The header cell carries the
 * label; the rows' cells only highlight with it.
 */
export const SetUpCell = ({
  setUp,
  envId,
  envName,
  header = false,
}: {
  setUp: GroupSetUp
  envId: string
  envName?: string
  header?: boolean
}) => (
  <button
    type="button"
    data-setup-group={setUp.groupId}
    data-setup-env={envId}
    onClick={(e) => {
      e.stopPropagation()
      markHot(e.currentTarget, false)
      setUp.setUp(envId)
    }}
    onMouseEnter={(e) => markHot(e.currentTarget, true)}
    onMouseLeave={(e) => markHot(e.currentTarget, false)}
    onFocus={(e) => markHot(e.currentTarget, true)}
    onBlur={(e) => markHot(e.currentTarget, false)}
    title={`${setUp.label} in ${envName ?? 'this environment'}`}
    aria-label={`${setUp.label} in ${envName ?? 'this environment'}`}
    className={clsx(
      'group/setup flex h-full w-full items-center gap-1.5 px-3 text-left text-2xs transition-colors focus:outline-none',
      header ? 'min-h-8 py-1.5' : clsx('min-h-9 py-1', MISSING_CHECKERBOARD),
      'text-neutral-500 data-[hot]:bg-emerald-400/10 data-[hot]:text-emerald-700 dark:data-[hot]:text-emerald-300'
    )}
  >
    {header ? (
      <>
        <FaPlus className="shrink-0 text-[9px]" />
        <span className="truncate">{setUp.label}</span>
      </>
    ) : (
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-neutral-500/50 group-data-[hot]/setup:ring-emerald-500/70"
      />
    )}
  </button>
)
