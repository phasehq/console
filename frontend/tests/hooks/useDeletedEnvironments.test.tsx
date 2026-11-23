import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { toast } from 'react-toastify'

import { DeletedEnvironmentType } from '@/apollo/graphql'
import { useDeletedEnvironments } from '@/hooks/useDeletedEnvironments'

const useQuery = jest.fn()
const restoreEnvironment = jest.fn()
const deleteEnvironmentNow = jest.fn()

jest.mock(
  '@/graphql/queries/secrets/getAppEnvironments.gql',
  () => ({ GetAppEnvironments: 'GetAppEnvironments' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/queries/secrets/getDeletedEnvironments.gql',
  () => ({ GetDeletedEnvironments: 'GetDeletedEnvironments' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/mutations/environments/restoreEnvironment.gql',
  () => ({ RestoreEnvironmentOp: 'RestoreEnvironmentOp' }),
  { virtual: true }
)
jest.mock(
  '@/graphql/mutations/environments/deleteEnvironmentNow.gql',
  () => ({ DeleteEnvironmentNowOp: 'DeleteEnvironmentNowOp' }),
  { virtual: true }
)
jest.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
  useMutation: (document: string) => [
    document === 'RestoreEnvironmentOp' ? restoreEnvironment : deleteEnvironmentNow,
  ],
}))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/hooks/usePendingDeletionRefresh', () => ({ usePendingDeletionRefresh: jest.fn() }))
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const staging = {
  id: 'env-2',
  name: 'Staging',
  index: 1,
  deletionScheduledFor: '2026-11-23T12:00:00Z',
  deletionDelayed: false,
  canRestore: true,
} as DeletedEnvironmentType

describe('useDeletedEnvironments', () => {
  let container: HTMLDivElement
  let root: Root
  let seen: ReturnType<typeof useDeletedEnvironments>[] = []

  const Probe = ({ enabled }: { enabled?: boolean }) => {
    seen.push(useDeletedEnvironments('app-1', enabled))
    return null
  }
  const render = (enabled?: boolean) => act(async () => root.render(<Probe enabled={enabled} />))
  const latest = () => seen.at(-1)!

  beforeEach(() => {
    jest.clearAllMocks()
    seen = []
    useQuery.mockReturnValue({
      data: { deletedEnvironments: [staging] },
      refetch: jest.fn(),
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
    })
    restoreEnvironment.mockResolvedValue({})
    deleteEnvironmentNow.mockResolvedValue({})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("lists the app's environments that are scheduled for deletion", async () => {
    await render()

    expect(useQuery).toHaveBeenLastCalledWith(
      'GetDeletedEnvironments',
      expect.objectContaining({ variables: { appId: 'app-1' }, skip: false })
    )
    expect(latest().environments).toEqual([staging])
  })

  it('asks for nothing when switched off, and hands out the same empty list every time', async () => {
    useQuery.mockReturnValue({ data: undefined })
    await render(false)
    await render(false)

    expect(useQuery).toHaveBeenLastCalledWith(
      'GetDeletedEnvironments',
      expect.objectContaining({ skip: true })
    )
    expect(seen.length).toBeGreaterThan(1)
    expect(latest().environments).toEqual([])
    expect(seen.every((result) => result.environments === seen[0].environments)).toBe(true)
  })

  it('restores one, marking it meanwhile, and reads its own list only once the grid has it back', async () => {
    const steps: string[] = []
    const refetch = jest.fn(async () => {
      steps.push('list read again')
    })
    useQuery.mockReturnValue({
      data: { deletedEnvironments: [staging] },
      refetch,
      startPolling: jest.fn(),
      stopPolling: jest.fn(),
    })
    let finish = () => {}
    restoreEnvironment.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = () => {
          steps.push('restored, grid read again')
          resolve()
        }
      })
    )
    await render()

    let restoring = Promise.resolve()
    await act(async () => {
      restoring = latest().restore(staging)
    })
    expect(latest().restoringId).toBe('env-2')
    expect(refetch).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()

    await act(async () => {
      finish()
      await restoring
    })
    // The grid's query is awaited with the mutation; the list is not among its refetches
    expect(restoreEnvironment).toHaveBeenCalledWith({
      variables: { environmentId: 'env-2' },
      refetchQueries: [
        { query: 'GetAppEnvironments', variables: { appId: 'app-1' } },
        'GetAppSecrets',
      ],
      awaitRefetchQueries: true,
    })
    expect(steps).toEqual(['restored, grid read again', 'list read again'])
    expect(latest().restoringId).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('Staging has been restored')
  })

  it('clears the mark when a restore fails, and leaves the error to the global handler', async () => {
    restoreEnvironment.mockRejectedValue(new Error('nope'))
    await render()

    await act(async () => {
      await latest().restore(staging)
    })
    expect(latest().restoringId).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('deletes one now, then reads the list again', async () => {
    await render()

    await act(async () => {
      await latest().deleteNow(staging)
    })
    expect(deleteEnvironmentNow).toHaveBeenCalledWith({
      variables: { environmentId: 'env-2' },
      refetchQueries: [{ query: 'GetDeletedEnvironments', variables: { appId: 'app-1' } }],
      awaitRefetchQueries: true,
    })
    expect(toast.success).toHaveBeenCalledWith('Staging is being deleted')
  })
})
