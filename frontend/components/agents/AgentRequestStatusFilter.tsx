'use client'

import {
  AgentFilterMenu,
  AgentFilterOption,
  AgentFilterSection,
} from '@/components/agents/AgentFilterMenu'

const REQUEST_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending', color: 'text-amber-500' },
  { value: 'approved', label: 'Approved', color: 'text-emerald-500' },
  { value: 'denied', label: 'Denied', color: 'text-red-500' },
  { value: 'expired', label: 'Expired', color: 'text-neutral-500' },
  { value: 'cancelled', label: 'Cancelled', color: 'text-neutral-500' },
]

/** Not a status: the pending requests the member may resolve. */
export const REQUEST_QUEUE_FILTER = 'queue'

export function AgentRequestStatusFilter({
  value,
  onChange,
  defaultValue = '',
  showQueue = false,
}: {
  value: string
  onChange: (value: string) => void
  /** What Reset returns to; the filter reads as active away from it. */
  defaultValue?: string
  /** Offer "Waiting for you", for members who can resolve requests. */
  showQueue?: boolean
}) {
  return (
    <AgentFilterMenu
      title={showQueue ? 'Filter Agent requests' : 'Filter Agent requests by status'}
      active={value !== defaultValue}
      onReset={() => onChange(defaultValue)}
    >
      {showQueue && (
        <AgentFilterSection title="Show">
          <div className="flex flex-wrap gap-2">
            <AgentFilterOption
              selected={value === REQUEST_QUEUE_FILTER}
              color="text-amber-500"
              onClick={() => onChange(REQUEST_QUEUE_FILTER)}
            >
              Waiting for you
            </AgentFilterOption>
            <AgentFilterOption selected={value === ''} onClick={() => onChange('')}>
              All requests
            </AgentFilterOption>
          </div>
        </AgentFilterSection>
      )}
      <AgentFilterSection title="Status">
        <div className="flex flex-wrap gap-2">
          {REQUEST_STATUS_OPTIONS.map((option) => (
            <AgentFilterOption
              key={option.value}
              selected={value === option.value}
              color={option.color}
              // A second click clears the status.
              onClick={() => onChange(value === option.value ? '' : option.value)}
            >
              {option.label}
            </AgentFilterOption>
          ))}
        </div>
      </AgentFilterSection>
    </AgentFilterMenu>
  )
}
