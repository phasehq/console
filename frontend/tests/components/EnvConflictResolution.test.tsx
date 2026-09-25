import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import EnvConflictResolution from '@/components/environments/secrets/import/EnvConflictResolution'
import { EnvConflict } from '@/utils/secrets'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const conflicts: EnvConflict[] = [
  {
    key: 'API_KEY',
    hasDifferentValues: true,
    occurrences: [
      {
        id: 'api-key-1',
        key: 'API_KEY',
        value: 'first-value',
        comment: '',
        lineNumber: 2,
        occurrenceIndex: 0,
      },
      {
        id: 'api-key-2',
        key: 'API_KEY',
        value: 'second-value',
        comment: '',
        lineNumber: 8,
        occurrenceIndex: 1,
      },
    ],
  },
]

describe('EnvConflictResolution accordion', () => {
  test('hides source lines and reveals all values in the conflict together', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <EnvConflictResolution
          conflicts={conflicts}
          selections={{ API_KEY: 'api-key-1' }}
          onSelectionsChange={jest.fn()}
          onBack={jest.fn()}
          onContinue={jest.fn()}
        />
      )
    })

    expect(container.textContent).not.toMatch(/line\s+\d/i)
    expect(container.textContent).toContain('A value has been selected')
    expect(container.querySelector('[aria-label="Value option 1 for API_KEY"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Value option 2 for API_KEY"]')).not.toBeNull()
    expect(container.textContent).not.toContain('first-value')
    expect(container.textContent).not.toContain('second-value')

    const revealAll = container.querySelector(
      '[aria-label="Reveal all values for API_KEY"]'
    ) as HTMLButtonElement

    await act(async () => {
      revealAll.click()
    })

    expect(container.textContent).toContain('first-value')
    expect(container.textContent).toContain('second-value')
    expect(container.querySelector('[aria-label="Hide all values for API_KEY"]')).not.toBeNull()
    expect(container.querySelectorAll('[aria-label^="Reveal value option"]')).toHaveLength(0)

    await act(async () => root.unmount())
    container.remove()
  })
})
