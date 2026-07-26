import { Fragment, useState } from 'react'
import { Menu, RadioGroup, Transition } from '@headlessui/react'
import {
  FaArrowDown,
  FaArrowUp,
  FaChevronDown,
  FaChevronRight,
  FaCircle,
  FaDotCircle,
  FaEye,
  FaEyeSlash,
  FaUndo,
} from 'react-icons/fa'
import clsx from 'clsx'
import { Button } from '@/components/common/Button'
import { ConflictSelectionMap, EnvConflict } from '@/utils/secrets'

interface EnvConflictResolutionProps {
  conflicts: EnvConflict[]
  selections: ConflictSelectionMap
  onSelectionsChange: (selections: ConflictSelectionMap) => void
  onBack: () => void
  onContinue: () => void
}

const EnvConflictResolution = ({
  conflicts,
  selections,
  onSelectionsChange,
  onBack,
  onContinue,
}: EnvConflictResolutionProps) => {
  const [openConflictKey, setOpenConflictKey] = useState<string | null>(conflicts[0]?.key ?? null)
  const [revealedConflictKeys, setRevealedConflictKeys] = useState<Set<string>>(new Set())
  const resolvedCount = conflicts.filter((conflict) => Boolean(selections[conflict.key])).length
  const remainingCount = conflicts.length - resolvedCount
  const allResolved = remainingCount === 0

  const setAllSelections = (position: 'first' | 'last') => {
    onSelectionsChange(
      Object.fromEntries(
        conflicts.map((conflict) => {
          const index = position === 'first' ? 0 : conflict.occurrences.length - 1
          return [conflict.key, conflict.occurrences[index].id]
        })
      )
    )
    setOpenConflictKey(null)
  }

  const resetSelections = () => {
    onSelectionsChange({})
    setOpenConflictKey(conflicts[0]?.key ?? null)
  }

  const selectOccurrence = (conflictKey: string, occurrenceId: string) => {
    const nextSelections = { ...selections, [conflictKey]: occurrenceId }
    onSelectionsChange(nextSelections)

    const currentIndex = conflicts.findIndex((conflict) => conflict.key === conflictKey)
    const nextConflict = [
      ...conflicts.slice(currentIndex + 1),
      ...conflicts.slice(0, currentIndex),
    ].find((conflict) => !nextSelections[conflict.key])
    setOpenConflictKey(nextConflict?.key ?? null)
  }

  const toggleRevealed = (conflictKey: string) => {
    setRevealedConflictKeys((current) => {
      const next = new Set(current)
      next.has(conflictKey) ? next.delete(conflictKey) : next.add(conflictKey)
      return next
    })
  }

  return (
    <div className="space-y-4 pt-1">
      <p className="text-sm text-neutral-500">Review duplicated keys before importing.</p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-500/30 bg-neutral-200/50 p-3 dark:bg-neutral-800/40">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicts'} require your
            attention
          </div>
        </div>
        <div className="rounded-lg border border-neutral-500/30 bg-neutral-200/50 p-3 dark:bg-neutral-800/40">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Resolved {resolvedCount} of {conflicts.length}
          </div>
          <progress
            className="mt-2 h-1.5 w-full accent-emerald-500"
            max={conflicts.length}
            value={resolvedCount}
            aria-label={`${resolvedCount} of ${conflicts.length} conflicts resolved`}
          />
        </div>
      </div>

      <section aria-labelledby="conflicts-to-resolve-heading">
        <h4
          id="conflicts-to-resolve-heading"
          className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Conflicts to resolve ({conflicts.length})
        </h4>
        <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
          {conflicts.map((conflict) => {
            const isOpen = openConflictKey === conflict.key
            const isRevealed = revealedConflictKeys.has(conflict.key)
            const selected = conflict.occurrences.find(
              (occurrence) => occurrence.id === selections[conflict.key]
            )

            return (
              <div
                key={conflict.key}
                className="overflow-hidden rounded-lg border border-neutral-500/30 bg-neutral-200/50 dark:bg-neutral-800/40"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 p-3 text-left transition ease hover:bg-neutral-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
                  onClick={() => setOpenConflictKey(isOpen ? null : conflict.key)}
                  aria-expanded={isOpen}
                  aria-controls={`conflict-${conflict.key}`}
                >
                  <div className="min-w-0">
                    <div className="break-all font-mono text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {conflict.key}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {selected
                        ? 'A value has been selected'
                        : `Found ${conflict.occurrences.length} times with different values`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={clsx(
                        'rounded-full px-2 py-1 text-xs ring-1 ring-inset',
                        selected
                          ? 'bg-emerald-400/10 text-emerald-600 ring-emerald-400/20 dark:text-emerald-400'
                          : 'bg-amber-400/10 text-amber-600 ring-amber-400/20 dark:text-amber-400'
                      )}
                    >
                      {selected ? 'Resolved' : 'Needs review'}
                    </span>
                    <FaChevronRight
                      className={clsx(
                        'text-neutral-500 transition-transform',
                        isOpen && 'rotate-90'
                      )}
                    />
                  </div>
                </button>

                <Transition
                  show={isOpen}
                  enter="transition-all duration-150 ease-out"
                  enterFrom="max-h-0 opacity-0"
                  enterTo="max-h-96 opacity-100"
                  leave="transition-all duration-100 ease-in"
                  leaveFrom="max-h-96 opacity-100"
                  leaveTo="max-h-0 opacity-0"
                >
                  <div
                    id={`conflict-${conflict.key}`}
                    className="border-t border-neutral-500/20 px-3 py-2"
                  >
                    <div className="mb-2 flex justify-end">
                      <Button
                        variant="outline"
                        onClick={() => toggleRevealed(conflict.key)}
                        aria-label={`${isRevealed ? 'Hide' : 'Reveal'} all values for ${conflict.key}`}
                      >
                        {isRevealed ? <FaEyeSlash /> : <FaEye />}
                        {isRevealed ? 'Hide all' : 'Reveal all'}
                      </Button>
                    </div>
                    <RadioGroup
                      value={selections[conflict.key]}
                      onChange={(id: string) => selectOccurrence(conflict.key, id)}
                    >
                      <RadioGroup.Label className="sr-only">
                        Select an occurrence of {conflict.key}
                      </RadioGroup.Label>
                      <div className="overflow-hidden rounded-md border border-neutral-500/30 divide-y divide-neutral-500/20">
                        {conflict.occurrences.map((occurrence, index) => {
                          const isSelected = selections[conflict.key] === occurrence.id

                          return (
                            <div
                              key={occurrence.id}
                              className={clsx(
                                'flex items-center transition-colors',
                                isSelected
                                  ? 'bg-emerald-400/10'
                                  : 'bg-neutral-100 dark:bg-neutral-900'
                              )}
                            >
                              <RadioGroup.Option value={occurrence.id} as={Fragment}>
                                {({ active, checked }) => (
                                  <div
                                    className={clsx(
                                      'flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-1.5',
                                      active && 'ring-2 ring-inset ring-emerald-500/40'
                                    )}
                                    aria-label={`Value option ${index + 1} for ${conflict.key}`}
                                  >
                                    {checked ? (
                                      <FaDotCircle className="shrink-0 text-emerald-500" />
                                    ) : (
                                      <FaCircle className="shrink-0 text-neutral-400" />
                                    )}
                                    <div className="min-w-0 flex-1 break-all font-mono text-xs text-zinc-700 dark:text-zinc-300 ph-no-capture">
                                      {isRevealed
                                        ? occurrence.value || '(empty value)'
                                        : '••••••••'}
                                    </div>
                                  </div>
                                )}
                              </RadioGroup.Option>
                            </div>
                          )
                        })}
                      </div>
                    </RadioGroup>
                  </div>
                </Transition>
              </div>
            )
          })}
        </div>
      </section>

      <div className="flex flex-col gap-3 border-t border-neutral-500/30 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <Menu as="div" className="relative">
          {({ open }) => (
            <>
              <Menu.Button as={Fragment}>
                <Button variant="secondary">
                  Resolve all conflicts
                  <FaChevronDown className={clsx('transition-transform', open && 'rotate-180')} />
                </Button>
              </Menu.Button>
              <Transition
                enter="transition duration-100 ease-out"
                enterFrom="transform scale-95 opacity-0"
                enterTo="transform scale-100 opacity-100"
                leave="transition duration-75 ease-in"
                leaveFrom="transform scale-100 opacity-100"
                leaveTo="transform scale-95 opacity-0"
                className="absolute bottom-10 left-0 z-20 origin-bottom-left"
              >
                <Menu.Items className="w-64 rounded-md bg-zinc-200 p-1.5 text-sm shadow-xl ring-1 ring-inset ring-neutral-500/20 focus:outline-none dark:bg-zinc-800">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => setAllSelections('first')}
                        className={clsx(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-neutral-600 dark:text-neutral-300',
                          active && 'bg-zinc-100 dark:bg-zinc-700'
                        )}
                      >
                        <FaArrowUp /> Keep first occurrence for all
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => setAllSelections('last')}
                        className={clsx(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-neutral-600 dark:text-neutral-300',
                          active && 'bg-zinc-100 dark:bg-zinc-700'
                        )}
                      >
                        <FaArrowDown /> Keep last occurrence for all
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={resetSelections}
                        className={clsx(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-red-600 dark:text-red-400',
                          active && 'bg-zinc-100 dark:bg-zinc-700'
                        )}
                      >
                        <FaUndo /> Clear all conflict choices
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </>
          )}
        </Menu>

        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button
            variant={allResolved ? 'primary' : 'secondary'}
            onClick={onContinue}
            disabled={!allResolved}
            aria-disabled={!allResolved}
          >
            {allResolved
              ? 'Continue to preview'
              : `Resolve ${remainingCount} remaining ${remainingCount === 1 ? 'conflict' : 'conflicts'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default EnvConflictResolution
