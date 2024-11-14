import React, { createContext, useState, useEffect } from 'react'

type SidebarState = 'expanded' | 'collapsed'

interface SidebarContextValue {
  sidebarState: SidebarState
  setSidebarState: (state: SidebarState) => void
}

const getInitialState = (): SidebarState => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const storedState = window.localStorage.getItem('sidebar-state')
    if (storedState === 'collapsed') {
      return 'collapsed'
    }
  }
  return 'expanded' // Default state is expanded
}

export const SidebarContext = createContext<SidebarContextValue>({
  sidebarState: 'expanded',
  setSidebarState: () => {},
})

interface SidebarProviderProps {
  children: React.ReactNode
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children }) => {
  const [sidebarState, setSidebarState] = useState<SidebarState>(getInitialState())

  useEffect(() => {
    localStorage.setItem('sidebar-state', sidebarState)
  }, [sidebarState])

  return (
    <SidebarContext.Provider value={{ sidebarState, setSidebarState }}>
      {children}
    </SidebarContext.Provider>
  )
}