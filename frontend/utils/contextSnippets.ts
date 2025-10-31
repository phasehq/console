import { getApiHost, getHostname } from './appConfig'

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
  path?: string,
  expiryText?: string,
) =>
  commandType === 'cli'
    ? [
        `export PHASE_HOST=${getHostname()} && export PHASE_SERVICE_TOKEN=${authToken} && echo "Note: This token will expire ${expiryText}"`,
        `phase secrets list --app-id ${appId}${env ? ` --env ${env}` : ''}${path !== '' ? ` --path ${path}` : ''}`
      ].join('\n')
    : [
        `export PHASE_PAT='${authToken}' && echo "Note: This token will expire ${expiryText}"`,
        'curl \\',
        '    --request GET \\',
        `    --url '${getApiHost()}/v1/secrets/?app_id=${appId}&env=${env}${path !== '' ? `&path=${path}` : ''}' \\`,
        `    --header "Authorization: Bearer $PHASE_PAT"`
      ].join('\n')
