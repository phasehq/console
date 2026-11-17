'use client'

import { Checkbox } from '@/components/common/Checkbox'
import { MAX_APP_ENVIRONMENTS, type EnvironmentRef } from '@/utils/agents/appAccess'

/**
 * The environments of one app as checkboxes. Scrolls past a handful, so a
 * dialog keeps its size with many environments.
 */
export function EnvironmentChecklist({
  id,
  label,
  environments,
  selected,
  onChange,
  keepOne = false,
}: {
  id: string
  label: string
  environments: EnvironmentRef[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** The last ticked environment cannot be unticked. */
  keepOne?: boolean
}) {
  return (
    <div className="space-y-2">
      <span id={`${id}-label`} className="block text-xs text-neutral-500">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="grid max-h-48 grid-cols-1 gap-x-4 gap-y-2 overflow-y-auto rounded-md p-2 ring-1 ring-inset ring-neutral-500/40 sm:grid-cols-2"
      >
        {environments.map((environment) => {
          const checked = selected.includes(environment.id)
          return (
            <div key={environment.id} className="min-w-0" title={environment.name}>
              <Checkbox
                size="sm"
                label={environment.name}
                checked={checked}
                disabled={keepOne && checked && selected.length === 1}
                onChange={(next) =>
                  onChange(
                    // Kept in the app's own order.
                    environments
                      .map((candidate) => candidate.id)
                      .filter((candidateId) =>
                        candidateId === environment.id ? next : selected.includes(candidateId)
                      )
                  )
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Why the chosen environments cannot be saved, or ''. */
export const environmentsProblem = (ids: string[]): string =>
  ids.length === 0
    ? 'Choose at least one environment.'
    : ids.length > MAX_APP_ENVIRONMENTS
      ? `Choose at most ${MAX_APP_ENVIRONMENTS} environments.`
      : ''
