'use client'

import { ReactNode, createContext, useContext, useEffect, useRef } from 'react'
import { KeyringContext } from '@/contexts/keyringContext'

/**
 * In-memory cache of DECRYPTED secrets data for the app's secrets grid, so
 * revisiting the app or moving between its folders re-renders instantly from
 * the last decrypted snapshot while fresh data loads in the background.
 *
 * Security: entries hold plaintext secret values, so the cache lives only in
 * React state (never persisted), is scoped to this app's layout, and is wiped
 * when navigating to a different app or when the keyring locks.
 */
const SecretsCacheContext = createContext<Map<string, unknown>>(new Map())

export const useSecretsCache = () => useContext(SecretsCacheContext)

export const SecretsCacheProvider = ({
  appId,
  children,
}: {
  appId: string
  children: ReactNode
}) => {
  const cacheRef = useRef(new Map<string, unknown>())
  const { keyring } = useContext(KeyringContext)

  // The layout is reused when navigating between apps
  const prevAppRef = useRef(appId)
  useEffect(() => {
    if (prevAppRef.current !== appId) {
      prevAppRef.current = appId
      cacheRef.current.clear()
    }
  }, [appId])

  useEffect(() => {
    if (!keyring) cacheRef.current.clear()
  }, [keyring])

  return (
    <SecretsCacheContext.Provider value={cacheRef.current}>
      {children}
    </SecretsCacheContext.Provider>
  )
}
