import { ApiEnvironmentEnvTypeChoices, EnvironmentType } from '@/apollo/graphql'
import { stringToHexColor } from '@/utils/copy'

export const sanitizeInput = (value: string) => value.replace(/[^a-zA-Z0-9\-_]/g, '')

// Stoplight defaults for the standard envs (the color picker's green, yellow and red)
const DEFAULT_ENV_COLORS: Record<string, string> = {
  [ApiEnvironmentEnvTypeChoices.Dev]: '#22c55e',
  [ApiEnvironmentEnvTypeChoices.Staging]: '#eab308',
  [ApiEnvironmentEnvTypeChoices.Prod]: '#ef4444',
}

/** The color an env shows without one set: stoplight for dev/staging/prod, else from its name */
export const defaultEnvColor = (env: Partial<EnvironmentType>) =>
  DEFAULT_ENV_COLORS[env.envType?.toUpperCase() ?? ''] ?? stringToHexColor(env.name ?? '')

/** Explicit env color, or the default above */
export const envColor = (env: Partial<EnvironmentType>) => env.color || defaultEnvColor(env)
