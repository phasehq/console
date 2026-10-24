import React, { act } from 'react'
import { createRoot, Root } from 'react-dom/client'

import { GitLabEnvironmentScopePicker } from '@/components/syncing/GitLab/GitLabEnvironmentScopePicker'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

// Browser APIs Headless UI uses that jsdom lacks
const globals = globalThis as unknown as Record<string, unknown>
globals.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const elementPrototype = Element.prototype as unknown as Record<string, unknown>
elementPrototype.getAnimations ??= () => []
elementPrototype.scrollIntoView ??= () => {}

describe('GitLabEnvironmentScopePicker', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (value: string, environments: string[]) => {
    const onChange = jest.fn()
    await act(async () => {
      root.render(
        <GitLabEnvironmentScopePicker
          value={value}
          onChange={onChange}
          environments={environments}
          isGroup={false}
        />
      )
    })
    return { onChange, input: container.querySelector('input') as HTMLInputElement }
  }

  const press = async (element: HTMLElement, key: string) => {
    await act(async () => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  const activeOption = () => document.querySelector('[role="option"][data-focus]')?.textContent

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  // Sorted by name, as listed by the API
  const environments = Array.from({ length: 120 }, (_, i) => `review/branch-${i}`).sort()

  it.each([
    ['an environment that is not among the first listed', 'review/branch-99', environments],
    ['a custom scope', 'review/*', ['production', 'staging']],
  ])('keeps %s when the list is opened and Enter or Tab is pressed', async (_, scope, envs) => {
    for (const key of ['Enter', 'Tab']) {
      const { onChange, input } = await render(scope, envs)
      await act(async () => input.focus())
      await press(input, 'ArrowDown')

      expect(activeOption()).toBe(scope)

      await press(input, key)

      expect(onChange).not.toHaveBeenCalledWith('*')
    }
  })
})
