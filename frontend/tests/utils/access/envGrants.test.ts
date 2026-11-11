import { ApiEnvironmentKeyGrantGrantTypeChoices as Grant, EnvironmentKeyType } from '@/apollo/graphql'
import { grantedEnvIds, hasEnvAccess } from '@/utils/access/envGrants'

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

  it('answers access by either route', () => {
    expect(hasEnvAccess(grants, 'staging')).toBe(true)
    expect(hasEnvAccess(grants, 'qa')).toBe(false)
    expect(hasEnvAccess(undefined, 'dev')).toBe(false)
  })

  it('reads no keys as no access', () => {
    expect(grantedEnvIds(undefined)).toEqual({ individual: [], team: [] })
  })
})
