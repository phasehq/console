'use client'

import clsx from 'clsx'
import { Input } from '@/components/common/Input'
import { AgentSelect } from '@/components/agents/AgentSelect'
import { HTTP_METHODS } from '@/utils/agents/accessPolicy'
import {
  DURATION_CHOICES,
  DURATION_UNITS,
  accessEndsValue,
  describeDuration,
  toLocalInputValue,
  type AccessEnds,
  type DurationChoice,
  type DurationUnit,
  type GrantDuration,
} from '@/utils/agents/accessDuration'

/** A short row of mutually exclusive choices, read as one radio group. */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string; selectedClass?: string }>
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-inset ring-neutral-500/40"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={clsx(
              'px-2.5 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500',
              selected
                ? option.selectedClass ??
                    'bg-zinc-900 text-white dark:bg-emerald-400/20 dark:text-emerald-300'
                : 'text-neutral-600 hover:bg-neutral-500/10 dark:text-neutral-400',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The HTTP methods as toggles, in their usual order; any number may be on. */
export function MethodToggles({
  label,
  methods,
  onChange,
}: {
  label: string
  methods: string[]
  onChange: (methods: string[]) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {HTTP_METHODS.map((method) => {
        const selected = methods.includes(method)
        return (
          <button
            key={method}
            type="button"
            aria-pressed={selected}
            onClick={() =>
              onChange(
                HTTP_METHODS.filter((candidate) =>
                  candidate === method ? !selected : methods.includes(candidate)
                )
              )
            }
            className={clsx(
              'rounded-full px-2 py-0.5 font-mono text-2xs ring-1 ring-inset transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
              selected
                ? 'bg-zinc-900 text-white ring-zinc-900 dark:bg-emerald-400/20 dark:text-emerald-300 dark:ring-emerald-400/30'
                : 'text-neutral-600 ring-neutral-500/40 hover:bg-neutral-500/10 dark:text-neutral-400'
            )}
          >
            {method}
          </button>
        )
      })}
    </div>
  )
}

const ENDS_OPTIONS = [
  { value: 'forever', label: 'Until revoked' },
  ...DURATION_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
  { value: 'custom', label: 'Custom date and time' },
]

/**
 * "Access ends" on a grant: until revoked, a standard span from now, or an
 * exact time. The value maps to an ISO time with `accessEndsValue`.
 */
export function AccessEndsField({
  id,
  value,
  onChange,
  label = 'Access ends',
}: {
  id: string
  value: AccessEnds
  onChange: (value: AccessEnds) => void
  label?: string
}) {
  const { expiresAt, problem } = accessEndsValue(value)
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs text-neutral-500">
        {label}
      </label>
      <AgentSelect
        id={id}
        value={value.choice}
        onChange={(choice) => onChange({ ...value, choice: choice as DurationChoice })}
        options={ENDS_OPTIONS}
      />
      {value.choice === 'custom' && (
        <Input
          id={`${id}-custom`}
          type="datetime-local"
          aria-label={`${label}, custom date and time`}
          min={toLocalInputValue(new Date())}
          value={value.custom}
          setValue={(custom) => onChange({ ...value, custom })}
        />
      )}
      <p className="text-xs text-neutral-500" role={problem && value.custom ? 'alert' : undefined}>
        {value.choice === 'forever'
          ? 'Access lasts until a member revokes it.'
          : expiresAt
            ? `Access ends ${new Date(expiresAt).toLocaleString()}.`
            : problem}
      </p>
    </div>
  )
}

/**
 * "Grant access for" in an approval: starts at what the request asked for.
 * `allowUntilRevoked` is false where access always ends.
 */
export function GrantDurationField({
  id,
  value,
  onChange,
  requestedSeconds,
  allowUntilRevoked,
  problem,
}: {
  id: string
  value: GrantDuration
  onChange: (value: GrantDuration) => void
  requestedSeconds: number | null | undefined
  allowUntilRevoked: boolean
  problem?: string
}) {
  const standard = DURATION_CHOICES.some((choice) => choice.seconds === requestedSeconds)
  const options = [
    ...(typeof requestedSeconds === 'number' && !standard
      ? [{ value: 'requested', label: `As requested (${describeDuration(requestedSeconds)})` }]
      : []),
    ...DURATION_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
    { value: 'custom', label: 'Custom' },
    ...(allowUntilRevoked ? [{ value: 'forever', label: 'Until revoked' }] : []),
  ]
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs text-neutral-500">
        Grant access for
      </label>
      <AgentSelect
        id={id}
        value={value.choice}
        onChange={(choice) => onChange({ ...value, choice: choice as DurationChoice })}
        options={options}
      />
      {value.choice === 'custom' && (
        <div className="flex items-start gap-2">
          <div className="w-28 shrink-0">
            <Input
              id={`${id}-amount`}
              aria-label="Custom duration"
              inputMode="numeric"
              maxLength={9}
              value={value.amount}
              setValue={(amount) => onChange({ ...value, amount: amount.replace(/[^0-9]/g, '') })}
            />
          </div>
          <div className="min-w-0 flex-1">
            <AgentSelect
              id={`${id}-unit`}
              value={value.unit}
              onChange={(unit) => onChange({ ...value, unit: unit as DurationUnit })}
              options={DURATION_UNITS.map((unit) => ({ value: unit.value, label: unit.label }))}
            />
          </div>
        </div>
      )}
      <p className="text-xs text-neutral-500">
        {typeof requestedSeconds === 'number'
          ? `The Agent asked for ${describeDuration(requestedSeconds)}. `
          : ''}
        {!allowUntilRevoked && 'This access always ends. '}
        {value.choice === 'forever' && 'Access lasts until a member revokes it.'}
      </p>
      {problem && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  )
}
