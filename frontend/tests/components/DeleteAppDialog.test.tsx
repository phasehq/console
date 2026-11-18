import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import DeleteAppDialog from '@/components/apps/DeleteAppDialog'

const deleteApp = jest.fn(async (_options: { variables: unknown }) => ({}))

jest.mock('@/graphql/mutations/deleteApp.gql', () => ({ DeleteApplication: {} }), {
  virtual: true,
})
jest.mock('@/graphql/queries/getApps.gql', () => ({ GetApps: {} }), { virtual: true })
jest.mock('@/graphql/queries/apps/getDeletedApps.gql', () => ({ GetDeletedApps: {} }), {
  virtual: true,
})
jest.mock('@apollo/client', () => ({
  useMutation: () => [deleteApp, { loading: false }],
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('react-toastify', () => ({
  toast: { error: jest.fn(), promise: (run: () => Promise<unknown>) => run() },
}))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no Web Animations; the dialog's transition asks for them.
Element.prototype.getAnimations = () => []

describe('DeleteAppDialog', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (label: string) =>
    Array.from(document.body.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label
    )

  const open = async () => {
    await act(async () => {
      root.render(
        <DeleteAppDialog organisationId="org-1" appId="app-1" appName="billing" teamName="acme" />
      )
    })
    await act(async () => button('Delete')!.click())
  }

  const tickDeleteImmediately = async () => {
    const checkbox = document.body.querySelector('[role="checkbox"]') as HTMLButtonElement
    await act(async () => checkbox.click())
  }

  const confirmWithName = async (label: string) => {
    const input = document.body.querySelector('#appname') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, 'billing')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      button(label)!.click()
      jest.advanceTimersByTime(500)
    })
  }

  beforeEach(() => {
    jest.useFakeTimers()
    deleteApp.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.useRealTimers()
  })

  it('schedules the deletion by default, and says when the App will be deleted', async () => {
    await open()

    expect(document.body.textContent).toContain('This App will be deleted on')
    expect(document.body.textContent).toContain('You can restore the App until then')
    expect(document.body.textContent).not.toContain('This App will be deleted immediately')
    expect(button('Schedule for deletion')).toBeDefined()
    expect(button('Delete now')).toBeUndefined()

    await confirmWithName('Schedule for deletion')

    expect(deleteApp).toHaveBeenCalledTimes(1)
    expect(deleteApp).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { id: 'app-1', immediately: false } })
    )
  })

  it('deletes immediately once the box is ticked, and says so', async () => {
    await open()
    await tickDeleteImmediately()

    expect(document.body.textContent).toContain('This App will be deleted immediately')
    expect(document.body.textContent).toContain('This cannot be undone')
    expect(document.body.textContent).not.toContain('This App will be deleted on')
    expect(button('Delete now')).toBeDefined()
    expect(button('Schedule for deletion')).toBeUndefined()

    await confirmWithName('Delete now')

    expect(deleteApp).toHaveBeenCalledTimes(1)
    expect(deleteApp).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { id: 'app-1', immediately: true } })
    )
  })

  it('goes back to scheduling when the box is unticked', async () => {
    await open()
    await tickDeleteImmediately()
    await tickDeleteImmediately()

    expect(document.body.textContent).toContain('This App will be deleted on')
    expect(button('Schedule for deletion')).toBeDefined()
  })
})
