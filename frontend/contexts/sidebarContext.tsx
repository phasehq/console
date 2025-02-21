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

export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children }) => {
  const [userPreference, setUserPreference] = useState<SidebarState | null>(null)
  const [sidebarState, setSidebarState] = useState<SidebarState>('expanded')

  useEffect(() => {
    const storedState = localStorage.getItem('sidebar-state') as SidebarState
    setUserPreference(storedState === 'collapsed' ? 'collapsed' : 'expanded')
  }, [])

  useEffect(() => {
    if (userPreference !== null) {
      localStorage.setItem('sidebar-state', userPreference)
      setSidebarState(userPreference) // Sync sidebar state with user preference
    }
  }, [userPreference])

  return (
    <SidebarContext.Provider value={{ sidebarState, setUserPreference }}>
      {children}
    </SidebarContext.Provider>
  )
}
