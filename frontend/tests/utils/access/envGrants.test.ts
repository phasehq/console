import { ApiEnvironmentKeyGrantGrantTypeChoices as Grant, EnvironmentKeyType } from '@/apollo/graphql'
import { grantedEnvIds, holdsEnvItself } from '@/utils/access/envGrants'

const key = (envId: string, ...grantTypes: Grant[]) =>
  ({
    environment: { id: envId },
    grants: grantTypes.map((grantType) => ({ grantType })),
  }) as EnvironmentKeyType

describe('grantedEnvIds', () => {
  const grants = grantedEnvIds([
    key('dev', Grant.Individual),
    key('staging', Grant.Team),
    key('prod', Grant.Individual, Grant.Team),
    key('legacy'),
    null,
  ])

  it('separates the envs an account holds itself from those a team gives it', () => {
    expect(grants.individual).toEqual(['dev', 'prod', 'legacy'])
    expect(grants.team).toEqual(['staging', 'prod'])
  })

  it("counts an env as the account's own only when it holds it itself", () => {
    expect(holdsEnvItself(grants, 'dev')).toBe(true)
    expect(holdsEnvItself(grants, 'prod')).toBe(true)
    expect(holdsEnvItself(grants, 'staging')).toBe(false)
    expect(holdsEnvItself(grants, 'qa')).toBe(false)
    expect(holdsEnvItself(undefined, 'dev')).toBe(false)
  })

  it('reads no keys as no access', () => {
    expect(grantedEnvIds(undefined)).toEqual({ individual: [], team: [] })
  })
})
