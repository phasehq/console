import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import {
  ApiEnvironmentSyncEventStatusChoices as EventStatus,
  EnvironmentSyncType,
} from '@/apollo/graphql'
import {
  DeployRun,
  FOLLOW_LIMIT_MS,
  useDeployRun,
} from '@/components/environments/secrets/DeployControls'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

type Event = { id: string; status: EventStatus; completedAt?: string | null }

const makeSync = (id: string, history: Event[]): EnvironmentSyncType =>
  ({
    id,
    isActive: true,
    environment: { id: 'dev', name: 'Development', index: 0 },
    history: history.map((event) => ({ createdAt: '2026-01-01T00:00:00Z', ...event })),
  }) as unknown as EnvironmentSyncType

describe('useDeployRun', () => {
  let container: HTMLDivElement
  let root: Root
  let run: DeployRun

  const Probe = ({ syncs }: { syncs: EnvironmentSyncType[] }) => {
    run = useDeployRun(syncs)
    return null
  }
  const render = async (syncs: EnvironmentSyncType[]) => {
    await act(async () => root.render(<Probe syncs={syncs} />))
  }
  /** A deploy to Development whose syncs then report `after` */
  const deploy = async (before: EnvironmentSyncType[], after: EnvironmentSyncType[]) => {
    await render(before)
    await act(async () => run.begin(['dev'], 1))
    await act(async () => run.deployed())
    await render(after)
  }

  beforeEach(() => {
    jest.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.useRealTimers()
  })

  it('follows a run until it ends', async () => {
    await deploy(
      [makeSync('s1', [])],
      [makeSync('s1', [{ id: 'e1', status: EventStatus.InProgress }])]
    )
    expect(run.phase).toBe('syncing')

    await render([
      makeSync('s1', [
        { id: 'e1', status: EventStatus.Completed, completedAt: '2026-01-01T00:00:05Z' },
      ]),
    ])
    expect(run.phase).toBe('synced')
  })

  it('stops following a run that never ends, leaving it to the app’s own sync status', async () => {
    await deploy(
      [makeSync('s1', [])],
      [makeSync('s1', [{ id: 'e1', status: EventStatus.InProgress }])]
    )
    await act(async () => jest.advanceTimersByTime(FOLLOW_LIMIT_MS - 1000))
    expect(run.phase).toBe('syncing')

    await act(async () => jest.advanceTimersByTime(1000))
    expect(run.phase).toBe('idle')
    expect(run.runs).toEqual([])
  })

  it('still reports a failure when it gives up on the runs left', async () => {
    await deploy(
      [makeSync('s1', []), makeSync('s2', [])],
      [
        makeSync('s1', [
          { id: 'e1', status: EventStatus.Failed, completedAt: '2026-01-01T00:00:05Z' },
        ]),
        makeSync('s2', [{ id: 'e2', status: EventStatus.InProgress }]),
      ]
    )
    expect(run.phase).toBe('syncing')

    await act(async () => jest.advanceTimersByTime(FOLLOW_LIMIT_MS))
    expect(run.phase).toBe('failed')
    expect(run.runs.map((r) => r.state)).toEqual(['failed', 'running'])
  })
})
