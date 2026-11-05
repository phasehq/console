import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import GenericDialog from '@/components/common/GenericDialog'

// The mock exposes Headless UI's outside-click and Escape callback as a button.
jest.mock('@headlessui/react', () => {
  const Dialog = Object.assign(
    ({ children, onClose }: any) => (
      <div>
        <button type="button" onClick={() => onClose(false)}>
          Outside click
        </button>
        {children}
      </div>
    ),
    {
      Panel: ({ children }: any) => <div>{children}</div>,
      Title: ({ children }: any) => <div>{children}</div>,
    }
  )
  const Transition = Object.assign(({ children, show }: any) => (show ? <>{children}</> : null), {
    Child: ({ children }: any) => <>{children}</>,
  })
  return { Dialog, Transition }
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('GenericDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: jest.Mock

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = jest.fn()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const button = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent === label || element.getAttribute('aria-label') === label
    )!

  const openDialog = async (dismissible?: boolean) => {
    await act(async () =>
      root.render(
        <GenericDialog
          title="Agent token"
          buttonContent="Open"
          dismissible={dismissible}
          onClose={onClose}
        >
          <p>Shown once</p>
        </GenericDialog>
      )
    )
    await act(async () => button('Open').click())
  }

  test('closes on an outside click by default', async () => {
    await openDialog()
    await act(async () => button('Outside click').click())

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Shown once')
  })

  test('ignores outside clicks when not dismissible but still closes from its button', async () => {
    await openDialog(false)
    await act(async () => button('Outside click').click())

    expect(onClose).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Shown once')

    await act(async () => button('Close Agent token').click())

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Shown once')
  })
})
