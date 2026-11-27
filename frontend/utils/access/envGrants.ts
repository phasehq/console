import { ApiEnvironmentKeyGrantGrantTypeChoices, EnvironmentKeyType, Maybe } from '@/apollo/graphql'

/** The envs of an app an account reaches itself, and those it reaches through a team */
export type EnvGrants = { individual: string[]; team: string[] }

export const grantedEnvIds = (
  environmentKeys: Maybe<Array<Maybe<EnvironmentKeyType>>> | undefined
): EnvGrants => {
  const grants: EnvGrants = { individual: [], team: [] }
  for (const key of environmentKeys ?? []) {
    const envId = key?.environment?.id
    if (!envId) continue
    const types = (key.grants ?? []).map((grant) => grant?.grantType)
    // A key from before grants were recorded is the account's own
    if (types.length === 0 || types.includes(ApiEnvironmentKeyGrantGrantTypeChoices.Individual))
      grants.individual.push(envId)
    if (types.includes(ApiEnvironmentKeyGrantGrantTypeChoices.Team)) grants.team.push(envId)
  }
  return grants
}

/** Whether an account holds an env itself, whatever a team also gives it */
export const holdsEnvItself = (grants: EnvGrants | undefined, envId: string) =>
  Boolean(grants?.individual.includes(envId))
