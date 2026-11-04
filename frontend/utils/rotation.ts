export interface RotationConfigField {
  id: string
  label: string
  required?: boolean
  field_type?: string
  default?: unknown
  help_text?: string
  help_url?: string
  choices?: string[]
  resource_type?: string
  depends_on?: string[]
  masked?: boolean
}

export const isConfigValueMissing = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0)

export const findMissingRequiredField = (
  config: Record<string, unknown>,
  fields: RotationConfigField[]
): RotationConfigField | undefined =>
  fields.find((f) => f.required && isConfigValueMissing(config[f.id]))

export const findInvalidJsonField = (
  config: Record<string, unknown>,
  fields: RotationConfigField[]
): RotationConfigField | undefined =>
  fields.find((f) => {
    if (f.field_type !== 'json') return false
    const raw = config[f.id]
    if (typeof raw !== 'string' || raw.trim() === '') return false
    try {
      JSON.parse(raw)
      return false
    } catch {
      return true
    }
  })

// Coerce only at submit so trailing commas / "5." don't get eaten mid-typing.
export const coerceConfigForSubmit = (
  input: Record<string, unknown>,
  fields: RotationConfigField[]
): Record<string, unknown> => {
  const types = new Map(fields.map((f) => [f.id, f.field_type ?? 'string']))
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw !== 'string') {
      out[key] = raw
      continue
    }
    const trimmed = raw.trim()
    const fieldType = types.get(key)
    if (fieldType === 'list') {
      out[key] = trimmed
        ? trimmed
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      continue
    }
    if (fieldType === 'int') {
      if (trimmed === '') continue
      const n = Number(trimmed)
      out[key] = Number.isFinite(n) ? n : raw
      continue
    }
    if (fieldType === 'json') {
      if (trimmed === '') continue
      try {
        out[key] = JSON.parse(trimmed)
      } catch {
        out[key] = raw
      }
      continue
    }
    out[key] = raw
  }
  return out
}

export const configFieldDisplayValue = (field: RotationConfigField, value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (field.field_type === 'json' && typeof value !== 'string')
    return JSON.stringify(value, null, 2)
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}
