/** URL search param holding the secrets grid's shown env ids, comma-separated */
export const ENV_SELECTION_PARAM = 'envs'

/** The app's own pages under /[team]/apps/[app]/, which a root folder of the same name would be taken for */
export const RESERVED_APP_ROUTE_SEGMENTS = ['access', 'environments', 'logs', 'settings', 'syncing']

/** Goes ahead of a folder path that starts with one of those names, so the grid opens and not the page */
export const FOLDER_ROUTE_ESCAPE = '~'

/** A folder path as the grid's URL carries it after the app's own: empty for the root */
export const appFolderRoute = (path?: string | null): string => {
  const folders = (path ?? '').split('/').filter(Boolean)
  if (folders.length === 0) return ''
  // A root folder named `~` itself (the API takes any name) is escaped too, or it would read back as the escape
  const escape =
    folders[0] === FOLDER_ROUTE_ESCAPE ||
    RESERVED_APP_ROUTE_SEGMENTS.includes(folders[0].toLowerCase())
      ? `/${FOLDER_ROUTE_ESCAPE}`
      : ''
  return escape + folders.map((folder) => `/${encodeURIComponent(folder)}`).join('')
}

/** The folders a grid URL's segments name */
export const foldersFromRoute = (segments: string[] = []): string[] =>
  segments[0] === FOLDER_ROUTE_ESCAPE ? segments.slice(1) : segments

export const appSecretsUrl = (
  team: string,
  appId: string,
  {
    envId,
    path,
    secretId,
  }: { envId?: string | null; path?: string | null; secretId?: string | null } = {}
): string => {
  const folders = appFolderRoute(path)
  const params = new URLSearchParams()
  if (envId) params.set(ENV_SELECTION_PARAM, envId)
  if (secretId) params.set('secret', secretId)
  const query = params.toString()
  return `/${team}/apps/${appId}${folders}${query ? `?${query}` : ''}`
}
