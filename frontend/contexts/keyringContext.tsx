import { createContext, useContext, useEffect, useState } from 'react'
import { organisationContext } from './organisationContext'
import { OrganisationKeyring } from '@/utils/crypto'

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

  const { activeOrganisation } = useContext(organisationContext)

  useEffect(() => {
    setKeyring(null)
  }, [activeOrganisation?.id])

  return (
    <KeyringContext.Provider value={{ keyring, setKeyring }}>{children}</KeyringContext.Provider>
  )
}
