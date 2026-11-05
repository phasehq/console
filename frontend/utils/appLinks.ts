/** URL search param holding the secrets grid's shown env ids, comma-separated */
export const ENV_SELECTION_PARAM = 'envs'

/**
 * Link to an app's secrets grid, optionally narrowed to one env, opened at a folder,
 * and pointing at a secret, which the grid scrolls to and flashes.
 */
export const appSecretsUrl = (
  team: string,
  appId: string,
  {
    envId,
    path,
    secretId,
  }: { envId?: string | null; path?: string | null; secretId?: string | null } = {}
): string => {
  const folders = (path ?? '')
    .split('/')
    .filter(Boolean)
    .map((folder) => `/${encodeURIComponent(folder)}`)
    .join('')
  const params = new URLSearchParams()
  if (envId) params.set(ENV_SELECTION_PARAM, envId)
  if (secretId) params.set('secret', secretId)
  const query = params.toString()
  return `/${team}/apps/${appId}${folders}${query ? `?${query}` : ''}`
}
