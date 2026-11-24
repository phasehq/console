import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
// Pulls in every provider's logo; the folder under test has no syncs
jest.mock('@/components/syncing/EnvSyncsMenu', () => ({ SyncProviderIcons: () => null }))

import { AppFolderRow } from '@/app/[team]/apps/[app]/_components/AppFolderRow'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const env = { id: 'env-1', name: 'Development' }
const appFolder = {
  name: 'backend',
  path: '/',
  envs: [{ env, folder: { id: 'folder-1', name: 'backend', folderCount: 0, secretCount: 2 } }],
} as never
const columns = [{ env, checked: true, pending: false }] as never
const noop = () => {}
const deleteFolder = () => {}

it('shows the delete control only with permission, and re-renders when it changes', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  // The grid hands the row its delete handler only when the user may delete secrets in the app
  const render = (userCanDeleteFolders: boolean) =>
    act(async () => {
      root.render(
        <table>
          <tbody>
            <AppFolderRow
              appFolder={appFolder}
              fullPath="/backend"
              depth={0}
              expanded={false}
              onToggle={noop}
              href="/acme/apps/app-1/backend"
              columns={columns}
              showEnv={noop}
              deleteFolder={userCanDeleteFolders ? deleteFolder : undefined}
            />
          </tbody>
        </table>
      )
    })

  await render(false)
  expect(container.querySelector('[title="Delete backend"]')).toBeNull()

  // Same folder and handlers: only the permission changed, so the memo comparator must see it.
  await render(true)
  expect(container.querySelector('[title="Delete backend"]')).not.toBeNull()

  await act(async () => root.unmount())
  container.remove()
})
