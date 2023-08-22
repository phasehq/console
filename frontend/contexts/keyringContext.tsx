import { OrganisationKeyring } from '@/utils/auth'
import { createContext, useState } from 'react'

interface KeyringContextValue {
  keyring: OrganisationKeyring | null
  setKeyring: (keyring: OrganisationKeyring) => void
}

export const KeyringContext = createContext<KeyringContextValue>({
  keyring: null,
  setKeyring: () => {},
})

interface KeyringProviderProps {
  children: React.ReactNode
}

export const KeyringProvider: React.FC<KeyringProviderProps> = ({ children }) => {
  const [keyring, setKeyring] = useState<OrganisationKeyring | null>(null)

  return (
    <KeyringContext.Provider value={{ keyring, setKeyring }}>{children}</KeyringContext.Provider>
  )
}
