import React, { createContext, useState, useEffect } from 'react'

type Theme = 'light' | 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const storedPrefs = window.localStorage.getItem('color-theme')
    if ((typeof storedPrefs === 'string' && storedPrefs === 'light') || storedPrefs === 'dark') {
      return storedPrefs
    }

    const userMedia = window.matchMedia('(prefers-color-scheme: dark)')
    if (userMedia.matches) {
      return 'dark'
    }
  }

  // If you want to use light theme as the default,
  // return "light" instead
  return 'dark'
}

export const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', setTheme: () => {} })

interface ThemeProviderProps {
  initialTheme?: Theme
  children: React.ReactNode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ initialTheme, children }) => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme())

  const rawSetTheme = (theme: Theme) => {
    const root = window.document.documentElement
    const isDark = theme === 'dark'

    root.classList.remove(isDark ? 'light' : 'dark')
    root.classList.add(theme)

    localStorage.setItem('color-theme', theme)
  }

  if (initialTheme) {
    rawSetTheme(initialTheme)
  }

  useEffect(() => {
    rawSetTheme(theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
