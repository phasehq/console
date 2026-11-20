import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const mockTeams: { current: unknown[] } = { current: [] }

jest.mock('@/graphql/queries/syncing/getServices.gql', () => 'GetServiceList', { virtual: true })
jest.mock('@/graphql/queries/teams/getTeams.gql', () => ({ GetTeams: 'GetTeams' }), {
  virtual: true,
})
jest.mock('@apollo/client', () => ({
  useQuery: (query: string, options?: { skip?: boolean }) => {
    if (query === 'GetTeams') return options?.skip ? {} : { data: { teams: mockTeams.current } }
    return { data: { services: [{ id: 'cloudflare_pages', name: 'Cloudflare Pages' }] } }
  },
}))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return { organisationContext: React.createContext({ activeOrganisation: null }) }
})
jest.mock('@/components/common/Card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/components/syncing/ProviderIcon', () => ({ ProviderIcon: () => null }))
jest.mock('@/components/syncing/CreateSyncDialog', () => ({
  CreateSyncDialog: (props: { userCanReadEnvs: boolean; userCanCreateIntegrations: boolean }) => (
    <div
      data-testid="create-sync-dialog"
      data-read-envs={String(props.userCanReadEnvs)}
      data-create-integrations={String(props.userCanCreateIntegrations)}
    />
  ),
}))

import { SyncOptions } from '@/components/syncing/SyncOptions'
import { organisationContext } from '@/contexts/organisationContext'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const APP_ID = 'app-1'
const MEMBER_ID = 'member-1'

// Org role: can read the app's environments, has no Integrations access.
const orgRolePermissions = JSON.stringify({
  permissions: { Teams: ['read'] },
  app_permissions: { Environments: ['read'] },
})

const teamRolePermissions = JSON.stringify({
  permissions: {},
  app_permissions: { Environments: ['read'], Integrations: ['create', 'read'] },
})

const teamWithRoleOverride = {
  id: 'team-1',
  apps: [{ id: APP_ID }],
  members: [{ orgMember: { id: MEMBER_ID } }],
  owner: { id: 'someone-else' },
  memberRole: { permissions: teamRolePermissions },
}

const renderDialogProps = async () => {
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
              role: { permissions: orgRolePermissions },
            },
          } as never
        }
      >
        <SyncOptions appId={APP_ID} defaultOpen={true} />
      </organisationContext.Provider>
    )
  })

  const dialog = container.querySelector('[data-testid=create-sync-dialog]') as HTMLElement
  const props = {
    userCanReadEnvs: dialog.dataset.readEnvs,
    userCanCreateIntegrations: dialog.dataset.createIntegrations,
  }

  await act(async () => root.unmount())
  container.remove()
  return props
}

describe('SyncOptions create-sync permissions', () => {
  it('honours a team role override that grants Integrations:create', async () => {
    mockTeams.current = [teamWithRoleOverride]

    expect(await renderDialogProps()).toEqual({
      userCanReadEnvs: 'true',
      userCanCreateIntegrations: 'true',
    })
  })

  it('uses the org role when the user has no team access to the app', async () => {
    mockTeams.current = [{ ...teamWithRoleOverride, apps: [{ id: 'another-app' }] }]

    expect(await renderDialogProps()).toEqual({
      userCanReadEnvs: 'true',
      userCanCreateIntegrations: 'false',
    })
  })
})
