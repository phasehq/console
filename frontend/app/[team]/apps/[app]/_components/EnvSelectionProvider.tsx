'use client'

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'react-toastify'
import { EnvironmentType } from '@/apollo/graphql'

/** URL search param holding the checked env ids, comma-separated */
export const ENV_SELECTION_PARAM = 'envs'

const storageKey = (appId: string) => `phase-env-selection-${appId}`

const readStorage = (appId: string): string[] | null => {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(appId)) ?? 'null')
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

const writeStorage = (appId: string, ids: string[] | null) => {
  try {
    if (ids === null) localStorage.removeItem(storageKey(appId))
    else localStorage.setItem(storageKey(appId), JSON.stringify(ids))
  } catch {
    // Storage can be unavailable (private mode, blocked site data) — the URL still carries it
  }
}

const parseParam = (value: string | null | undefined): string[] | null => {
  const ids = (value ?? '').split(',').filter(Boolean)
  return ids.length > 0 ? ids : null
}

/** Commas are valid in a query string, so keep `envs=a,b` readable */
const toQueryString = (params: URLSearchParams) => params.toString().replace(/%2C/g, ',')

// A full selection is stored as "all" so newly created envs show up automatically
const normalizeSelection = (ids: string[], allEnvIds: string[]) =>
  allEnvIds.every((id) => ids.includes(id)) ? null : ids

/**
 * Applies the env selection to a list of environments. `null` means all envs.
 * Stale ids (e.g. deleted envs) are ignored; if nothing valid remains, all
 * envs are shown.
 */
export const filterEnvSelection = <T extends Partial<EnvironmentType>>(
  envs: T[],
  selection: string[] | null
): T[] => {
  if (!selection) return envs
  const filtered = envs.filter((env) => selection.includes(env.id!))
  return filtered.length > 0 ? filtered : envs
}

type EnvSelectionContextType = {
  /** Checked env ids; null = all envs */
  selectedEnvIds: string[] | null
  /** Checks or unchecks one env. At least one env stays checked. */
  toggleEnv: (envId: string, allEnvIds: string[]) => void
  /** Shows only this env; when it's already the only one shown, restores the previous selection */
  soloEnv: (envId: string, allEnvIds: string[]) => void
  showAllEnvs: () => void
  /** Envs with undeployed changes, which can't be hidden until deployed or discarded */
  setDirtyEnvIds: (ids: Set<string>) => void
  /** Carries an env selection from the URL onto an in-app link */
  withEnvSelection: (href: string) => string
}

const EnvSelectionContext = createContext<EnvSelectionContextType>({
  selectedEnvIds: null,
  toggleEnv: () => {},
  soloEnv: () => {},
  showAllEnvs: () => {},
  setDirtyEnvIds: () => {},
  withEnvSelection: (href) => href,
})

export const useEnvSelection = () => useContext(EnvSelectionContext)

/**
 * Holds which environments the secrets grid shows as full columns. The URL's
 * `?envs=` wins so views can be shared and bookmarked; without it the app's
 * last selection (localStorage) applies.
 */
export const EnvSelectionProvider = ({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) => {
  const searchParams = useSearchParams()
  const urlParam = searchParams?.get(ENV_SELECTION_PARAM)
  const urlSelection = useMemo(() => parseParam(urlParam), [urlParam])

  const [stored, setStored] = useState<string[] | null>(() => readStorage(appId))

  // The layout — and this provider — are reused when navigating between apps
  const loadedAppRef = useRef(appId)
  useEffect(() => {
    if (loadedAppRef.current !== appId) {
      loadedAppRef.current = appId
      setStored(readStorage(appId))
    }
  }, [appId])

  const selectedEnvIds = urlSelection ?? stored

  const dirtyRef = useRef<Set<string>>(new Set())
  const soloRef = useRef<{ envId: string; previous: string[] | null } | null>(null)

  const apply = useCallback(
    (ids: string[] | null) => {
      writeStorage(appId, ids)
      setStored(ids)
      // The native history API syncs with Next's router without a server round trip
      const params = new URLSearchParams(window.location.search)
      if (ids) params.set(ENV_SELECTION_PARAM, ids.join(','))
      else params.delete(ENV_SELECTION_PARAM)
      const qs = toQueryString(params)
      window.history.replaceState(
        null,
        '',
        qs ? `${window.location.pathname}?${qs}` : window.location.pathname
      )
    },
    [appId]
  )

  const shownOf = useCallback(
    (allEnvIds: string[]) => {
      const shown = selectedEnvIds
        ? allEnvIds.filter((id) => selectedEnvIds.includes(id))
        : allEnvIds
      return shown.length > 0 ? shown : allEnvIds
    },
    [selectedEnvIds]
  )

  const hidingIsBlocked = useCallback((envIds: string[]) => {
    if (!envIds.some((id) => dirtyRef.current.has(id))) return false
    toast.warn('Deploy or discard your changes before hiding an environment that has them', {
      toastId: 'env-selection-locked',
    })
    return true
  }, [])

  const toggleEnv = useCallback(
    (envId: string, allEnvIds: string[]) => {
      const shown = shownOf(allEnvIds)
      if (shown.includes(envId)) {
        if (shown.length === 1 || hidingIsBlocked([envId])) return
        soloRef.current = null
        apply(normalizeSelection(shown.filter((id) => id !== envId), allEnvIds))
      } else {
        apply(normalizeSelection([...shown, envId], allEnvIds))
      }
    },
    [shownOf, apply, hidingIsBlocked]
  )

  const soloEnv = useCallback(
    (envId: string, allEnvIds: string[]) => {
      const shown = shownOf(allEnvIds)
      if (shown.length === 1 && shown[0] === envId) {
        const previous = soloRef.current?.envId === envId ? soloRef.current.previous : null
        soloRef.current = null
        apply(previous)
        return
      }
      if (hidingIsBlocked(shown.filter((id) => id !== envId))) return
      soloRef.current = { envId, previous: selectedEnvIds }
      apply(normalizeSelection([envId], allEnvIds))
    },
    [shownOf, apply, hidingIsBlocked, selectedEnvIds]
  )

  const showAllEnvs = useCallback(() => {
    soloRef.current = null
    apply(null)
  }, [apply])

  const setDirtyEnvIds = useCallback((ids: Set<string>) => {
    dirtyRef.current = ids
  }, [])

  const withEnvSelection = useCallback(
    (href: string) => {
      if (!urlSelection) return href
      const [path, query = ''] = href.split('?')
      const params = new URLSearchParams(query)
      params.set(ENV_SELECTION_PARAM, urlSelection.join(','))
      return `${path}?${toQueryString(params)}`
    },
    [urlSelection]
  )

  const value = useMemo(
    () => ({ selectedEnvIds, toggleEnv, soloEnv, showAllEnvs, setDirtyEnvIds, withEnvSelection }),
    [selectedEnvIds, toggleEnv, soloEnv, showAllEnvs, setDirtyEnvIds, withEnvSelection]
  )

  return <EnvSelectionContext.Provider value={value}>{children}</EnvSelectionContext.Provider>
}
