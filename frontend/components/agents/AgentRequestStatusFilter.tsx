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
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <AgentFilterMenu
      title="Filter Agent requests by status"
      active={value !== ''}
      onReset={() => onChange('')}
    >
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
