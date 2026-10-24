export type Theme = 'light' | 'dark'

// Cookie (read by the root layout) and localStorage key for the saved theme
export const THEME_KEY = 'color-theme'

export const DEFAULT_THEME: Theme = 'dark'

export const parseTheme = (value?: string | null): Theme | null =>
  value === 'light' || value === 'dark' ? value : null
