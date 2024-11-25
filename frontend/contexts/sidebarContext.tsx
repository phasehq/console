import React, { createContext, useState, useEffect } from 'react'

type SidebarState = 'expanded' | 'collapsed'

interface SidebarContextValue {
  sidebarState: SidebarState
  setSidebarState: (state: SidebarState) => void
}

export const SidebarContext = createContext<SidebarContextValue>({
  sidebarState: 'expanded', // Default to expanded before loading
  setSidebarState: () => {},
})

interface SidebarProviderProps {
  children: React.ReactNode
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children }) => {
  const [sidebarState, setSidebarState] = useState<SidebarState | null>(null)

  useEffect(() => {
    const storedState = localStorage.getItem('sidebar-state') as SidebarState
    setSidebarState(storedState === 'collapsed' ? 'collapsed' : 'expanded')
  }, [])

  useEffect(() => {
    if (sidebarState !== null) {
      localStorage.setItem('sidebar-state', sidebarState)
    }
  }, [sidebarState])

  // Don't render context until the initial state is determined
  if (sidebarState === null) {
    return null
  }

  return (
    <SidebarContext.Provider value={{ sidebarState, setSidebarState }}>
      {children}
    </SidebarContext.Provider>
  )
}
