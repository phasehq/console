import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMutation } from '@apollo/client'
import { DeleteProviderCredentialDialog } from '@/components/syncing/DeleteProviderCredentialDialog'

jest.mock('@/graphql/mutations/syncing/deleteProviderCredentials.gql', () => ({
  __esModule: true,
  default: Symbol('DeleteProviderCreds'),
}))
jest.mock('@/graphql/queries/syncing/getSavedCredentials.gql', () => ({
  __esModule: true,
  default: Symbol('GetSavedCredentials'),
}))
jest.mock('@apollo/client', () => ({
  ...jest.requireActual('@apollo/client'),
  useMutation: jest.fn(),
}))
jest.mock('@headlessui/react', () => {
  const Dialog = Object.assign(({ children }: any) => <div>{children}</div>, {
    Panel: ({ children }: any) => <div>{children}</div>,
    Title: ({ children }: any) => <div>{children}</div>,
  })
  const Transition = Object.assign(({ children, show }: any) => (show ? <>{children}</> : null), {
    Child: ({ children }: any) => <>{children}</>,
  })
  return { Dialog, Transition }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('DeleteProviderCredentialDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let remove: jest.Mock
  let onDeleted: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    remove = jest.fn().mockResolvedValue({ data: { deleteProviderCredentials: { ok: true } } })
    onDeleted = jest.fn()
    ;(useMutation as jest.Mock).mockReturnValue([remove])
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.clearAllMocks()
  })

  const renderDialog = async (agentConnectionCount: number) => {
    await act(async () =>
      root.render(
        <DeleteProviderCredentialDialog
          credential={{
            id: 'credential-1',
            name: 'AWS production',
            syncCount: 0,
            agentConnectionCount,
          }}
          orgId="org-1"
          onDeleted={onDeleted}
        />
      )
    )
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Delete'))!
        .click()
    )
  }

  test('blocks deletion while Agent Connections still use the credentials', async () => {
    await renderDialog(2)

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'used by 2 Agent connections'
    )
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => button.textContent === 'Delete')
      .at(-1)!
    expect(confirm.disabled).toBe(true)
    await act(async () => confirm.click())
    expect(remove).not.toHaveBeenCalled()
  })

  test('shows backend errors, resets them on close, and stops loading', async () => {
    remove.mockRejectedValueOnce(new Error('Credential is still bound'))
    await renderDialog(0)
    const confirm = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => button.textContent === 'Delete')
      .at(-1)!

    await act(async () => confirm.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Credential is still bound'
    )
    expect(confirm.disabled).toBe(false)

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close delete credentials dialog"]')!
        .click()
    )
    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Delete'))!
        .click()
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
