'use client'

import { useId, useMemo, useState } from 'react'
import { useQuery } from '@apollo/client'
import { FaArrowRight, FaPlus } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import GetAgentConnectionPresets from '@/graphql/queries/agents/getAgentConnectionPresets.gql'
import {
  groupPresets,
  readPresets,
  searchPresets,
  type ConnectionPreset,
} from '@/utils/agents/connectionPresets'

/**
 * The first step of a custom Connection: a well-known provider that
 * pre-fills the form, or a blank form. Presets are grouped by category.
 */
export function AgentPresetPicker({
  organisationId,
  onChoose,
}: {
  organisationId: string
  /** A preset, or null to start from scratch. */
  onChoose: (preset: ConnectionPreset | null) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const { data, loading, error } = useQuery(GetAgentConnectionPresets, {
    variables: { organisationId },
    skip: !organisationId,
  })
  const presets = useMemo(() => readPresets(data?.agentConnectionPresets), [data])
  const groups = useMemo(() => groupPresets(searchPresets(presets, query)), [presets, query])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-neutral-500">
          Start from a provider to fill in its hosts and where its secret goes, or define your own.
          You still name the Connection and enter the secret.
        </p>
        <Button type="button" variant="secondary" icon={FaPlus} onClick={() => onChoose(null)}>
          Start from scratch
        </Button>
      </div>
      {presets.length > 0 && (
        <Input
          id={`${id}-search`}
          aria-label="Search providers"
          placeholder="Search providers"
          value={query}
          setValue={setQuery}
          maxLength={64}
          autoComplete="off"
        />
      )}
      {loading && presets.length === 0 && (
        <p role="status" className="text-xs text-neutral-500">
          Loading providers
        </p>
      )}
      {error && presets.length === 0 && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          Providers could not be loaded. You can still start from scratch.
        </p>
      )}
      {presets.length > 0 && groups.length === 0 && (
        <p className="text-xs text-neutral-500">No provider matches that search.</p>
      )}
      <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
        {groups.map((group) => (
          <section key={group.category} aria-label={group.label} className="space-y-2">
            <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
              {group.label}
            </h4>
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.presets.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(preset)}
                    className="flex h-full w-full items-start justify-between gap-2 rounded-lg border border-neutral-500/20 bg-neutral-500/5 px-3 py-2 text-left transition hover:border-emerald-500/50 hover:bg-neutral-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{preset.name}</span>
                      <span className="mt-0.5 line-clamp-2 block text-2xs text-neutral-500">
                        {preset.description}
                      </span>
                    </span>
                    <FaArrowRight
                      aria-hidden="true"
                      className="mt-1 size-3 shrink-0 text-neutral-500"
                    />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
