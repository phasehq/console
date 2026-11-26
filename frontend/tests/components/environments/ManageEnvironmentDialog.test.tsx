import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

const mockRename = jest.fn()
let mockAppEnvironments: Record<string, unknown>[] = []

jest.mock('@apollo/client', () => ({
  useQuery: () => ({ data: { appEnvironments: mockAppEnvironments } }),
  useMutation: (mutation: string) => [
    mutation === 'RenameEnv' ? mockRename : jest.fn(),
    { loading: false },
  ],
}))
jest.mock('@/graphql/mutations/environments/renameEnvironment.gql', () => ({
  RenameEnv: 'RenameEnv',
}))
jest.mock('@/graphql/mutations/environments/deleteEnvironment.gql', () => ({
  DeleteEnv: 'DeleteEnv',
}))
jest.mock('@/graphql/queries/secrets/getAppEnvironments.gql', () => ({
  GetAppEnvironments: 'GetAppEnvironments',
}))
jest.mock('@/graphql/queries/secrets/getDeletedEnvironments.gql', () => ({
  GetDeletedEnvironments: 'GetDeletedEnvironments',
}))
jest.mock('@/components/common/GenericDialog', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@/components/common/ColorPicker', () => ({ ColorPicker: () => null }))
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }))
jest.mock('@/components/forms/UpgradeRequestForm', () => ({ UpgradeRequestForm: () => null }))
jest.mock('@/hooks/useAppPermissions', () => ({
  useAppPermissions: () => ({ hasPermission: () => true }),
}))
jest.mock('@/contexts/organisationContext', () => {
  const React = require('react')
  return { organisationContext: React.createContext({ activeOrganisation: null }) }
})
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

import { EnvironmentType } from '@/apollo/graphql'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const env = (id: string, name: string, isPrimary: boolean) =>
  ({
    id,
    name,
    envType: 'CUSTOM',
    color: null,
    isPrimary,
    app: { id: 'app-1', name: 'payments' },
    members: [],
  }) as unknown as EnvironmentType
const STAGING = env('staging', 'Staging', false)
const PRODUCTION = env('production', 'Production', true)

describe('ManageEnvironmentDialog: the primary environment', () => {
  let container: HTMLDivElement
  let root: Root

  const render = (environment: EnvironmentType) =>
    act(async () => root.render(<ManageEnvironmentDialog environment={environment} />))
  const primarySwitch = () => {
    const label = Array.from(container.querySelectorAll('label')).find(
      (candidate) => candidate.textContent === 'Primary environment'
    )!
    return document.getElementById(label.htmlFor) as HTMLButtonElement
  }
  const save = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'Save'
    )!
  const submit = () =>
    act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

  beforeEach(() => {
    jest.clearAllMocks()
    mockAppEnvironments = [STAGING, PRODUCTION]
    mockRename.mockResolvedValue({ data: { renameEnvironment: { environment: { id: 'x' } } } })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('is named by its label, and off for an environment that is not primary', async () => {
    await render(STAGING)
    expect(primarySwitch().getAttribute('role')).toBe('switch')
    expect(primarySwitch().getAttribute('aria-checked')).toBe('false')
    expect(save().disabled).toBe(true)
  })

  it('takes the designation over from the current primary environment', async () => {
    await render(STAGING)
    await act(async () => primarySwitch().click())

    expect(container.textContent).toContain('This takes over from Production.')
    await submit()
    expect(mockRename).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { environmentId: 'staging', name: 'Staging', color: null, isPrimary: true },
      })
    )
  })

  it('takes the designation away from the primary environment', async () => {
    await render(PRODUCTION)
    expect(primarySwitch().getAttribute('aria-checked')).toBe('true')
    await act(async () => primarySwitch().click())
    await submit()

    expect(mockRename.mock.calls[0][0].variables.isPrimary).toBe(false)
  })

  it('leaves the designation alone when only the name changes', async () => {
    await render(PRODUCTION)
    const input = container.querySelector<HTMLInputElement>('input')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(input, 'Live')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await submit()

    expect(mockRename.mock.calls[0][0].variables).toEqual({
      environmentId: 'production',
      name: 'Live',
      color: null,
      isPrimary: null,
    })
  })
})
