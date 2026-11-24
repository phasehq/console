/**
 * How an app's grid was laid out the last time it was open, kept in this browser so
 * the next loading state stands in the same columns and rows. Counts, sizes and
 * colours only: never a name, key or value.
 */
export type GridShape = {
  /** Env columns in order; a name's length stands in for the name. `deleted`: scheduled for deletion */
  envs: { id: string; color: string; nameChars: number; deleted?: true }[]
  /** The key column's fit (`gridLayout`'s inputs that come from the rows) */
  longestKeyChars: number
  longestFolderChars: number
  maxRowDepth: number
  maxTagCount: number
  maxRowNumber: number
  trailingRem: number
  /** The first rows from the top: f folder, g group header, d dynamic key, r rotating key, s secret */
  rows: string
}

/** More rows than a tall screen shows */
export const GRID_SHAPE_ROWS = 60
const MAX_ENVS = 64

const storageKey = (appId: string) => `phase-grid-shape-${appId}`

const count = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0

/** A stored shape, or null if it isn't one: storage holds whatever was last written there */
export const parseGridShape = (raw: unknown): GridShape | null => {
  if (!raw || typeof raw !== 'object') return null
  const stored = raw as Record<string, unknown>
  if (!Array.isArray(stored.envs) || typeof stored.rows !== 'string') return null
  if (!/^[fgdrs]*$/.test(stored.rows)) return null

  const envs = stored.envs.slice(0, MAX_ENVS).flatMap((env) => {
    if (!env || typeof env.id !== 'string') return []
    // The colour goes into a style, so only a plain hex is let through
    const color = /^#[0-9a-f]{3,8}$/i.test(env.color) ? (env.color as string) : ''
    return [
      {
        id: env.id as string,
        color,
        nameChars: count(env.nameChars, 64),
        ...(env.deleted === true ? { deleted: true as const } : {}),
      },
    ]
  })
  if (envs.length === 0) return null

  return {
    envs,
    longestKeyChars: count(stored.longestKeyChars, 256),
    longestFolderChars: count(stored.longestFolderChars, 64),
    maxRowDepth: count(stored.maxRowDepth, 32),
    maxTagCount: count(stored.maxTagCount, 64),
    maxRowNumber: count(stored.maxRowNumber, 100000),
    trailingRem: count(stored.trailingRem, 32),
    rows: stored.rows.slice(0, GRID_SHAPE_ROWS),
  }
}

export const readGridShape = (appId: string): GridShape | null => {
  try {
    return parseGridShape(JSON.parse(window.localStorage.getItem(storageKey(appId)) ?? 'null'))
  } catch {
    return null
  }
}

export const writeGridShape = (appId: string, shapeJson: string) => {
  try {
    window.localStorage.setItem(storageKey(appId), shapeJson)
  } catch {
    // Storage can be full or blocked; the next load then starts from the default shape
  }
}

/** A first visit's stand-in: a few columns of plain secrets */
export const defaultGridShape = (trailingRem: number): GridShape => ({
  envs: [0, 1, 2].map(() => ({ id: '', color: '', nameChars: 11 })),
  longestKeyChars: 24,
  longestFolderChars: 0,
  maxRowDepth: 0,
  maxTagCount: 0,
  maxRowNumber: 14,
  trailingRem,
  rows: 's'.repeat(14),
})
