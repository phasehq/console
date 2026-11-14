/**
 * Provider presets: well-known services that pre-fill the custom HTTP form.
 *
 * A preset carries a complete definition without any secret. It pre-fills the
 * form only; the member still names the Connection and enters the secrets.
 */

import {
  customConnectionFormFromDefinition,
  emptyCustomConnectionForm,
  newHostRow,
  type CustomConnectionForm,
} from '@/utils/agents/customConnectionForm'
import { parseHttpDefinition, type HttpDefinition } from '@/utils/agents/httpDefinition'

export type ConnectionPreset = {
  id: string
  name: string
  description: string
  docsUrl: string
  category: string
  /** Hosts the preset fixes; empty when the member enters the host. */
  hostsEditable: boolean
  /** The label of each secret input, by secret field name. */
  labels: Record<string, string>
  definition: HttpDefinition
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Read presets from the query; anything not shaped like one is left out. */
export const readPresets = (value: unknown): ConnectionPreset[] => {
  if (!Array.isArray(value)) return []
  const presets: ConnectionPreset[] = []
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue
    const definition = parseHttpDefinition(raw.definition)
    if (!definition) continue
    const labels: Record<string, string> = {}
    if (isRecord(raw.labels))
      for (const [field, label] of Object.entries(raw.labels))
        if (typeof label === 'string') labels[field] = label
    presets.push({
      id: raw.id,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      docsUrl: typeof raw.docsUrl === 'string' ? raw.docsUrl : '',
      category: typeof raw.category === 'string' ? raw.category : 'other',
      hostsEditable: raw.hostsEditable === true,
      labels,
      definition,
    })
  }
  return presets
}

const CATEGORY_LABELS: Record<string, string> = {
  ai: 'AI',
  cloud: 'Cloud',
  communication: 'Communication',
  mcp: 'MCP',
  observability: 'Observability',
  payments: 'Payments',
  'project-management': 'Project management',
  'source-control': 'Source control',
}

export const presetCategoryLabel = (category: string): string =>
  CATEGORY_LABELS[category] ??
  `${category.charAt(0).toUpperCase()}${category.slice(1).replace(/-/g, ' ')}`

/** Presets matching a search, by name, description or category. */
export const searchPresets = (presets: ConnectionPreset[], query: string): ConnectionPreset[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return presets
  return presets.filter((preset) => {
    const haystack =
      `${preset.name} ${preset.description} ${preset.id} ${presetCategoryLabel(preset.category)}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

/** Presets grouped by category, categories A to Z and presets A to Z within each. */
export const groupPresets = (
  presets: ConnectionPreset[]
): Array<{ category: string; label: string; presets: ConnectionPreset[] }> => {
  const groups = new Map<string, ConnectionPreset[]>()
  for (const preset of presets)
    groups.set(preset.category, [...(groups.get(preset.category) ?? []), preset])
  return Array.from(groups.entries())
    .map(([category, members]) => ({
      category,
      label: presetCategoryLabel(category),
      presets: [...members].sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

/** A host the form accepts, standing in while the member has not entered one. */
const PLACEHOLDER_HOST = { match: 'exact' as const, value: 'host.example.com', port: 443 }

/**
 * The form a preset pre-fills. The Connection name is the member's to choose,
 * so it starts from `name`. Returns null when the form cannot express the
 * preset exactly, in which case the member starts from scratch.
 */
export const presetForm = (preset: ConnectionPreset, name: string): CustomConnectionForm | null => {
  const needsHost = preset.definition.hosts.length === 0
  const definition: HttpDefinition = needsHost
    ? { ...preset.definition, hosts: [PLACEHOLDER_HOST] }
    : preset.definition
  const form = customConnectionFormFromDefinition(name, definition)
  if (!form) return null
  // The member types the host: nothing of the stand-in remains.
  return needsHost ? { ...form, hosts: [newHostRow()] } : form
}

/** A form with nothing filled in, for "Start from scratch". */
export const scratchForm = (name: string): CustomConnectionForm => emptyCustomConnectionForm(name)

/** Whether the host inputs are fixed by the preset. */
export const presetLocksHosts = (preset: ConnectionPreset | null): boolean =>
  !!preset && !preset.hostsEditable && preset.definition.hosts.length > 0
