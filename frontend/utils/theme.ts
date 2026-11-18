export type Theme = 'light' | 'dark' | 'system'

// What's on screen: the system theme resolves to the OS setting
export type ResolvedTheme = 'light' | 'dark'

// Cookie (read by the root layout) and localStorage key for the saved theme
export const THEME_KEY = 'color-theme'

export const DEFAULT_THEME: Theme = 'system'

export const parseTheme = (value?: string | null): Theme | null =>
  value === 'light' || value === 'dark' || value === 'system' ? value : null
