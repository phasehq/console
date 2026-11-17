import clsx from 'clsx'
import { FaLock } from 'react-icons/fa'
import { WITHHELD_APP_LABEL, hiddenEnvironmentsLabel } from '@/utils/agents/appAccess'

/**
 * How the Agents screens show an asset the viewer cannot access: the item
 * stays, its name does not. The backend has already left the name out.
 */

const Withheld = ({ children, className }: { children: string; className?: string }) => (
  <span
    className={clsx('inline-flex min-w-0 items-center gap-1 text-neutral-500', className)}
    data-withheld
  >
    <FaLock aria-hidden="true" className="shrink-0 text-2xs" />
    <span className="truncate">{children}</span>
  </span>
)

/** In place of the name of an app the viewer cannot access. */
export function WithheldApp({ className }: { className?: string }) {
  return <Withheld className={className}>{WITHHELD_APP_LABEL}</Withheld>
}

/** The environments the viewer can access, then a count of the rest. */
export function AppEnvironments({
  environments,
  hiddenEnvironmentCount = 0,
  empty = 'None',
}: {
  environments: readonly { name: string }[]
  hiddenEnvironmentCount?: number | null
  empty?: string
}) {
  const names = environments.map((environment) => environment.name).join(', ')
  const hidden = hiddenEnvironmentCount ?? 0
  if (!hidden) return <>{names || empty}</>
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5">
      {names && <span>{names}</span>}
      <Withheld>{hiddenEnvironmentsLabel(hidden, !!names)}</Withheld>
    </span>
  )
}
