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
import { toast } from 'react-toastify'
import { EnvironmentType } from '@/apollo/graphql'

const storageKey = (appId: string) => `phase-env-selection-${appId}`

const readStorage = (appId: string): string[] | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(appId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

const writeStorage = (appId: string, ids: string[] | null) => {
  if (typeof window === 'undefined') return
  if (ids === null) localStorage.removeItem(storageKey(appId))
  else localStorage.setItem(storageKey(appId), JSON.stringify(ids))
}

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
  /** Env ids shown in the cross-env view; null = all envs */
  selectedEnvIds: string[] | null
  setSelection: (ids: string[] | null) => void
  /** Alt+Click semantics: from "all", start a selection with just this env */
  toggleEnv: (envId: string) => void
  /** Set while the cross-env view has unsaved changes — a selection change
   *  would reset client state and lose them */
  setSelectionLocked: (locked: boolean) => void
}

const EnvSelectionContext = createContext<EnvSelectionContextType>({
  selectedEnvIds: null,
  setSelection: () => {},
  toggleEnv: () => {},
  setSelectionLocked: () => {},
})

export const useEnvSelection = () => useContext(EnvSelectionContext)

/**
 * Holds which environments are shown in the cross-env "All Environments"
 * view, shared between the bottom tab bar (menu + Alt+Click) and the
 * cross-env editor. Persisted per app in localStorage.
 */
export const EnvSelectionProvider = ({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) => {
  const [selectedEnvIds, _setSelectedEnvIds] = useState<string[] | null>(() => readStorage(appId))
  const lockedRef = useRef(false)
  const loadedAppRef = useRef(appId)

  // The layout — and this provider — are reused when navigating between
  // different apps, so reload the stored selection when the app changes.
  useEffect(() => {
    if (loadedAppRef.current !== appId) {
      loadedAppRef.current = appId
      _setSelectedEnvIds(readStorage(appId))
    }
  }, [appId])

  const guardLocked = () => {
    if (!lockedRef.current) return false
    toast.warn('Deploy or discard your changes before changing the environment selection', {
      toastId: 'env-selection-locked',
    })
    return true
  }

  const setSelection = useCallback(
    (ids: string[] | null) => {
      if (guardLocked()) return
      _setSelectedEnvIds(ids)
      writeStorage(appId, ids)
    },
    [appId]
  )

  const toggleEnv = useCallback(
    (envId: string) => {
      if (guardLocked()) return
      let next: string[] | null
      if (selectedEnvIds === null) {
        next = [envId]
      } else if (selectedEnvIds.includes(envId)) {
        const remaining = selectedEnvIds.filter((id) => id !== envId)
        // Deselecting the last env resets to "all"
        next = remaining.length > 0 ? remaining : null
      } else {
        next = [...selectedEnvIds, envId]
      }
      _setSelectedEnvIds(next)
      writeStorage(appId, next)
    },
    [appId, selectedEnvIds]
  )

  const setSelectionLocked = useCallback((locked: boolean) => {
    lockedRef.current = locked
  }, [])

  const value = useMemo(
    () => ({ selectedEnvIds, setSelection, toggleEnv, setSelectionLocked }),
    [selectedEnvIds, setSelection, toggleEnv, setSelectionLocked]
  )

  return <EnvSelectionContext.Provider value={value}>{children}</EnvSelectionContext.Provider>
}
