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

export function AgentRequestStatusFilter({
  value,
  onChange,
  reviewRequested = false,
  onReviewRequestedChange,
}: {
  value: string
  onChange: (value: string) => void
  /** Only requests the member was asked to review. */
  reviewRequested?: boolean
  onReviewRequestedChange?: (value: boolean) => void
}) {
  return (
    <AgentFilterMenu
      title="Filter change requests"
      active={value !== '' || reviewRequested}
      onReset={() => {
        onChange('')
        onReviewRequestedChange?.(false)
      }}
    >
      {onReviewRequestedChange && (
        <AgentFilterSection title="Review">
          <div className="flex flex-wrap gap-2">
            <AgentFilterOption
              selected={reviewRequested}
              color="text-emerald-500"
              onClick={() => onReviewRequestedChange(!reviewRequested)}
            >
              Asked of you
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
