import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { organisationContext } from './organisationContext'
import { OrganisationKeyring } from '@/utils/crypto'

interface KeyringContextValue {
  keyring: OrganisationKeyring | null
  setKeyring: (keyring: OrganisationKeyring, organisationId: string) => void
}

export const KeyringContext = createContext<KeyringContextValue>({
  keyring: null,
  setKeyring: () => {},
})

interface KeyringProviderProps {
  children: React.ReactNode
}

type OrganisationKeyringEntry = {
  organisationId: string
  keyring: OrganisationKeyring
}

export const KeyringProvider: React.FC<KeyringProviderProps> = ({ children }) => {
  const [entry, setEntry] = useState<OrganisationKeyringEntry | null>(null)

  const { activeOrganisation } = useContext(organisationContext)
  const activeOrganisationId = activeOrganisation?.id ?? null

  // setKeyring usually runs after an await, so it reads the active org from a ref, not a closure
  const activeOrganisationIdRef = useRef(activeOrganisationId)
  useLayoutEffect(() => {
    activeOrganisationIdRef.current = activeOrganisationId
  }, [activeOrganisationId])

  // Drop the previous org's keys from memory after a switch
  useEffect(() => {
    setEntry((current) => (current?.organisationId === activeOrganisationId ? current : null))
  }, [activeOrganisationId])

  const setKeyring = useCallback((keyring: OrganisationKeyring, organisationId: string) => {
    // An unlock that finishes after an org switch must not install its keys for the new org
    if (organisationId !== activeOrganisationIdRef.current) return
    setEntry({ organisationId, keyring })
  }, [])

  // Derived during render, so no render pairs the active org with another org's keyring
  const keyring = entry?.organisationId === activeOrganisationId ? entry.keyring : null

  return (
    <KeyringContext.Provider value={{ keyring, setKeyring }}>{children}</KeyringContext.Provider>
  )
}
