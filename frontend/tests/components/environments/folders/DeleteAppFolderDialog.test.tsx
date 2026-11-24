import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { EnvironmentType } from '@/apollo/graphql'
import {
  DeleteAppFolderDialog,
  FolderInEnv,
} from '@/app/[team]/apps/[app]/_components/DeleteAppFolderDialog'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const inEnv = (id: string, name: string, extra: Partial<FolderInEnv> = {}): FolderInEnv => ({
  env: { id, name } as EnvironmentType,
  folderId: `folder-${id}`,
  secretCount: 2,
  folderCount: 1,
  shown: true,
  ...extra,
})

describe('DeleteAppFolderDialog', () => {
  let container: HTMLDivElement
  let root: Root
  const onDelete = jest.fn().mockResolvedValue(undefined)

  const open = (envs: FolderInEnv[]) =>
    act(async () =>
      root.render(
        <DeleteAppFolderDialog
          target={{ name: 'backend', fullPath: '/backend', envs, hasUnsavedChanges: false }}
          onClose={() => {}}
          onDelete={onDelete}
        />
      )
    )
  const lines = () => [...document.querySelectorAll('li')]
  const tick = (line: Element) => line.querySelector<HTMLButtonElement>('[role="checkbox"]')!
  const deleteButton = () =>
    [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Delete from')
    )!

  beforeEach(() => {
    onDelete.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('counts what each env loses, and starts with the shown envs ticked', async () => {
    await open([
      inEnv('dev', 'Development'),
      inEnv('prod', 'Production', { shown: false, secretCount: 1 }),
    ])
    const [dev, prod] = lines()

    expect(dev.textContent).toContain('2 secrets · 1 folder')
    expect(prod.textContent).toContain('1 secret · 1 folder')
    expect(tick(dev).getAttribute('aria-checked')).toBe('true')
    expect(tick(prod).getAttribute('aria-checked')).toBe('false')
    expect(tick(prod).disabled).toBe(false)
  })

  describe('with an env that is not decrypted yet', () => {
    // Its secrets are not in the rows, so they count as none
    const pending = { shown: false, pending: true, secretCount: 0 }

    it('claims no count for it, and deletes nothing from it', async () => {
      await open([inEnv('dev', 'Development'), inEnv('prod', 'Production', pending)])
      const [, prod] = lines()

      expect(prod.textContent).toContain('Still loading')
      expect(prod.textContent).not.toContain('0 secrets')
      expect(tick(prod).disabled).toBe(true)

      await act(async () => tick(prod).click())
      await act(async () => deleteButton().click())
      expect(onDelete).toHaveBeenCalledTimes(1)
      expect(onDelete.mock.calls[0][0].map((entry: FolderInEnv) => entry.env.id)).toEqual(['dev'])
    })

    it('does not start with it ticked when the folder is in no shown env', async () => {
      await open([inEnv('stg', 'Staging', pending), inEnv('prod', 'Production', pending)])

      expect(lines().map((line) => tick(line).getAttribute('aria-checked'))).toEqual([
        'false',
        'false',
      ])
      expect(deleteButton().textContent).toContain('Delete from 0 environments')
      expect(deleteButton().disabled).toBe(true)
    })
  })
})
