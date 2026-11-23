import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { FaArrowsRotate } from 'react-icons/fa6'

import { EnvironmentType } from '@/apollo/graphql'
import { AppSecretGroup } from '@/app/[team]/apps/[app]/_components/AppSecretGroup'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const env = (id: string, name: string) => ({ id, name }) as EnvironmentType
const dev = env('dev', 'Development')
const staging = env('staging', 'Staging')
const prod = env('prod', 'Production')

it('offers set-up where the group is missing, but not in an env that is still loading', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // Development has the rotation. Staging and Production are hidden: Staging has loaded without
  // it, Production has not loaded yet and may have it
  await act(async () =>
    root.render(
      <table>
        <tbody>
          <AppSecretGroup
            kind="rotation"
            groupId="rotation:g1"
            icon={FaArrowsRotate}
            displayName="OpenAI API key"
            path="/"
            columns={[
              { env: dev, checked: true, pending: false },
              { env: staging, checked: false, pending: false },
              { env: prod, checked: false, pending: true },
            ]}
            environments={[dev, staging, prod]}
            sourceByEnvId={new Map([['dev', 'rotation-1']])}
            depth={0}
            canSetUp
            onSetUp={() => {}}
          >
            {null}
          </AppSecretGroup>
        </tbody>
      </table>
    )
  )

  expect(container.querySelector('[title="Set up rotation in Staging"]')).not.toBeNull()
  expect(container.querySelector('[title="Set up rotation in Production"]')).toBeNull()

  await act(async () => root.unmount())
  container.remove()
})

it('strikes out the lane of an env that is scheduled for deletion, and offers no set-up in it', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const deleted = {
    id: 'staging',
    name: 'Staging',
    envType: 'STAGING',
    index: 1,
    deletedAt: '2026-11-22T12:00:00Z',
    deletionScheduledFor: '2026-11-23T12:00:00Z',
    deletionDelayed: false,
    canRestore: false,
  }
  // Staging is scheduled for deletion, so it is no longer among the app's environments
  await act(async () =>
    root.render(
      <table>
        <tbody>
          <AppSecretGroup
            kind="rotation"
            groupId="rotation:g1"
            icon={FaArrowsRotate}
            displayName="OpenAI API key"
            path="/"
            columns={[
              { env: dev, checked: true, pending: false },
              { env: staging, checked: false, pending: false, deleted },
              { env: prod, checked: false, pending: false },
            ]}
            environments={[dev, prod]}
            sourceByEnvId={new Map([['dev', 'rotation-1']])}
            depth={0}
            canSetUp
            onSetUp={() => {}}
          >
            {null}
          </AppSecretGroup>
        </tbody>
      </table>
    )
  )

  // The key cell, a cell per column, and the trailing cell: the columns stay aligned
  const cells = [...container.querySelectorAll('td')]
  expect(cells).toHaveLength(5)
  expect(cells[2].getAttribute('title')).toBe('Staging: Being deleted')
  expect(cells[2].children).toHaveLength(0)
  expect(container.querySelector('[title="Set up rotation in Staging"]')).toBeNull()
  expect(container.querySelector('[title="Set up rotation in Production"]')).not.toBeNull()

  await act(async () => root.unmount())
  container.remove()
})
