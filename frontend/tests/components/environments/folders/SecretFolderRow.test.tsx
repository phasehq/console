import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

jest.mock('next/navigation', () => ({ usePathname: () => '/acme/apps/app-1/environments/env-1' }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
jest.mock('@/components/environments/folders/DeleteDialog', () => ({
  DeleteFolderConfirmDialog: () => <button data-testid="delete-folder" />,
}))

import { SecretFolderRow } from '@/components/environments/folders/SecretFolderRow'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const folder = { id: 'folder-1', name: 'backend', folderCount: 0, secretCount: 2 } as never
const handleDelete = () => {}

it('shows the delete control only with permission, and re-renders when it changes', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const render = (userCanDeleteFolders: boolean) =>
    act(async () => {
      root.render(
        <SecretFolderRow
          folder={folder}
          handleDelete={handleDelete}
          userCanDeleteFolders={userCanDeleteFolders}
        />
      )
    })

  await render(false)
  expect(container.querySelector('[data-testid=delete-folder]')).toBeNull()

  // Same folder and handler: only the permission changed, so the memo comparator must see it.
  await render(true)
  expect(container.querySelector('[data-testid=delete-folder]')).not.toBeNull()

  await act(async () => root.unmount())
  container.remove()
})
