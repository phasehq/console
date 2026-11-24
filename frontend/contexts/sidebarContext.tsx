import React, { createContext, useState, useEffect } from 'react'

type SidebarState = 'expanded' | 'collapsed'

interface SidebarContextValue {
  sidebarState: SidebarState
  setUserPreference: (state: SidebarState) => void // Only updates localStorage
}

export const SidebarContext = createContext<SidebarContextValue>({
  sidebarState: 'expanded',
  setUserPreference: () => {},
})

interface SidebarProviderProps {
  children: React.ReactNode
}

const readStoredState = (): SidebarState => {
  try {
    return localStorage.getItem('sidebar-state') === 'collapsed' ? 'collapsed' : 'expanded'
  } catch {
    return 'expanded' // Storage can be blocked
  }
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children }) => {
  const [userPreference, setUserPreference] = useState<SidebarState | null>(null)
  const [sidebarState, setSidebarState] = useState<SidebarState>('expanded')

  useEffect(() => {
    setUserPreference(readStoredState())
  }, [])

  useEffect(() => {
    if (userPreference !== null) {
      try {
        localStorage.setItem('sidebar-state', userPreference)
      } catch {
        // Storage can be blocked; the choice then lasts until the page reloads
      }
      setSidebarState(userPreference) // Sync sidebar state with user preference
    }
  }, [userPreference])

  return (
    <SidebarContext.Provider value={{ sidebarState, setUserPreference }}>
      {children}
    </SidebarContext.Provider>
  )
}
