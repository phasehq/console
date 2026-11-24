import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { EnvironmentType } from '@/apollo/graphql'
import { FolderTarget } from '@/app/[team]/apps/[app]/_components/DeleteAppFolderDialog'
import { EditAppFolderDialog } from '@/app/[team]/apps/[app]/_components/EditAppFolderDialog'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const env = (id: string, name: string) => ({ id, name }) as EnvironmentType
const dev = env('dev', 'Development')
const prod = env('prod', 'Production')

// /old is in both envs; /api only in Production
const target: FolderTarget = {
  name: 'old',
  fullPath: '/old',
  envs: [
    { env: dev, folderId: 'old-dev', secretCount: 2, folderCount: 0, shown: true },
    { env: prod, folderId: 'old-prod', secretCount: 2, folderCount: 0, shown: true },
  ],
  hasUnsavedChanges: false,
}
const folders = new Map([
  ['/old', new Set(['dev', 'prod'])],
  ['/api', new Set(['prod'])],
])

describe('EditAppFolderDialog', () => {
  let container: HTMLDivElement
  let root: Root
  const onSave = jest.fn(async () => {})

  beforeEach(async () => {
    onSave.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <EditAppFolderDialog target={target} folders={folders} onClose={() => {}} onSave={onSave} />
      )
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const rename = async (name: string) => {
    const input = document.body.querySelector('input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, name)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const untick = async (envName: string) => {
    const row = [...document.body.querySelectorAll('li')].find((li) =>
      li.textContent?.includes(envName)
    )!
    await act(async () => {
      ;(row.querySelector('[role=checkbox]') as HTMLButtonElement).click()
    })
  }
  const save = () =>
    [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Save in')
    ) as HTMLButtonElement

  it('refuses a name another folder has in an environment being changed, and says where', async () => {
    await rename('api')

    expect(document.body.textContent).toContain('A folder named api is already there in Production')
    expect(save().disabled).toBe(true)
  })

  it('takes a name that is only used in an environment left unticked', async () => {
    await rename('api')
    await untick('Production')

    expect(document.body.textContent).not.toContain('is already there')
    expect(save().textContent).toBe('Save in 1 environment')
    expect(save().disabled).toBe(false)

    await act(async () => save().click())
    expect(onSave).toHaveBeenCalledWith([target.envs[0]], 'api', '/')
  })
})
