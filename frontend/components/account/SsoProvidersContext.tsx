'use client'

import { createContext, useContext } from 'react'

// The SSO_PROVIDERS env var is server-only; the account layout reads it and
// provides it here so the (client) sign-in-methods UI can gate providers by
// the same list the login page uses.
const SsoProvidersContext = createContext<string[]>([])

export const SsoProvidersProvider = ({
  value,
  children,
}: {
  value: string[]
  children: React.ReactNode
}) => <SsoProvidersContext.Provider value={value}>{children}</SsoProvidersContext.Provider>

export const useSsoProviders = () => useContext(SsoProvidersContext)
