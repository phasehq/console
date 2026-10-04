import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CreateProviderCredentialsDialog } from '@/components/syncing/CreateProviderCredentialsDialog'

jest.mock('@headlessui/react', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const Dialog = function MockDialog({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
  Dialog.Panel = function MockDialogPanel({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
  Dialog.Title = function MockDialogTitle({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
  const Transition = function MockTransition({
    show,
    children,
  }: {
    show: boolean
    children: React.ReactNode
  }) {
    return show ? <>{children}</> : null
  }
  Transition.Child = function MockTransitionChild({ children }: { children: React.ReactNode }) {
    return <>{children}</>
  }
  return { Dialog, Transition }
})

jest.mock('@/components/syncing/CreateProviderCredentials', () => ({
  CreateProviderCredentials: ({ initialProvider }: any) => (
    <div data-testid="create-credentials-form">{initialProvider?.name}</div>
  ),
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('CreateProviderCredentialsDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  test('does not auto-open for the preselected provider used by an edit Connection', async () => {
    await act(async () =>
      root.render(
        <CreateProviderCredentialsDialog
          initialProvider={{ id: 'postgres', name: 'PostgreSQL' } as any}
          triggerLabel="Add integration"
        />
      )
    )

    expect(container.textContent).toContain('Add integration')
    expect(container.querySelector('[data-testid="create-credentials-form"]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="Store a new credential"]')!.click()
    })

    expect(container.querySelector('[data-testid="create-credentials-form"]')?.textContent).toBe(
      'PostgreSQL'
    )
  })
})
