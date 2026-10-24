import React, { createContext, useCallback, useState, useEffect } from 'react'
import { DEFAULT_THEME, THEME_KEY, Theme, parseTheme } from '@/utils/theme'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', setTheme: () => {} })

interface ThemeProviderProps {
  savedTheme: Theme | null
  children: React.ReactNode
}

const readStoredTheme = () => {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY))
  } catch {
    return null // Storage can be blocked
  }
}

const saveTheme = (theme: Theme) => {
  const secure = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${THEME_KEY}=${theme}; path=/; max-age=31536000; samesite=lax${secure}`

  // Older versions read localStorage, so a rollback keeps the user's choice
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Storage can be blocked; the cookie is enough
  }
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ savedTheme, children }) => {
  const [theme, setThemeState] = useState<Theme>(savedTheme ?? DEFAULT_THEME)

  const setTheme = useCallback((theme: Theme) => {
    setThemeState(theme)
    saveTheme(theme)
  }, [])

  useEffect(() => {
    if (savedTheme) {
      saveTheme(savedTheme) // Renews the cookie
    } else {
      // Adopts a theme saved before the cookie existed
      const storedTheme = readStoredTheme()
      if (storedTheme) setTheme(storedTheme)
    }
  }, [savedTheme, setTheme])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove(theme === 'dark' ? 'light' : 'dark')
    root.classList.add(theme)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
