import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { EnvironmentType } from '@/apollo/graphql'
import { DeleteEnvironment } from '@/components/environments/ManageEnvironmentDialog'

const deleteEnvironment = jest.fn(async (_options: { variables: unknown }) => ({}))
const hasPermission = jest.fn(
  (_resource: string, _action: string, _isAppResource?: boolean) => true
)

jest.mock('@/graphql/mutations/environments/renameEnvironment.gql', () => ({ RenameEnv: {} }), {
  virtual: true,
})
jest.mock('@/graphql/mutations/environments/deleteEnvironment.gql', () => ({ DeleteEnv: {} }), {
  virtual: true,
})
jest.mock('@/graphql/queries/secrets/getAppEnvironments.gql', () => ({ GetAppEnvironments: {} }), {
  virtual: true,
})
jest.mock(
  '@/graphql/queries/secrets/getDeletedEnvironments.gql',
  () => ({ GetDeletedEnvironments: {} }),
  { virtual: true }
)
jest.mock('@apollo/client', () => ({
  useMutation: () => [deleteEnvironment, { loading: false }],
}))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/contexts/organisationContext', () => {
  const { createContext } = jest.requireActual('react')
  return {
    organisationContext: createContext({ activeOrganisation: { id: 'org-1', plan: 'PR' } }),
  }
})
jest.mock('@/hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({ hasPermission, isGlobalAccess: false }),
}))
jest.mock('@/components/settings/organisation/UpsellDialog', () => ({ UpsellDialog: () => null }))
jest.mock('@/components/forms/UpgradeRequestForm', () => ({ UpgradeRequestForm: () => null }))
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no Web Animations; the dialog's transition asks for them.
Element.prototype.getAnimations = () => []

const environment = {
  id: 'env-1',
  name: 'staging',
  app: { id: 'app-1' },
} as unknown as EnvironmentType

describe('DeleteEnvironment', () => {
  let container: HTMLDivElement
  let root: Root

  const button = (label: string) =>
    Array.from(document.body.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label
    )

  const open = async () => {
    await act(async () => {
      root.render(<DeleteEnvironment environment={environment} />)
    })
    await act(async () => button('Delete')!.click())
  }

  const tickDeleteImmediately = async () => {
    const checkbox = document.body.querySelector('[role="checkbox"]') as HTMLButtonElement
    await act(async () => checkbox.click())
  }

  const typeName = async (name: string) => {
    const input = document.body.querySelector('input') as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, name)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  beforeEach(() => {
    deleteEnvironment.mockClear()
    hasPermission.mockReset()
    hasPermission.mockReturnValue(true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('schedules the deletion by default, and says when the Environment will be deleted', async () => {
    await open()

    expect(document.body.textContent).toContain('This Environment will be deleted in 24 hours, on')
    expect(document.body.textContent).toContain('You can restore it until then')
    expect(document.body.textContent).toContain(
      'Its name cannot be reused until it has been deleted'
    )
    expect(button('Delete now')).toBeUndefined()

    await typeName('staging')
    await act(async () => button('Schedule for deletion')!.click())

    expect(deleteEnvironment).toHaveBeenCalledTimes(1)
    expect(deleteEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { environmentId: 'env-1', immediately: false } })
    )
  })

  it('deletes immediately once the box is ticked, and says so', async () => {
    await open()
    await tickDeleteImmediately()

    expect(document.body.textContent).toContain('This Environment will be deleted immediately')
    expect(document.body.textContent).toContain('This cannot be undone')
    expect(document.body.textContent).not.toContain(
      'This Environment will be deleted in 24 hours, on'
    )
    expect(button('Schedule for deletion')).toBeUndefined()

    await typeName('staging')
    await act(async () => button('Delete now')!.click())

    expect(deleteEnvironment).toHaveBeenCalledTimes(1)
    expect(deleteEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { environmentId: 'env-1', immediately: true } })
    )
  })

  it('does nothing until the name is typed', async () => {
    await open()
    await tickDeleteImmediately()

    expect(button('Delete now')!.disabled).toBe(true)
    await act(async () => button('Delete now')!.click())

    expect(deleteEnvironment).not.toHaveBeenCalled()
  })

  it('offers nothing without the permission to delete Environments in this App', async () => {
    hasPermission.mockReturnValue(false)

    await act(async () => {
      root.render(<DeleteEnvironment environment={environment} />)
    })

    expect(button('Delete')).toBeUndefined()
    expect(hasPermission).toHaveBeenCalledWith('Environments', 'delete', true)
  })

  it('forgets the choice and the typed name when closed', async () => {
    await open()
    await tickDeleteImmediately()
    await typeName('staging')
    await act(async () => button('Cancel')!.click())
    await act(async () => button('Delete')!.click())

    expect(document.body.textContent).toContain('This Environment will be deleted in 24 hours, on')
    expect(button('Schedule for deletion')!.disabled).toBe(true)
  })
})
