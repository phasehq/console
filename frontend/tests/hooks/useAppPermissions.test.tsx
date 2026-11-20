import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const mockTeams: { current: unknown[] } = { current: [] }

jest.mock('@/graphql/queries/teams/getTeams.gql', () => ({ GetTeams: 'GetTeams' }), {
  virtual: true,
})
jest.mock('@apollo/client', () => ({
  useQuery: (_query: string, options?: { skip?: boolean }) =>
    options?.skip ? {} : { data: { teams: mockTeams.current } },
}))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return { organisationContext: React.createContext({ activeOrganisation: null }) }
})

import { useAppPermissions } from '@/hooks/useAppPermissions'
import { organisationContext } from '@/contexts/organisationContext'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const APP_ID = 'app-1'
const MEMBER_ID = 'member-1'

const orgRolePermissions = JSON.stringify({
  permissions: { Teams: ['read'] },
  app_permissions: { Environments: ['read'], Secrets: ['read'] },
})

const teamRolePermissions = JSON.stringify({
  permissions: {},
  app_permissions: { Integrations: ['create', 'read'] },
})

const team = (overrides: object = {}) => ({
  id: 'team-1',
  apps: [{ id: APP_ID }],
  members: [{ orgMember: { id: MEMBER_ID } }],
  owner: { id: 'someone-else' },
  memberRole: { permissions: teamRolePermissions },
  ...overrides,
})

const CHECKS = [
  ['Environments', 'read'],
  ['Integrations', 'create'],
] as const

const Probe = () => {
  const { hasPermission } = useAppPermissions(APP_ID)
  return (
    <div>
      {CHECKS.map(([resource, action]) => (
        <span key={resource} data-check={`${resource}:${action}`}>
          {String(hasPermission(resource, action, true))}
        </span>
      ))}
    </div>
  )
}

const resolvePermissions = async (individualAppIds: string[]) => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <organisationContext.Provider
        value={
          {
            activeOrganisation: {
              id: 'org-1',
              memberId: MEMBER_ID,
              individualAppIds,
              role: { permissions: orgRolePermissions },
            },
          } as never
        }
      >
        <Probe />
      </organisationContext.Provider>
    )
  })

  const result = Object.fromEntries(
    Array.from(container.querySelectorAll<HTMLElement>('[data-check]')).map((el) => [
      el.dataset.check,
      el.textContent === 'true',
    ])
  )

  await act(async () => root.unmount())
  container.remove()
  return result
}

describe('useAppPermissions', () => {
  it('unions the org role and the team override for a direct member who is also in a team', async () => {
    mockTeams.current = [team()]

    expect(await resolvePermissions([APP_ID])).toEqual({
      'Environments:read': true,
      'Integrations:create': true,
    })
  })

  it('uses only the team override for team-only access', async () => {
    mockTeams.current = [team()]

    expect(await resolvePermissions([])).toEqual({
      'Environments:read': false,
      'Integrations:create': true,
    })
  })

  it('uses the org role for a direct member with no team access', async () => {
    mockTeams.current = [team({ apps: [{ id: 'another-app' }] })]

    expect(await resolvePermissions([APP_ID])).toEqual({
      'Environments:read': true,
      'Integrations:create': false,
    })
  })

  it('uses the org role for a team without an override', async () => {
    mockTeams.current = [team({ memberRole: null })]

    expect(await resolvePermissions([])).toEqual({
      'Environments:read': true,
      'Integrations:create': false,
    })
  })
})
