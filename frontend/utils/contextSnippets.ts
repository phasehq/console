import { getApiHost } from './appConfig'

export type CommandAuth = {
  cliToken: string
  apiToken: string
  expiry: number
}

export type CommandType = 'cli' | 'api'

export const generateCommand = (
  commandType: CommandType,
  authToken: string,
  appId: string,
  env?: string,
  path?: string
) =>
  commandType === 'cli'
    ? [
        'PHASE_VERIFY_SSL=False',
        'PHASE_HOST=https://localhost',
        `PHASE_SERVICE_TOKEN=${authToken}`,
        'phase secrets list',
        `    --app-id ${appId}${env ? ` \\\n    --env ${env}` : ''}${path !== '' ? ` \\\n    --path ${path}` : ''}`,
      ].join(' \\\n')
    : [
        'curl \\',
        '    --request GET \\',
        `    --url '${getApiHost()}/v1/secrets/?app_id=${appId}&env=${env}${path !== '' ? `&path=${path}` : ''}' \\`,
        `    --header 'Authorization: Bearer ${authToken}' \\`,
        '    -k \\',
        '    | jq .',
      ].join('\n')
