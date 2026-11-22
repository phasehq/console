import { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import {
  ApiEnvironmentSyncEventStatusChoices as EventStatus,
  ApiEnvironmentSyncStatusChoices as Status,
  EnvironmentSyncType,
} from '@/apollo/graphql'
import {
  DeployControls,
  DeployRun,
  FOLLOW_LIMIT_MS,
  useDeployRun,
} from '@/components/environments/secrets/DeployControls'
import { SecretChanges } from '@/components/environments/secrets/DeployPreview'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true
// Browser APIs the control and Headless UI use that jsdom lacks
const globals = globalThis as unknown as Record<string, unknown>
globals.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const elementPrototype = Element.prototype as unknown as Record<string, unknown>
elementPrototype.getAnimations ??= () => []

type Event = { id: string; status: EventStatus; completedAt?: string | null }

const makeSync = (
  id: string,
  history: Event[],
  status: Status = Status.Completed
): EnvironmentSyncType =>
  ({
    id,
    isActive: true,
    status,
    environment: { id: 'dev', name: 'Development', index: 0 },
    history: history.map((event) => ({ createdAt: '2026-01-01T00:00:00Z', ...event })),
  }) as unknown as EnvironmentSyncType

const SETTLE_MS = 5000
const NO_CHANGES = { changes: [], groups: [], kindCounts: [] } as unknown as SecretChanges

describe('useDeployRun', () => {
  let container: HTMLDivElement
  let root: Root
  let run: DeployRun

  const Probe = ({
    syncs,
    ...state
  }: { syncs: EnvironmentSyncType[] } & Partial<
    Pick<Parameters<typeof DeployControls>[0], 'changes' | 'dirty' | 'deploying' | 'unread'>
  >) => {
    run = useDeployRun(syncs)
    return (
      <DeployControls
        changes={NO_CHANGES}
        dirty={false}
        deploying={false}
        {...state}
        run={run}
        syncs={syncs}
        syncsByEnvId={new Map()}
        environments={[]}
        manageSyncsHref="/acme/apps/app/syncing"
        onReview={() => {}}
        onDiscard={() => {}}
        onDeploy={() => {}}
      />
    )
  }
  /** What the control's button reads */
  const face = () => container.querySelector('button')?.textContent?.replace(/\s+/g, ' ').trim()
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

  it('says the changes are deployed, not pending, while a saved deploy is read back', async () => {
    const one = { changes: [{}], groups: [], kindCounts: [] } as unknown as SecretChanges
    // Each button's label, without its spinner's own "Loading..."
    const buttons = () =>
      [...container.querySelectorAll('button')].map((button) =>
        button.textContent?.replace('Loading...', '').trim()
      )
    await act(async () => root.render(<Probe syncs={[]} changes={one} dirty deploying />))
    expect(buttons()).toEqual(['1 undeployed change', 'Deploying'])

    await act(async () => root.render(<Probe syncs={[]} changes={one} dirty deploying unread />))
    expect(buttons()).toEqual(['Loading'])
    expect(container.querySelector('button')!.disabled).toBe(true)
    expect(container.textContent).toContain('Deployed 1 change')
    expect(container.textContent).not.toContain('undeployed')
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

  it('reports a sync whose job could not be queued as failed, not synced', async () => {
    // The server marks the sync failed and records no run
    await deploy([makeSync('s1', [])], [makeSync('s1', [], Status.Failed)])
    expect(run.phase).toBe('syncing')

    await act(async () => jest.advanceTimersByTime(SETTLE_MS))
    expect(run.runs.map((r) => r.state)).toEqual(['failed'])
    expect(run.phase).toBe('failed')
    expect(face()).toBe('1 sync failed')
  })

  it('reports a run cancelled for a newer one that could not be queued as failed', async () => {
    await deploy(
      [makeSync('s1', [])],
      [makeSync('s1', [{ id: 'e1', status: EventStatus.Cancelled }], Status.Failed)]
    )
    await act(async () => jest.advanceTimersByTime(SETTLE_MS))
    expect(run.phase).toBe('failed')
  })

  it('counts only the syncs that ran as synced', async () => {
    const ran = { id: 'e1', status: EventStatus.Completed, completedAt: '2026-01-01T00:00:05Z' }
    // s2 is held back: no run, and its status isn't a failure
    await deploy(
      [makeSync('s1', []), makeSync('s2', [])],
      [makeSync('s1', [ran]), makeSync('s2', [], Status.Cancelled)]
    )
    await act(async () => jest.advanceTimersByTime(SETTLE_MS))
    expect(run.runs.map((r) => r.state)).toEqual(['completed', 'skipped'])
    expect(run.phase).toBe('synced')
    expect(face()).toBe('Synced 1/2')
  })

  it('says only "Deployed" when no sync ran', async () => {
    await deploy([makeSync('s1', [])], [makeSync('s1', [], Status.Cancelled)])
    await act(async () => jest.advanceTimersByTime(SETTLE_MS))
    expect(run.phase).toBe('synced')
    expect(face()).toBe('Deployed')
  })
})
