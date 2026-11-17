import React, { createContext, useState, useEffect } from 'react'

type SidebarState = 'expanded' | 'collapsed'

interface SidebarContextValue {
  sidebarState: SidebarState
  setUserPreference: (state: SidebarState) => void // Only updates localStorage
  isAutoCollapsed: boolean // Viewport is too narrow for the expanded sidebar
}

export const SidebarContext = createContext<SidebarContextValue>({
  sidebarState: 'expanded',
  setUserPreference: () => {},
  isAutoCollapsed: false,
})

interface SidebarProviderProps {
  children: React.ReactNode
}

export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children }) => {
  const [userPreference, setUserPreference] = useState<SidebarState | null>(null)
  const [sidebarState, setSidebarState] = useState<SidebarState>('expanded')
  const [isAutoCollapsed, setIsAutoCollapsed] = useState(false)

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

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024) {
        setIsAutoCollapsed(true) // Auto-collapse
      } else {
        setIsAutoCollapsed(false) // Reset auto-collapse
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <SidebarContext.Provider value={{ sidebarState, setUserPreference, isAutoCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}
