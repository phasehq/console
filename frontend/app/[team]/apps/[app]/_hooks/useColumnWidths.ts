import { useCallback, useState } from 'react'

const STORAGE_KEY = 'phase-env-column-widths'

const readWidths = (): Record<string, number> => {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Storage id for an app's key column (env columns use their env id) */
export const keyColumnId = (appId: string) => `key:${appId}`

/**
 * Grid column widths the user dragged — by env id, or `keyColumnId(appId)` —
 * remembered in this browser. An env keeps its width while hidden, so
 * checking it again restores it.
 */
export const useColumnWidths = () => {
  const [widths, setWidths] = useState<Record<string, number>>(readWidths)

  /** null clears the column's width, back to the default */
  const setWidth = useCallback((columnId: string, px: number | null) => {
    setWidths((prev) => {
      const next = { ...prev }
      if (px === null) delete next[columnId]
      else next[columnId] = Math.round(px)
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Storage can be full or blocked; the width still applies for this visit
      }
      return next
    })
  }, [])

  return { widths, setWidth }
}
